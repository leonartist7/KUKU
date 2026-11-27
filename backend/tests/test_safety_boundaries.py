"""F50 safety scenarios use isolated synthetic accounts, never live reports/contacts."""
from datetime import timedelta

import pytest

import server
from auth_service import now
from test_release import client, pair, headers


async def fill_blocks(owner, first_target=None):
    owner_id = owner["user"]["id"]
    created = now() - timedelta(days=2)
    rows = [{"_id": owner_id + ":" + (first_target if i == 0 and first_target else "fixture-" + str(i)),
             "owner_id": owner_id,
             "target_id": first_target if i == 0 and first_target else "fixture-" + str(i),
             "created_at": created} for i in range(200)]
    await server.db.blocks.insert_many(rows)
    return created


@pytest.mark.asyncio
async def test_f50_b01_existing_block_retries_at_capacity_without_changing_date(client):
    owner, target, _, _ = await pair(client)
    target_id = target["user"]["id"]
    created = await fill_blocks(owner, target_id)
    response = await client.post("/api/blocks/" + target_id, headers=headers(owner))
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    assert await server.db.blocks.count_documents({"owner_id": owner["user"]["id"]}) == 200
    saved = await server.db.blocks.find_one({"_id": owner["user"]["id"] + ":" + target_id})
    # Mongo stores millisecond precision; retry must not turn it into a fresh block.
    assert abs((saved["created_at"] - created).total_seconds()) < .001


@pytest.mark.asyncio
async def test_f50_b02_new_block_still_respects_capacity(client):
    owner, target, _, _ = await pair(client)
    await fill_blocks(owner)
    response = await client.post("/api/blocks/" + target["user"]["id"], headers=headers(owner))
    assert response.status_code == 400, response.text
    assert await server.db.blocks.count_documents({"owner_id": owner["user"]["id"]}) == 200
    assert not await server.db.blocks.find_one({"target_id": target["user"]["id"]})


async def revoke(owner, reason):
    uid = owner["user"]["id"]
    if reason == "logout":
        await server.db.sessions.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    else:
        await server.db.users.update_one({"id": uid},
            {"$set": {"email_verified": False} if reason == "verification" else {"disabled": True}})


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("logout", 401), ("verification", 403), ("closure", 401)])
async def test_f50_b03_b05_slow_block_cannot_mutate_after_account_revocation(client, monkeypatch, reason, status):
    owner, target, _, _ = await pair(client)
    original = server.auth.limit
    async def delayed_limit(key, *args):
        await original(key, *args)
        if key == "block:" + owner["user"]["id"]:
            await revoke(owner, reason)
    monkeypatch.setattr(server.auth, "limit", delayed_limit)
    response = await client.post("/api/blocks/" + target["user"]["id"], headers=headers(owner))
    assert response.status_code == status, response.text
    assert await server.db.blocks.count_documents({}) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("logout", 401), ("verification", 403), ("closure", 401)])
async def test_f50_b06_b08_slow_report_cannot_mutate_after_account_revocation(client, monkeypatch, reason, status):
    owner, target, _, _ = await pair(client)
    original = server.auth.limit
    async def delayed_limit(key, *args):
        await original(key, *args)
        if key == "report:" + owner["user"]["id"]:
            await revoke(owner, reason)
    monkeypatch.setattr(server.auth, "limit", delayed_limit)
    response = await client.post("/api/reports", headers=headers(owner),
        json={"target_id": target["user"]["id"], "reason": "spam", "note": "Synthetic report"})
    assert response.status_code == status, response.text
    assert await server.db.reports.count_documents({}) == 0


async def revoke_after_dependency(monkeypatch, owner):
    original = server.auth.session_user
    revoked = False
    async def loaded_session(sid, uid):
        nonlocal revoked
        user = await original(sid, uid)
        if uid == owner["user"]["id"] and not revoked:
            # The initial dependency has loaded its user. Another request revokes
            # that session before the safety handler finishes its own I/O.
            revoked = True
            await revoke(owner, "logout")
        return user
    monkeypatch.setattr(server.auth, "session_user", loaded_session)


@pytest.mark.asyncio
async def test_f50_b09_block_list_is_withheld_after_loaded_session_is_revoked(client, monkeypatch):
    owner, target, _, _ = await pair(client)
    assert (await client.post("/api/blocks/" + target["user"]["id"], headers=headers(owner))).status_code == 200
    await revoke_after_dependency(monkeypatch, owner)
    response = await client.get("/api/blocks", headers=headers(owner))
    assert response.status_code == 401, response.text
    assert target["user"]["name"] not in response.text
    assert target["user"]["id"] not in response.text


@pytest.mark.asyncio
async def test_f50_b10_unblock_cannot_remove_protection_after_loaded_session_is_revoked(client, monkeypatch):
    owner, target, _, _ = await pair(client)
    target_id = target["user"]["id"]
    assert (await client.post("/api/blocks/" + target_id, headers=headers(owner))).status_code == 200
    await revoke_after_dependency(monkeypatch, owner)
    response = await client.delete("/api/blocks/" + target_id, headers=headers(owner))
    assert response.status_code == 401, response.text
    assert await server.db.blocks.count_documents({"owner_id": owner["user"]["id"], "target_id": target_id}) == 1
