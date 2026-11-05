"""Closed-account retention uses synthetic metadata and provider doubles only."""
import asyncio
from datetime import timedelta

import pytest

import server
from auth_service import now
from storage_retention import cleanup_retained_objects
from test_release import account, client


async def closed_account(client, label, storage_bytes):
    person = await account(client, label)
    user_id = person["user"]["id"]
    await server.db.users.update_one(
        {"id": user_id}, {"$set": {"disabled": True, "storage_bytes": storage_bytes}},
    )
    await server.db.account_deletions.insert_one({
        "_id": user_id, "user_id": user_id, "status": "awaiting_operator_cleanup",
        "requested_at": now(), "operational_cleanup_completed_at": now(),
        "retention_object_cleanup_approved_at": now() - timedelta(minutes=10),
        "retention_policy_version": 2, "physical_erasure_completed": False,
    })
    return user_id


@pytest.mark.asyncio
async def test_retention_deletes_only_closed_account_orphans_and_releases_quota_once(client):
    closed_id = await closed_account(client, "closed", 150)
    other = await account(client, "other")
    other_id = other["user"]["id"]
    await server.db.users.update_one({"id": other_id}, {"$set": {"storage_bytes": 60}})
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 210})
    await server.db.attachments.insert_many([
        {"id": "orphan-file", "key": "attachments/orphan", "chat_id": "chat",
         "owner_id": closed_id, "size": 10, "storage_provider": "r2", "quota_version": 1},
        {"id": "shared-file", "key": "attachments/shared", "chat_id": "chat",
         "owner_id": closed_id, "size": 20, "storage_provider": "r2", "quota_version": 1},
        {"id": "other-file", "key": "attachments/other", "chat_id": "other-chat",
         "owner_id": other_id, "size": 60, "storage_provider": "r2", "quota_version": 1},
    ])
    await server.db.messages.insert_one({
        "id": "message", "chat_id": "chat", "attachment_id": "shared-file",
    })
    await server.db.audio_uploads.insert_many([
        {"id": "orphan-audio", "key": "space-audio/orphan", "uploader_id": closed_id,
         "size": 30, "storage_provider": "vercel", "quota_version": 1},
        {"id": "current-audio", "key": "space-audio/current", "uploader_id": closed_id,
         "size": 40, "storage_provider": "vercel", "quota_version": 1},
        {"id": "historic-audio", "key": "space-audio/history", "uploader_id": closed_id,
         "size": 50, "storage_provider": "vercel", "quota_version": 1},
    ])
    await server.db.spaces.insert_one({"id": "room", "content": {"upload_id": "current-audio"}})
    await server.db.space_sessions.insert_one({
        "id": "session", "content": {"upload_id": "historic-audio"},
    })
    deleted = []

    async def provider_delete(provider, key):
        deleted.append((provider, key))

    result = await cleanup_retained_objects(
        server.db, closed_id, provider_delete=provider_delete,
    )
    assert result["state"] == "completed"
    assert set(deleted) == {("r2", "attachments/orphan"),
                            ("vercel", "space-audio/orphan")}
    assert await server.db.attachments.find_one({"id": "orphan-file"}) is None
    assert await server.db.audio_uploads.find_one({"id": "orphan-audio"}) is None
    assert await server.db.attachments.find_one({"id": "shared-file"})
    assert await server.db.attachments.find_one({"id": "other-file"})
    assert await server.db.audio_uploads.find_one({"id": "current-audio"})
    assert await server.db.audio_uploads.find_one({"id": "historic-audio"})
    assert (await server.db.users.find_one({"id": closed_id}))["storage_bytes"] == 110
    assert (await server.db.users.find_one({"id": other_id}))["storage_bytes"] == 60
    assert (await server.db.storage_usage.find_one({"_id": "files"}))["bytes"] == 170
    deletion = await server.db.account_deletions.find_one({"_id": closed_id})
    assert deletion["retention_object_cleanup_state"] == "current_policy_complete"
    assert deletion["retention_object_cleanup_counts"]["completed"] == 2
    assert deletion["retention_state"] == "shared_history_and_physical_erasure_pending"
    assert deletion["physical_erasure_completed"] is False
    jobs = await server.db.storage_retention_jobs.find({"user_id": closed_id}).to_list(10)
    assert len(jobs) == 2 and all(job["state"] == "completed" for job in jobs)
    assert all("key" not in job for job in jobs)

    again = await cleanup_retained_objects(
        server.db, closed_id, provider_delete=provider_delete,
    )
    assert again == {"state": "completed", "already_complete": True}
    assert len(deleted) == 2
    assert (await server.db.storage_usage.find_one({"_id": "files"}))["bytes"] == 170


@pytest.mark.asyncio
async def test_retention_recovers_after_provider_delete_without_double_release(client):
    closed_id = await closed_account(client, "closed", 20)
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 20})
    await server.db.attachments.insert_one({
        "id": "crash-file", "key": "attachments/crash", "chat_id": "chat",
        "owner_id": closed_id, "size": 20, "storage_provider": "r2", "quota_version": 1,
    })
    provider_calls = []
    crashed = {"once": False}

    async def provider_delete(provider, key):
        provider_calls.append((provider, key))

    async def crash_after_provider(step, job_id):
        if step == "provider_deleted" and not crashed["once"]:
            crashed["once"] = True
            raise RuntimeError("synthetic crash without provider details")

    first = await cleanup_retained_objects(
        server.db, closed_id, provider_delete=provider_delete,
        step_hook=crash_after_provider,
    )
    assert first["state"] == "retry_pending"
    assert provider_calls == [("r2", "attachments/crash")]
    assert (await server.db.users.find_one({"id": closed_id}))["storage_bytes"] == 20
    assert (await server.db.storage_usage.find_one({"_id": "files"}))["bytes"] == 20
    deletion = await server.db.account_deletions.find_one({"_id": closed_id})
    assert deletion["retention_object_cleanup_last_error"] == "RuntimeError"
    assert "crash" not in deletion["retention_object_cleanup_last_error"]

    second = await cleanup_retained_objects(
        server.db, closed_id, provider_delete=provider_delete,
    )
    assert second["state"] == "completed"
    assert provider_calls == [("r2", "attachments/crash")]
    assert (await server.db.users.find_one({"id": closed_id}))["storage_bytes"] == 0
    assert (await server.db.storage_usage.find_one({"_id": "files"}))["bytes"] == 0
    assert await server.db.attachments.find_one({"id": "crash-file"}) is None


@pytest.mark.asyncio
async def test_retention_single_claim_and_active_user_fail_closed(client):
    closed_id = await closed_account(client, "closed", 5)
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 5})
    await server.db.attachments.insert_one({
        "id": "once", "key": "attachments/once", "chat_id": "chat",
        "owner_id": closed_id, "size": 5, "storage_provider": "r2", "quota_version": 1,
    })
    provider_calls = []

    async def provider_delete(provider, key):
        provider_calls.append((provider, key))
        await asyncio.sleep(0)

    results = await asyncio.gather(*(
        cleanup_retained_objects(server.db, closed_id, provider_delete=provider_delete)
        for _ in range(2)
    ))
    assert any(result["state"] == "completed" for result in results)
    assert len(provider_calls) == 1
    assert (await server.db.users.find_one({"id": closed_id}))["storage_bytes"] == 0

    active = await account(client, "active")
    active_id = active["user"]["id"]
    await server.db.users.update_one({"id": active_id}, {"$set": {"storage_bytes": 9}})
    await server.db.account_deletions.insert_one({
        "_id": active_id, "user_id": active_id, "status": "awaiting_operator_cleanup",
        "operational_cleanup_completed_at": now(), "retention_policy_version": 2,
        "retention_object_cleanup_approved_at": now() - timedelta(minutes=10),
        "physical_erasure_completed": False,
    })
    await server.db.attachments.insert_one({
        "id": "active-file", "key": "attachments/active", "chat_id": "chat",
        "owner_id": active_id, "size": 9, "storage_provider": "r2", "quota_version": 1,
    })
    before_calls = len(provider_calls)
    blocked = await cleanup_retained_objects(
        server.db, active_id, provider_delete=provider_delete,
    )
    assert blocked == {"state": "blocked", "reason": "user_is_active"}
    assert len(provider_calls) == before_calls
    assert await server.db.attachments.find_one({"id": "active-file"})
    active_deletion = await server.db.account_deletions.find_one({"_id": active_id})
    assert active_deletion["retention_object_cleanup_state"] == "blocked"
    assert active_deletion["physical_erasure_completed"] is False


@pytest.mark.asyncio
async def test_retention_requires_current_aged_approval_and_bounds_referenced_scan(client):
    user_id = await closed_account(client, "closed", 10)
    provider_calls = []

    async def provider_delete(provider, key):
        provider_calls.append((provider, key))

    await server.db.account_deletions.update_one(
        {"_id": user_id},
        {"$set": {"retention_object_cleanup_approved_at": now()}},
    )
    assert await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete,
    ) == {"state": "quarantine"}
    await server.db.account_deletions.update_one(
        {"_id": user_id},
        {"$set": {"retention_object_cleanup_approved_at": now() - timedelta(minutes=10),
                  "status": "completed"}},
    )
    assert await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete,
    ) == {"state": "not_eligible"}
    await server.db.account_deletions.update_one(
        {"_id": user_id}, {"$set": {"status": "awaiting_operator_cleanup"}},
    )
    for index in range(5):
        object_id = "shared-" + str(index)
        await server.db.attachments.insert_one({
            "id": object_id, "key": "attachments/" + object_id, "chat_id": "chat",
            "owner_id": user_id, "size": 2, "storage_provider": "r2", "quota_version": 1,
        })
        await server.db.messages.insert_one({
            "id": "message-" + str(index), "chat_id": "chat", "attachment_id": object_id,
        })
    bounded = await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete, scan_limit=2,
    )
    assert bounded["state"] == "retry_pending"
    assert bounded["counts"]["referenced_seen"] == 2
    assert provider_calls == []
    deletion = await server.db.account_deletions.find_one({"_id": user_id})
    assert deletion.get("retention_scan_cursor_attachment") is not None


@pytest.mark.asyncio
async def test_retention_rejects_unknown_provider_without_calling_it(client):
    user_id = await closed_account(client, "closed", 7)
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 7})
    await server.db.attachments.insert_one({
        "id": "invalid", "key": "attachments/invalid", "chat_id": "chat",
        "owner_id": user_id, "size": 7, "storage_provider": "unknown", "quota_version": 1,
    })
    provider_calls = []

    async def provider_delete(provider, key):
        provider_calls.append((provider, key))

    result = await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete,
    )
    assert result == {"state": "retry_pending", "error": "RuntimeError"}
    assert provider_calls == []
    assert await server.db.attachments.find_one({"id": "invalid"})
    assert (await server.db.users.find_one({"id": user_id}))["storage_bytes"] == 7
    deletion = await server.db.account_deletions.find_one({"_id": user_id})
    assert deletion["retention_object_cleanup_last_error"] == "RuntimeError"


@pytest.mark.asyncio
async def test_retention_reclaims_expired_object_lease(client):
    user_id = await closed_account(client, "closed", 8)
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 8})
    await server.db.attachments.insert_one({
        "id": "expired", "key": "attachments/expired", "chat_id": "chat",
        "owner_id": user_id, "size": 8, "storage_provider": "r2", "quota_version": 1,
    })
    await server.db.storage_retention_jobs.insert_one({
        "_id": "attachment:expired", "user_id": user_id, "kind": "attachment",
        "object_id": "expired", "provider": "r2", "key": "attachments/expired",
        "size": 8, "quota_version": 1, "state": "deleting",
        "lease_id": "dead-worker", "lease_expires_at": now() - timedelta(minutes=1),
    })
    calls = []

    async def provider_delete(provider, key):
        calls.append((provider, key))

    result = await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete,
    )
    assert result["state"] == "completed"
    assert calls == [("r2", "attachments/expired")]
    assert await server.db.attachments.find_one({"id": "expired"}) is None
    assert (await server.db.users.find_one({"id": user_id}))["storage_bytes"] == 0


@pytest.mark.asyncio
async def test_retention_revoked_approval_and_reactivated_user_fail_closed(client):
    user_id = await closed_account(client, "closed", 6)
    await server.db.storage_usage.insert_one({"_id": "files", "bytes": 6})
    await server.db.attachments.insert_one({
        "id": "approval", "key": "attachments/approval", "chat_id": "chat",
        "owner_id": user_id, "size": 6, "storage_provider": "r2", "quota_version": 1,
    })
    calls = []
    revoked = {"done": False}

    async def provider_delete(provider, key):
        calls.append((provider, key))

    async def revoke_before_job(step, job_id):
        if step == "before_job" and not revoked["done"]:
            revoked["done"] = True
            await server.db.account_deletions.update_one(
                {"_id": user_id}, {"$unset": {"retention_object_cleanup_approved_at": ""}},
            )

    waiting = await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete, step_hook=revoke_before_job,
    )
    assert waiting["state"] == "retry_pending"
    assert calls == []
    source = await server.db.attachments.find_one({"id": "approval"})
    assert source and "retention_state" not in source

    await server.db.account_deletions.update_one(
        {"_id": user_id},
        {"$set": {"retention_object_cleanup_approved_at": now() - timedelta(minutes=10)}},
    )
    reactivated = {"done": False}

    async def reactivate_before_job(step, job_id):
        if step == "before_job" and not reactivated["done"]:
            reactivated["done"] = True
            await server.db.users.update_one({"id": user_id}, {"$set": {"disabled": False}})

    blocked = await cleanup_retained_objects(
        server.db, user_id, provider_delete=provider_delete, step_hook=reactivate_before_job,
    )
    assert blocked["state"] == "blocked"
    deletion = await server.db.account_deletions.find_one({"_id": user_id})
    assert deletion["retention_object_cleanup_state"] == "blocked"
    assert deletion.get("retention_object_cleanup_completed_at") is None
    assert calls == []
