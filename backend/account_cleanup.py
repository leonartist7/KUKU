"""Restart-safe operational cleanup for closed accounts.

This module removes short-lived access and presence state only after the owning
user is confirmed disabled. It deliberately retains users, shared history,
upload metadata/provider objects and the closure tombstone.
"""
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import uuid

from pymongo import ReturnDocument


RETENTION_POLICY_VERSION = 2
LEASE_SECONDS = 90
ELIGIBLE_STATUSES = ("closure_pending", "awaiting_operator_cleanup")


def _now():
    return datetime.now(timezone.utc)


async def account_cleanup_indexes(db):
    await db.account_deletions.create_index([
        ("operational_cleanup_completed_at", 1),
        ("operational_cleanup_lease_expires_at", 1),
    ])
    await db.account_deletions.create_index("retention_due_at")


async def _checkpoint(step_hook, step):
    if step_hook:
        await step_hook(step)


async def _renew_lease(db, user_id, lease_id, lease_seconds):
    changed = await db.account_deletions.update_one(
        {"_id": user_id, "operational_cleanup_lease_id": lease_id,
         "operational_cleanup_completed_at": {"$exists": False}},
        {"$set": {"operational_cleanup_lease_expires_at":
                  _now() + timedelta(seconds=lease_seconds)}},
    )
    if not changed.matched_count:
        raise RuntimeError("operational cleanup lease was lost")


@asynccontextmanager
async def _unlocked_call():
    yield


async def _remove_space_presence(
    db, deletion, user_id, lease_id, lease_seconds, reconcile_space, step_hook,
):
    pending = set(deletion.get("operational_cleanup_pending_space_ids") or [])
    cursor = None
    while True:
        await _renew_lease(db, user_id, lease_id, lease_seconds)
        query = {"members": user_id, "presence_connections": {"$ne": {}}}
        if cursor is not None:
            query["_id"] = {"$gt": cursor}
        spaces = await db.spaces.find(query, {"id": 1, "presence_connections": 1}).sort("_id", 1).limit(100).to_list(100)
        if not spaces:
            break
        for space in spaces:
            space_id = space.get("id")
            if not space_id:
                continue
            await _renew_lease(db, user_id, lease_id, lease_seconds)
            marker = await db.account_deletions.update_one(
                {"_id": user_id, "operational_cleanup_lease_id": lease_id},
                {"$addToSet": {"operational_cleanup_pending_space_ids": space_id}},
            )
            if not marker.matched_count:
                raise RuntimeError("operational cleanup lease was lost")
            pending.add(space_id)
            removed = False
            for _ in range(4):
                current = await db.spaces.find_one(
                    {"_id": space["_id"]}, {"presence_connections": 1},
                )
                if not current:
                    removed = True
                    break
                connections = current.get("presence_connections") or {}
                retained = {key: value for key, value in connections.items()
                            if value.get("user_id") != user_id}
                if retained == connections:
                    removed = True
                    break
                await _checkpoint(step_hook, "space_loaded")
                changed = await db.spaces.update_one(
                    {"_id": space["_id"], "presence_connections": connections},
                    {"$set": {"presence_connections": retained}},
                )
                if changed.modified_count:
                    removed = True
                    break
            if not removed:
                raise RuntimeError("Space presence changed too often to clean safely")
            await _checkpoint(step_hook, "space_presence")
        cursor = spaces[-1]["_id"]

    # Persisted pending IDs make a crash between removal and lifecycle repair retryable.
    for space_id in sorted(pending):
        await _renew_lease(db, user_id, lease_id, lease_seconds)
        if reconcile_space:
            await reconcile_space(space_id)
        current = await db.spaces.find_one({"id": space_id}, {"presence_connections": 1})
        if current and any(value.get("user_id") == user_id
                           for value in (current.get("presence_connections") or {}).values()):
            raise RuntimeError("closed account Space presence remains")
        await db.account_deletions.update_one(
            {"_id": user_id, "operational_cleanup_lease_id": lease_id},
            {"$pull": {"operational_cleanup_pending_space_ids": space_id}},
        )
        await _checkpoint(step_hook, "space_lifecycle")


async def cleanup_closed_account(
    db,
    user_id: str,
    *,
    reconcile_space=None,
    lease_seconds: int = LEASE_SECONDS,
    step_hook=None,
    call_lock=None,
):
    """Claim and converge one disabled account's operational cleanup.

    Concurrent workers use an expiring compare-and-set lease. Active or missing
    users are blocked without deleting anything. Provider bytes and shared
    history are intentionally outside this operation.
    """
    timestamp = _now()
    deletion = await db.account_deletions.find_one({"_id": user_id})
    if not deletion or deletion.get("status") not in ELIGIBLE_STATUSES:
        return {"state": "not_eligible"}
    if deletion.get("operational_cleanup_completed_at"):
        return {"state": "completed", "already_complete": True}

    user = await db.users.find_one({"id": user_id}, {"disabled": 1})
    if not user or user.get("disabled") is not True:
        reason = "user_missing" if not user else "user_is_active"
        await db.account_deletions.update_one(
            {"_id": user_id, "operational_cleanup_completed_at": {"$exists": False}},
            {"$set": {
                "cleanup_state": "blocked",
                "operational_cleanup_blocked_at": timestamp,
                "operational_cleanup_blocked_reason": reason,
                "operational_cleanup_retry_after": timestamp + timedelta(minutes=5),
                "retention_policy_version": RETENTION_POLICY_VERSION,
                "physical_erasure_completed": False,
            }},
        )
        return {"state": "blocked", "reason": reason}

    lease_id = str(uuid.uuid4())
    claimed = await db.account_deletions.find_one_and_update(
        {
            "_id": user_id,
            "status": {"$in": list(ELIGIBLE_STATUSES)},
            "operational_cleanup_completed_at": {"$exists": False},
            "$or": [
                {"operational_cleanup_lease_expires_at": {"$exists": False}},
                {"operational_cleanup_lease_expires_at": {"$lte": timestamp}},
            ],
        },
        {
            "$set": {
                "cleanup_state": "operational_cleanup",
                "operational_cleanup_started_at": timestamp,
                "operational_cleanup_lease_id": lease_id,
                "operational_cleanup_lease_expires_at": timestamp + timedelta(seconds=lease_seconds),
                "retention_policy_version": RETENTION_POLICY_VERSION,
                "retention_due_at": deletion.get("requested_at") or timestamp,
                "physical_erasure_completed": False,
            },
            "$unset": {
                "operational_cleanup_blocked_at": "",
                "operational_cleanup_blocked_reason": "",
                "operational_cleanup_last_error": "",
                "operational_cleanup_retry_after": "",
            },
            "$inc": {"operational_cleanup_attempts": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return {"state": "busy"}

    counts = {}
    try:
        await _renew_lease(db, user_id, lease_id, lease_seconds)
        counts["sessions_revoked"] = (await db.sessions.update_many(
            {"user_id": user_id, "revoked": {"$ne": True}}, {"$set": {"revoked": True}}
        )).modified_count
        await _checkpoint(step_hook, "sessions")
        for name in ("devices", "web_devices", "ws_tickets", "file_tickets", "account_codes"):
            await _renew_lease(db, user_id, lease_id, lease_seconds)
            counts[name + "_removed"] = (await db[name].delete_many({"user_id": user_id})).deleted_count
            await _checkpoint(step_hook, name)
        await _renew_lease(db, user_id, lease_id, lease_seconds)
        counts["invites_expired"] = (await db.invites.update_many(
            {"creator_id": user_id, "redeemed_by": None}, {"$set": {"expires_at": timestamp}}
        )).modified_count
        await _checkpoint(step_hook, "invites")

        await _renew_lease(db, user_id, lease_id, lease_seconds)
        active_calls = await db.calls.find(
            {"members": user_id, "status": {"$in": ["ringing", "active"]}},
            {"id": 1, "status": 1, "token_issued": 1},
        ).limit(100).to_list(100)
        await _checkpoint(step_hook, "call_loaded")
        call_ids = []
        ended_calls = 0
        for call in active_calls:
            await _renew_lease(db, user_id, lease_id, lease_seconds)
            call_ids.append(call["id"])
            lock = call_lock(call["id"]) if call_lock else _unlocked_call()
            async with lock:
                current = await db.calls.find_one(
                    {"id": call["id"]}, {"status": 1, "token_issued": 1},
                )
                if current and current.get("status") in ("ringing", "active"):
                    expected_token = bool(current.get("token_issued"))
                    token_query = True if expected_token else {"$ne": True}
                    changed = await db.calls.update_one(
                        {"id": call["id"], "status": current["status"],
                         "token_issued": token_query},
                        {"$set": {
                            "status": "completed",
                            "end_reason": "account_closed",
                            "ended_at": timestamp.isoformat(),
                            "expires_at": timestamp.isoformat(),
                            "revocation_pending": expected_token,
                        }},
                    )
                    if not changed.modified_count:
                        raise RuntimeError("active call changed during account cleanup")
                    ended_calls += 1
                terminal = await db.calls.find_one(
                    {"id": call["id"]}, {"status": 1, "token_issued": 1,
                                          "revocation_pending": 1},
                )
                if terminal and terminal.get("status") in ("ringing", "active"):
                    raise RuntimeError("active call changed during account cleanup")
                if terminal and terminal.get("token_issued") and not terminal.get("revocation_pending"):
                    raise RuntimeError("issued call media is not queued for revocation")
        lease_query = {"_id": user_id}
        if call_ids:
            lease_query = {"$or": [{"_id": user_id}, {"call_id": {"$in": call_ids}}]}
        counts["call_leases_removed"] = (await db.call_leases.delete_many(lease_query)).deleted_count
        counts["calls_ended"] = ended_calls
        await _checkpoint(step_hook, "calls")

        await _remove_space_presence(
            db, claimed, user_id, lease_id, lease_seconds, reconcile_space, step_hook,
        )
        pending = await db.account_deletions.find_one(
            {"_id": user_id, "operational_cleanup_lease_id": lease_id},
            {"operational_cleanup_pending_space_ids": 1},
        )
        if pending and pending.get("operational_cleanup_pending_space_ids"):
            raise RuntimeError("space lifecycle reconciliation remains pending")

        completed = _now()
        await _renew_lease(db, user_id, lease_id, lease_seconds)
        changed = await db.account_deletions.update_one(
            {"_id": user_id, "operational_cleanup_lease_id": lease_id},
            {
                "$set": {
                    "status": "awaiting_operator_cleanup",
                    "cleanup_state": "operational_cleanup_complete",
                    "operational_cleanup_completed_at": completed,
                    "operational_cleanup_counts": counts,
                    "retention_state": "physical_erasure_pending",
                    "physical_erasure_completed": False,
                },
                "$unset": {
                    "operational_cleanup_lease_id": "",
                    "operational_cleanup_lease_expires_at": "",
                    "operational_cleanup_last_error": "",
                },
            },
        )
        return {"state": "completed", "counts": counts} if changed.modified_count else {"state": "lease_lost"}
    except Exception as error:
        await db.account_deletions.update_one(
            {"_id": user_id, "operational_cleanup_lease_id": lease_id},
            {
                "$set": {
                    "cleanup_state": "retry_pending",
                    "operational_cleanup_last_error": type(error).__name__,
                    "operational_cleanup_lease_expires_at": _now(),
                }
            },
        )
        return {"state": "retry_pending", "error": type(error).__name__}


async def reconcile_account_closures(
    db, *, batch_size: int = 100, reconcile_space=None, call_lock=None,
):
    timestamp = _now()
    rows = await db.account_deletions.find({
        "status": {"$in": list(ELIGIBLE_STATUSES)},
        "operational_cleanup_completed_at": {"$exists": False},
        "$and": [
            {"$or": [
                {"operational_cleanup_lease_expires_at": {"$exists": False}},
                {"operational_cleanup_lease_expires_at": {"$lte": timestamp}},
            ]},
            {"$or": [
                {"operational_cleanup_retry_after": {"$exists": False}},
                {"operational_cleanup_retry_after": {"$lte": timestamp}},
            ]},
        ],
    }, {"_id": 1}).sort("_id", 1).limit(batch_size).to_list(batch_size)
    results = []
    for row in rows:
        results.append(await cleanup_closed_account(
            db, row["_id"], reconcile_space=reconcile_space, call_lock=call_lock,
        ))
    return results
