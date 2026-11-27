"""Closed-account cleanup uses only isolated synthetic records."""
import asyncio
from datetime import timedelta

import pytest

import server
from account_cleanup import cleanup_closed_account, reconcile_account_closures
from auth_service import now
from test_release import account, client


@pytest.mark.asyncio
async def test_expired_cleanup_lease_converges_ephemeral_state_and_preserves_other_account(client):
    closed = await account(client, "closed")
    other = await account(client, "other")
    closed_id, other_id = closed["user"]["id"], other["user"]["id"]
    await server.db.users.update_one({"id": closed_id}, {"$set": {"disabled": True}})
    await server.db.account_deletions.insert_one({
        "_id": closed_id, "user_id": closed_id, "status": "awaiting_operator_cleanup",
        "requested_at": now() - timedelta(minutes=5), "physical_erasure_completed": False,
        "cleanup_state": "operational_cleanup",
        "operational_cleanup_lease_id": "crashed-worker",
        "operational_cleanup_lease_expires_at": now() - timedelta(seconds=1),
    })
    for name in ("devices", "web_devices", "ws_tickets", "file_tickets"):
        await server.db[name].insert_one({"_id": name + "-closed", "user_id": closed_id})
        await server.db[name].insert_one({"_id": name + "-other", "user_id": other_id})
    await server.db.account_codes.insert_one({"_id": "code", "user_id": closed_id})
    await server.db.invites.insert_one({
        "_id": "invite", "creator_id": closed_id, "redeemed_by": None,
        "expires_at": now() + timedelta(days=1),
    })
    await server.db.calls.insert_one({
        "id": "active-call", "members": [closed_id, other_id], "status": "active",
        "token_issued": True,
    })
    await server.db.call_leases.insert_many([
        {"_id": closed_id, "call_id": "active-call"},
        {"_id": other_id, "call_id": "active-call"},
    ])
    await server.db.spaces.insert_one({
        "id": "room", "members": [closed_id, other_id], "creator_id": closed_id,
        "presence_connections": {
            "closed-tab": {"user_id": closed_id, "session_id": "closed-session", "at": now().isoformat(),
                           "expires_at": (now() + timedelta(minutes=1)).isoformat()},
            "other-tab": {"user_id": other_id, "session_id": "other-session", "at": now().isoformat(),
                          "expires_at": (now() + timedelta(minutes=1)).isoformat()},
        },
        "state": {"host_id": closed_id, "is_playing": False, "position_sec": 0, "updated_at": now().isoformat()},
        "version": 1, "session_open": True,
    })

    result = await cleanup_closed_account(
        server.db, closed_id, reconcile_space=server._reconcile_space_lifecycle,
    )
    assert result["state"] == "completed"
    for name in ("devices", "web_devices", "ws_tickets", "file_tickets"):
        assert await server.db[name].count_documents({"user_id": closed_id}) == 0
        assert await server.db[name].count_documents({"user_id": other_id}) == 1
    assert await server.db.account_codes.count_documents({"user_id": closed_id}) == 0
    assert (await server.db.invites.find_one({"_id": "invite"}))["expires_at"] <= now()
    assert await server.db.call_leases.count_documents({"call_id": "active-call"}) == 0
    call = await server.db.calls.find_one({"id": "active-call"})
    assert call["status"] == "completed" and call["end_reason"] == "account_closed"
    assert call["revocation_pending"] is True
    room = await server.db.spaces.find_one({"id": "room"})
    assert set(room["presence_connections"]) == {"other-tab"}
    assert room["state"]["host_id"] == other_id
    deletion = await server.db.account_deletions.find_one({"_id": closed_id})
    assert deletion["cleanup_state"] == "operational_cleanup_complete"
    assert deletion["operational_cleanup_attempts"] == 1
    assert deletion["retention_policy_version"] == 2
    assert deletion["retention_state"] == "physical_erasure_pending"
    assert deletion["physical_erasure_completed"] is False


@pytest.mark.asyncio
async def test_cleanup_is_single_claim_idempotent_under_concurrency(client):
    person = await account(client, "closed")
    user_id = person["user"]["id"]
    await server.db.users.update_one({"id": user_id}, {"$set": {"disabled": True}})
    await server.db.account_deletions.insert_one({
        "_id": user_id, "user_id": user_id, "status": "awaiting_operator_cleanup",
        "requested_at": now(), "physical_erasure_completed": False,
    })
    await server.db.devices.insert_one({"_id": "once", "user_id": user_id})
    results = await asyncio.gather(*(
        cleanup_closed_account(server.db, user_id) for _ in range(2)
    ))
    assert any(result["state"] == "completed" for result in results)
    deletion = await server.db.account_deletions.find_one({"_id": user_id})
    assert deletion["operational_cleanup_attempts"] == 1
    assert await server.db.devices.count_documents({"user_id": user_id}) == 0
    again = await cleanup_closed_account(server.db, user_id)
    assert again == {"state": "completed", "already_complete": True}


@pytest.mark.asyncio
async def test_cleanup_fails_closed_for_active_or_missing_users(client):
    active = await account(client, "active")
    active_id = active["user"]["id"]
    for user_id in (active_id, "missing-user"):
        await server.db.account_deletions.insert_one({
            "_id": user_id, "user_id": user_id, "status": "closure_pending",
            "requested_at": now(), "physical_erasure_completed": False,
        })
        await server.db.devices.insert_one({"_id": "device-" + user_id, "user_id": user_id})
    results = await reconcile_account_closures(server.db)
    assert {result["reason"] for result in results} == {"user_is_active", "user_missing"}
    assert await server.db.devices.count_documents({}) == 2
    for user_id in (active_id, "missing-user"):
        deletion = await server.db.account_deletions.find_one({"_id": user_id})
        assert deletion["cleanup_state"] == "blocked"
        assert deletion["physical_erasure_completed"] is False


@pytest.mark.asyncio
async def test_cleanup_retries_space_cas_and_wins_ringing_to_active_call_race(client):
    closed = await account(client, "closed")
    other = await account(client, "other")
    closed_id, other_id = closed["user"]["id"], other["user"]["id"]
    await server.db.users.update_one({"id": closed_id}, {"$set": {"disabled": True}})
    await server.db.account_deletions.insert_one({
        "_id": closed_id, "user_id": closed_id, "status": "awaiting_operator_cleanup",
        "requested_at": now(), "physical_erasure_completed": False,
    })
    await server.db.calls.insert_one({
        "id": "racing-call", "members": [closed_id, other_id], "status": "ringing",
        "token_issued": False,
    })
    await server.db.call_leases.insert_many([
        {"_id": closed_id, "call_id": "racing-call"},
        {"_id": other_id, "call_id": "racing-call"},
    ])
    base_presence = {
        "closed-tab": {"user_id": closed_id},
        "other-tab": {"user_id": other_id},
    }
    await server.db.spaces.insert_one({
        "id": "racing-room", "members": [closed_id, other_id],
        "presence_connections": base_presence,
    })
    raced = {"space": False, "call": False}

    async def inject_races(step):
        if step == "space_loaded" and not raced["space"]:
            raced["space"] = True
            await server.db.spaces.update_one(
                {"id": "racing-room"},
                {"$set": {"presence_connections.new-tab": {"user_id": other_id}}},
            )
        if step == "call_loaded" and not raced["call"]:
            raced["call"] = True
            await server.db.calls.update_one(
                {"id": "racing-call", "status": "ringing"},
                {"$set": {"status": "active"}},
            )

    result = await cleanup_closed_account(server.db, closed_id, step_hook=inject_races)
    assert result["state"] == "completed"
    assert raced == {"space": True, "call": True}
    room = await server.db.spaces.find_one({"id": "racing-room"})
    assert "closed-tab" not in room["presence_connections"]
    assert set(room["presence_connections"]) == {"other-tab", "new-tab"}
    call = await server.db.calls.find_one({"id": "racing-call"})
    assert call["status"] == "completed" and call["end_reason"] == "account_closed"
    assert await server.db.call_leases.count_documents({"call_id": "racing-call"}) == 0
