"""Restart-safe retention for unreferenced objects owned by closed accounts.

Only metadata-backed objects whose owner is independently confirmed disabled are
eligible. Shared chat attachments and current or historical Space audio remain
untouched. Completed jobs are retained as compact deletion tombstones.
"""
from datetime import datetime, timedelta, timezone
import uuid

from pymongo import ReturnDocument


POLICY_VERSION = 1
ACCOUNT_LEASE_SECONDS = 90
OBJECT_LEASE_SECONDS = 90
APPROVAL_QUARANTINE_SECONDS = 300
ELIGIBLE_JOB_STATES = ("pending", "retry_pending")


def _now():
    return datetime.now(timezone.utc)


def _as_utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def storage_retention_indexes(db):
    await db.account_deletions.create_index([
        ("retention_object_cleanup_completed_at", 1),
        ("retention_object_cleanup_lease_expires_at", 1),
    ])
    await db.storage_retention_jobs.create_index([
        ("user_id", 1), ("state", 1), ("lease_expires_at", 1),
    ])
    await db.attachments.create_index([("owner_id", 1), ("_id", 1)])
    await db.audio_uploads.create_index([("uploader_id", 1), ("_id", 1)])
    await db.messages.create_index("attachment_id")
    await db.spaces.create_index("content.upload_id")
    await db.space_sessions.create_index("content.upload_id")


async def _checkpoint(step_hook, step, job_id=None):
    if step_hook:
        await step_hook(step, job_id)


async def _renew_account_lease(db, user_id, lease_id, lease_seconds):
    cutoff = _now() - timedelta(seconds=APPROVAL_QUARANTINE_SECONDS)
    changed = await db.account_deletions.update_one(
        {"_id": user_id, "retention_object_cleanup_lease_id": lease_id,
         "status": "awaiting_operator_cleanup",
         "retention_object_cleanup_approved_at": {"$lte": cutoff},
         "retention_object_cleanup_completed_at": {"$exists": False}},
        {"$set": {"retention_object_cleanup_lease_expires_at":
                  _now() + timedelta(seconds=lease_seconds)}},
    )
    if not changed.matched_count:
        raise RuntimeError("retention account lease was lost")


async def _has_reference(db, kind, object_id):
    if kind == "attachment":
        return bool(await db.messages.find_one({"attachment_id": object_id}, {"_id": 1}))
    if await db.spaces.find_one({"content.upload_id": object_id}, {"_id": 1}):
        return True
    return bool(await db.space_sessions.find_one({"content.upload_id": object_id}, {"_id": 1}))


def _kind_config(kind):
    if kind == "attachment":
        return "attachments", "owner_id"
    if kind == "audio":
        return "audio_uploads", "uploader_id"
    raise RuntimeError("unsupported retention object kind")


def _validate_snapshot(kind, provider, key, size):
    limits = {"attachment": ("attachments/", 25 * 1024 * 1024),
              "audio": ("space-audio/", 10 * 1024 * 1024)}
    prefix, maximum = limits.get(kind, (None, None))
    if provider not in ("r2", "vercel") or not prefix or not isinstance(key, str):
        raise RuntimeError("invalid retention source metadata")
    if not key.startswith(prefix) or not 0 < int(size or 0) <= maximum:
        raise RuntimeError("invalid retention source metadata")


async def _discover_kind(db, deletion, user_id, lease_id, lease_seconds, kind,
                         remaining, scan_remaining, scan_page=100):
    collection_name, owner_field = _kind_config(kind)
    collection = db[collection_name]
    cursor_key = "retention_scan_cursor_" + kind
    cursor = deletion.get(cursor_key)
    created = referenced = 0
    complete = False
    while remaining > 0 and scan_remaining > 0:
        await _renew_account_lease(db, user_id, lease_id, lease_seconds)
        query = {owner_field: user_id, "key": {"$type": "string"}}
        if cursor is not None:
            query["_id"] = {"$gt": cursor}
        rows = await collection.find(query, {
            "id": 1, "key": 1, owner_field: 1, "size": 1,
            "storage_provider": 1, "quota_version": 1,
        }).sort("_id", 1).limit(min(scan_page, scan_remaining)).to_list(
            min(scan_page, scan_remaining))
        if not rows:
            complete = True
            await db.account_deletions.update_one(
                {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
                {"$unset": {cursor_key: ""},
                 "$addToSet": {"retention_scan_complete_kinds": kind}},
            )
            break
        for row in rows:
            if remaining <= 0 or scan_remaining <= 0:
                break
            scan_remaining -= 1
            cursor = row["_id"]
            if await _has_reference(db, kind, row["id"]):
                referenced += 1
            else:
                _validate_snapshot(
                    kind, row.get("storage_provider", "r2"), row.get("key"), row.get("size"),
                )
                job_id = kind + ":" + row["id"]
                result = await db.storage_retention_jobs.update_one(
                    {"_id": job_id},
                    {"$setOnInsert": {
                        "_id": job_id, "user_id": user_id, "kind": kind,
                        "object_id": row["id"], "provider": row.get("storage_provider", "r2"),
                        "key": row["key"], "size": int(row.get("size") or 0),
                        "quota_version": row.get("quota_version"),
                        "state": "pending", "created_at": _now(),
                        "policy_version": POLICY_VERSION,
                    }},
                    upsert=True,
                )
                created += int(bool(result.upserted_id))
                remaining -= 1
            await db.account_deletions.update_one(
                {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
                {"$set": {cursor_key: cursor}},
            )
        if len(rows) < scan_page:
            continue
    return {"created": created, "referenced_seen": referenced,
            "complete": complete, "remaining": remaining,
            "scan_remaining": scan_remaining}


async def _counter_release(collection, identity, field, token, size):
    doc = await collection.find_one(identity, {field: 1, "retention_release_tokens": 1})
    if not doc:
        raise RuntimeError("quota counter is missing")
    if token in (doc.get("retention_release_tokens") or []):
        return False
    if int(doc.get(field) or 0) < size:
        raise RuntimeError("quota counter would underflow")
    changed = await collection.update_one(
        {**identity, field: {"$gte": size}, "retention_release_tokens": {"$ne": token}},
        {"$inc": {field: -size}, "$addToSet": {"retention_release_tokens": token}},
    )
    if changed.modified_count:
        return True
    current = await collection.find_one(identity, {"retention_release_tokens": 1}) or {}
    if token not in (current.get("retention_release_tokens") or []):
        raise RuntimeError("quota release lost its compare-and-set")
    return False


async def _release_quota(db, job):
    if job.get("quota_version") != 1:
        return "legacy_untracked"
    size = int(job.get("size") or 0)
    if size <= 0:
        return "empty"
    token = job["_id"]
    await _counter_release(db.users, {"id": job["user_id"]},
                           "storage_bytes", token, size)
    await _counter_release(db.storage_usage, {"_id": "files"},
                           "bytes", token, size)
    return "released"


async def process_retention_job(db, job_id, *, provider_delete, step_hook=None,
                                lease_seconds=OBJECT_LEASE_SECONDS):
    timestamp = _now()
    lease_id = str(uuid.uuid4())
    job = await db.storage_retention_jobs.find_one_and_update(
        {"_id": job_id, "state": {"$in": [*ELIGIBLE_JOB_STATES, "deleting"]},
         "$or": [{"lease_expires_at": {"$exists": False}},
                 {"lease_expires_at": {"$lte": timestamp}}]},
        {"$set": {"state": "deleting", "lease_id": lease_id,
                  "lease_expires_at": timestamp + timedelta(seconds=lease_seconds),
                  "started_at": timestamp},
         "$unset": {"last_error": ""}, "$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not job:
        existing = await db.storage_retention_jobs.find_one({"_id": job_id}, {"state": 1})
        return {"state": (existing or {}).get("state", "busy")}
    try:
        user = await db.users.find_one({"id": job["user_id"]}, {"disabled": 1})
        if not user or user.get("disabled") is not True:
            reason = "user_missing" if not user else "user_is_active"
            await db.storage_retention_jobs.update_one(
                {"_id": job_id, "lease_id": lease_id},
                {"$set": {"state": "blocked", "blocked_reason": reason,
                          "blocked_at": _now()},
                 "$unset": {"lease_id": "", "lease_expires_at": "", "key": ""}},
            )
            return {"state": "blocked", "reason": reason}

        collection_name, owner_field = _kind_config(job["kind"])
        _validate_snapshot(job["kind"], job.get("provider"), job.get("key"), job.get("size"))
        collection = db[collection_name]
        source = await collection.find_one({"id": job["object_id"], owner_field: job["user_id"]})
        if source:
            immutable = (source.get("key"), source.get("storage_provider", "r2"),
                         int(source.get("size") or 0), source.get("quota_version"))
            expected = (job.get("key"), job.get("provider", "r2"),
                        int(job.get("size") or 0), job.get("quota_version"))
            if immutable != expected:
                raise RuntimeError("retention source changed")
        elif not job.get("provider_deleted_at"):
            raise RuntimeError("retention source disappeared before provider deletion")

        if source:
            quarantined = await collection.update_one(
                {"id": job["object_id"], owner_field: job["user_id"],
                 "key": job["key"],
                 "$or": [{"retention_state": {"$exists": False}},
                         {"retention_job_id": job_id}]},
                {"$set": {"retention_state": "deleting", "retention_job_id": job_id}},
            )
            if not quarantined.matched_count:
                raise RuntimeError("retention source is already reserved")

        if await _has_reference(db, job["kind"], job["object_id"]):
            if source:
                await collection.update_one(
                    {"id": job["object_id"], "retention_job_id": job_id},
                    {"$unset": {"retention_state": "", "retention_job_id": ""}},
                )
            await db.storage_retention_jobs.update_one(
                {"_id": job_id, "lease_id": lease_id},
                {"$set": {"state": "preserved", "preserved_at": _now(),
                          "preserved_reason": "referenced"},
                 "$unset": {"lease_id": "", "lease_expires_at": "", "key": ""}},
            )
            return {"state": "preserved"}

        if not job.get("provider_deleted_at"):
            if provider_delete is None:
                raise RuntimeError("provider deletion is unavailable")
            approval = await db.account_deletions.find_one({
                "_id": job["user_id"], "status": "awaiting_operator_cleanup",
                "retention_object_cleanup_approved_at": {
                    "$lte": _now() - timedelta(seconds=APPROVAL_QUARANTINE_SECONDS)},
                "physical_erasure_completed": {"$ne": True},
            }, {"_id": 1})
            if not approval:
                if source:
                    await collection.update_one(
                        {"id": job["object_id"], "retention_job_id": job_id},
                        {"$unset": {"retention_state": "", "retention_job_id": ""}},
                    )
                await db.storage_retention_jobs.update_one(
                    {"_id": job_id, "lease_id": lease_id},
                    {"$set": {"state": "pending"},
                     "$unset": {"lease_id": "", "lease_expires_at": ""}},
                )
                return {"state": "awaiting_approval"}
            # Await the underlying operation to termination. A timeout around a worker
            # thread would release this lease while the provider call kept running.
            await provider_delete(job["provider"], job["key"])
            marked = await db.storage_retention_jobs.update_one(
                {"_id": job_id, "lease_id": lease_id},
                {"$set": {"provider_deleted_at": _now(),
                          "lease_expires_at": _now() + timedelta(seconds=lease_seconds)}},
            )
            if not marked.matched_count:
                raise RuntimeError("retention object lease was lost")
            await _checkpoint(step_hook, "provider_deleted", job_id)

        quota_state = await _release_quota(db, job)
        await db.storage_retention_jobs.update_one(
            {"_id": job_id, "lease_id": lease_id},
            {"$set": {"quota_released_at": _now(), "quota_state": quota_state}},
        )
        await _checkpoint(step_hook, "quota_released", job_id)

        if source:
            removed = await collection.delete_one({
                "id": job["object_id"], owner_field: job["user_id"],
                "key": job["key"],
            })
            if not removed.deleted_count:
                raise RuntimeError("retention metadata changed before deletion")
        completed = _now()
        changed = await db.storage_retention_jobs.update_one(
            {"_id": job_id, "lease_id": lease_id},
            {"$set": {"state": "completed", "completed_at": completed},
             "$unset": {"lease_id": "", "lease_expires_at": "", "last_error": "", "key": ""}},
        )
        if not changed.modified_count:
            raise RuntimeError("retention object lease was lost")
        return {"state": "completed", "size": int(job.get("size") or 0)}
    except Exception as error:
        await db.storage_retention_jobs.update_one(
            {"_id": job_id, "lease_id": lease_id},
            {"$set": {"state": "retry_pending", "last_error": type(error).__name__,
                      "lease_expires_at": _now()}},
        )
        return {"state": "retry_pending", "error": type(error).__name__}


async def _account_counts(db, user_id):
    counts = {}
    for state in ("completed", "preserved", "retry_pending", "blocked"):
        counts[state] = await db.storage_retention_jobs.count_documents(
            {"user_id": user_id, "state": state})
    completed = await db.storage_retention_jobs.find(
        {"user_id": user_id, "state": "completed"}, {"size": 1}
    ).to_list(10000)
    counts["bytes_deleted"] = sum(int(row.get("size") or 0) for row in completed)
    return counts


async def cleanup_retained_objects(db, user_id, *, provider_delete,
                                   object_limit=20, lease_seconds=ACCOUNT_LEASE_SECONDS,
                                   scan_limit=200, step_hook=None):
    timestamp = _now()
    deletion = await db.account_deletions.find_one({"_id": user_id})
    if not deletion or not deletion.get("operational_cleanup_completed_at"):
        return {"state": "not_eligible"}
    if deletion.get("status") != "awaiting_operator_cleanup":
        return {"state": "not_eligible"}
    if not deletion.get("retention_object_cleanup_approved_at"):
        return {"state": "awaiting_approval"}
    if _as_utc(deletion["retention_object_cleanup_approved_at"]) > (
        timestamp - timedelta(seconds=APPROVAL_QUARANTINE_SECONDS)
    ):
        return {"state": "quarantine"}
    if deletion.get("retention_object_cleanup_completed_at"):
        return {"state": "completed", "already_complete": True}
    lease_id = str(uuid.uuid4())
    deletion = await db.account_deletions.find_one_and_update(
        {"_id": user_id, "status": "awaiting_operator_cleanup",
         "retention_policy_version": 2,
         "retention_object_cleanup_approved_at": {
             "$lte": timestamp - timedelta(seconds=APPROVAL_QUARANTINE_SECONDS)},
         "physical_erasure_completed": {"$ne": True},
         "operational_cleanup_completed_at": {"$exists": True},
         "retention_object_cleanup_completed_at": {"$exists": False},
         "$or": [{"retention_object_cleanup_lease_expires_at": {"$exists": False}},
                 {"retention_object_cleanup_lease_expires_at": {"$lte": timestamp}}]},
        {"$set": {"retention_object_cleanup_state": "scanning",
                  "retention_object_cleanup_lease_id": lease_id,
                  "retention_object_cleanup_lease_expires_at":
                      timestamp + timedelta(seconds=lease_seconds),
                  "retention_object_cleanup_started_at": timestamp,
                  "retention_object_policy_version": POLICY_VERSION},
         "$unset": {"retention_object_cleanup_last_error": "",
                    "retention_object_cleanup_retry_after": ""},
         "$inc": {"retention_object_cleanup_attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not deletion:
        return {"state": "busy"}
    user = await db.users.find_one({"id": user_id}, {"disabled": 1})
    if not user or user.get("disabled") is not True:
        reason = "user_missing" if not user else "user_is_active"
        await db.account_deletions.update_one(
            {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
            {"$set": {"retention_object_cleanup_state": "blocked",
                      "retention_object_cleanup_blocked_reason": reason,
                      "retention_object_cleanup_retry_after": timestamp + timedelta(minutes=5)},
             "$unset": {"retention_object_cleanup_lease_id": "",
                        "retention_object_cleanup_lease_expires_at": ""}},
        )
        return {"state": "blocked", "reason": reason}
    try:
        remaining = object_limit
        scan_remaining = scan_limit
        complete_kinds = set(deletion.get("retention_scan_complete_kinds") or [])
        discovery = {"created": 0, "referenced_seen": 0}
        for kind in ("attachment", "audio"):
            if kind in complete_kinds:
                continue
            result = await _discover_kind(
                db, deletion, user_id, lease_id, lease_seconds, kind,
                remaining, scan_remaining,
            )
            discovery["created"] += result["created"]
            discovery["referenced_seen"] += result["referenced_seen"]
            remaining = result["remaining"]
            scan_remaining = result["scan_remaining"]
            if result["complete"]:
                complete_kinds.add(kind)
            if remaining <= 0 or scan_remaining <= 0:
                break

        await _renew_account_lease(db, user_id, lease_id, lease_seconds)
        jobs = await db.storage_retention_jobs.find({
            "user_id": user_id,
            "state": {"$in": [*ELIGIBLE_JOB_STATES, "deleting"]},
            "$or": [{"lease_expires_at": {"$exists": False}},
                    {"lease_expires_at": {"$lte": _now()}}],
        }, {"_id": 1}).sort("_id", 1).limit(object_limit).to_list(object_limit)
        results = []
        for row in jobs:
            await _renew_account_lease(db, user_id, lease_id, lease_seconds)
            await _checkpoint(step_hook, "before_job", row["_id"])
            results.append(await process_retention_job(
                db, row["_id"], provider_delete=provider_delete, step_hook=step_hook,
            ))
        counts = await _account_counts(db, user_id)
        counts.update(discovery)
        pending = await db.storage_retention_jobs.count_documents({
            "user_id": user_id, "state": {"$in": ["pending", "retry_pending", "deleting"]},
        })
        complete_scan = complete_kinds == {"attachment", "audio"}
        if counts.get("blocked") or any(result.get("state") == "blocked" for result in results):
            await db.account_deletions.update_one(
                {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
                {"$set": {"retention_object_cleanup_state": "blocked",
                          "retention_object_cleanup_blocked_reason": "object_blocked",
                          "retention_object_cleanup_counts": counts},
                 "$unset": {"retention_object_cleanup_lease_id": "",
                            "retention_object_cleanup_lease_expires_at": ""}},
            )
            return {"state": "blocked", "counts": counts}
        if pending or not complete_scan or any(
                result.get("state") in ("retry_pending", "awaiting_approval")
                for result in results):
            retry_error = next((result.get("error") for result in results
                                if result.get("error")), None)
            status = {"retention_object_cleanup_state": "retry_pending",
                      "retention_object_cleanup_counts": counts,
                      "retention_object_cleanup_retry_after": _now() + timedelta(seconds=15)}
            if retry_error:
                status["retention_object_cleanup_last_error"] = retry_error
            await db.account_deletions.update_one(
                {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
                {"$set": status,
                 "$unset": {"retention_object_cleanup_lease_id": "",
                            "retention_object_cleanup_lease_expires_at": ""}},
            )
            return {"state": "retry_pending", "counts": counts}

        completed = _now()
        changed = await db.account_deletions.update_one(
            {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
            {"$set": {"retention_object_cleanup_state": "current_policy_complete",
                      "retention_object_cleanup_completed_at": completed,
                      "retention_object_cleanup_counts": counts,
                      "retention_state": "shared_history_and_physical_erasure_pending",
                      "physical_erasure_completed": False},
             "$unset": {"retention_object_cleanup_lease_id": "",
                        "retention_object_cleanup_lease_expires_at": "",
                        "retention_object_cleanup_last_error": "",
                        "retention_object_cleanup_retry_after": ""}},
        )
        return {"state": "completed", "counts": counts} if changed.modified_count else {"state": "lease_lost"}
    except Exception as error:
        await db.account_deletions.update_one(
            {"_id": user_id, "retention_object_cleanup_lease_id": lease_id},
            {"$set": {"retention_object_cleanup_state": "retry_pending",
                      "retention_object_cleanup_last_error": type(error).__name__,
                      "retention_object_cleanup_retry_after": _now() + timedelta(minutes=1)},
             "$unset": {"retention_object_cleanup_lease_id": "",
                        "retention_object_cleanup_lease_expires_at": ""}},
        )
        return {"state": "retry_pending", "error": type(error).__name__}


async def reconcile_storage_retention(db, *, provider_delete, batch_size=20, object_limit=20):
    timestamp = _now()
    rows = await db.account_deletions.find({
        "status": "awaiting_operator_cleanup",
        "retention_policy_version": 2,
        "retention_object_cleanup_approved_at": {
            "$lte": timestamp - timedelta(seconds=APPROVAL_QUARANTINE_SECONDS)},
        "operational_cleanup_completed_at": {"$exists": True},
        "physical_erasure_completed": {"$ne": True},
        "retention_object_cleanup_completed_at": {"$exists": False},
        "$and": [
            {"$or": [{"retention_object_cleanup_lease_expires_at": {"$exists": False}},
                     {"retention_object_cleanup_lease_expires_at": {"$lte": timestamp}}]},
            {"$or": [{"retention_object_cleanup_retry_after": {"$exists": False}},
                     {"retention_object_cleanup_retry_after": {"$lte": timestamp}}]},
        ],
    }, {"_id": 1}).sort("_id", 1).limit(batch_size).to_list(batch_size)
    results = []
    for row in rows:
        results.append(await cleanup_retained_objects(
            db, row["_id"], provider_delete=provider_delete, object_limit=object_limit,
        ))
    return results
