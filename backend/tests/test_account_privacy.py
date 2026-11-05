"""Account snapshots/closure use synthetic users and never contact providers."""
from datetime import timedelta

import pytest
from test_release import client, account, pair, headers
import server
from auth_service import now
from account_privacy import export_cursor


@pytest.mark.asyncio
async def test_export_is_scoped_paginated_and_omits_secrets(client):
    a, b, outsider, chat_id = await pair(client)
    for index in range(5):
        await server.db.messages.insert_one({
            "id": "export-" + str(index), "sender_id": a["user"]["id"], "chat_id": chat_id,
            "type": "text", "text": "my text " + str(index), "created_at": now().isoformat(),
            "private_debug": "never-export", "push_error": "never-export",
        })
    await server.db.messages.insert_one({
        "id": "someone-else", "sender_id": b["user"]["id"], "chat_id": chat_id,
        "type": "text", "text": "not mine",
    })
    first = await client.get("/api/account/export?section=messages&limit=2", headers=headers(a))
    assert first.status_code == 200, first.text
    body = first.json()
    assert len(body["items"]) == 2 and body["next_cursor"]
    assert "private_debug" not in first.text and "push_error" not in first.text and "not mine" not in first.text
    ids = [item["id"] for item in body["items"]]
    while body["next_cursor"]:
        page = await client.get("/api/account/export", headers=headers(a),
            params={"section": "messages", "limit": 2, "cursor": body["next_cursor"]})
        assert page.status_code == 200
        body = page.json()
        ids.extend(item["id"] for item in body["items"])
    assert ids == ["export-" + str(index) for index in range(5)]
    assert (await client.get("/api/account/export?section=messages", headers=headers(outsider))).json()["items"] == []
    profile = await client.get("/api/account/export?section=profile", headers=headers(a))
    assert profile.status_code == 200
    assert profile.json()["items"][0]["email"] == "alice@example.com"
    for key in ("password_hash", "_session_id", "refresh_token", "token", "invited_by", "_id"):
        assert key not in profile.json()["items"][0]


@pytest.mark.asyncio
async def test_export_metadata_never_returns_storage_urls_or_other_members(client):
    a, b, _, chat_id = await pair(client)
    await server.db.attachments.insert_one({
        "id": "mine", "owner_id": a["user"]["id"], "chat_id": chat_id, "name": "family.jpg",
        "size": 123, "key": "secret-blob-key", "provider_url": "https://private.example/secret",
        "storage_provider": "vercel", "created_at": now(),
    })
    await server.db.attachments.insert_one({"id": "theirs", "owner_id": b["user"]["id"], "chat_id": chat_id, "name": "not-mine"})
    await server.db.spaces.insert_one({
        "id": "my-space", "name": "Quiet room", "members": [a["user"]["id"], b["user"]["id"]],
        "content": {"data_url": "private-data"}, "owner_id": b["user"]["id"],
    })
    files = (await client.get("/api/account/export?section=attachments", headers=headers(a))).json()
    assert len(files["items"]) == 1 and files["items"][0]["name"] == "family.jpg"
    assert "secret" not in str(files) and "storage_provider" not in str(files)
    spaces = (await client.get("/api/account/export?section=spaces", headers=headers(a))).json()
    assert spaces["items"] == [{"id": "my-space", "name": "Quiet room"}]
    assert b["user"]["id"] not in str(spaces)


@pytest.mark.asyncio
async def test_export_cursors_cannot_cross_accounts_sections_or_expiry(client):
    a, b, _, _ = await pair(client)
    cursor = export_cursor(a["user"]["id"], "messages", "last")
    for owner, section, token in [
        (b, "messages", cursor), (a, "attachments", cursor), (a, "messages", cursor + "tampered"),
    ]:
        response = await client.get("/api/account/export", headers=headers(owner),
            params={"section": section, "cursor": token})
        assert response.status_code == 400
    import jwt, settings
    expired = jwt.encode({
        "sub": a["user"]["id"], "section": "messages", "after": "last", "type": "account_export",
        "iss": "kuku", "aud": "account-export", "exp": now() - timedelta(seconds=1),
    }, settings.JWT_SECRET, algorithm="HS256")
    assert (await client.get("/api/account/export", headers=headers(a),
        params={"section": "messages", "cursor": expired})).status_code == 400
    assert (await client.get("/api/account/export?section=sessions", headers=headers(a))).status_code == 422
    assert (await client.get("/api/account/export?limit=101", headers=headers(a))).status_code == 422


@pytest.mark.asyncio
async def test_export_requires_current_verified_account(client):
    a = await account(client, "alice")
    assert (await client.get("/api/account/export")).status_code == 401
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"email_verified": False}})
    assert (await client.get("/api/account/export", headers=headers(a))).status_code == 403
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"email_verified": True}})
    await client.post("/api/auth/logout", headers=headers(a))
    assert (await client.get("/api/account/export", headers=headers(a))).status_code == 401


@pytest.mark.asyncio
async def test_closure_needs_password_exact_confirmation_and_safe_origin(client):
    a = await account(client, "alice")
    for payload, expected in [
        ({"password": "wrong", "confirmation": "DELETE"}, 400),
        ({"password": "a-long-test-passphrase", "confirmation": "delete"}, 422),
        ({"password": "a-long-test-passphrase", "confirmation": "DELETE", "user_id": "else"}, 422),
    ]:
        response = await client.post("/api/account/close", headers=headers(a), json=payload)
        assert response.status_code == expected
    assert not (await server.db.users.find_one({"id": a["user"]["id"]})).get("disabled")
    assert await server.db.account_deletions.count_documents({}) == 0
    denied = await client.post("/api/account/close",
        headers={**headers(a), "X-Kuku-Platform": "web", "Origin": "https://evil.example"},
        json={"password": "a-long-test-passphrase", "confirmation": "DELETE"})
    assert denied.status_code == 403


class ClosingSocket:
    def __init__(self):
        self.code = None

    async def close(self, code):
        self.code = code


@pytest.mark.asyncio
async def test_closure_revokes_devices_and_sessions_but_does_not_claim_erasure(client):
    a, b, _, chat_id = await pair(client)
    second = (await client.post("/api/auth/login", json={"email": "alice@example.com", "password": "a-long-test-passphrase"})).json()
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"avatar": "personal-photo", "bio": "personal bio"}})
    await server.db.devices.insert_one({"_id": "mine", "user_id": a["user"]["id"], "session_id": "old"})
    await server.db.web_devices.insert_one({"_id": "mine", "user_id": a["user"]["id"], "session_id": "old"})
    await server.db.web_devices.insert_one({"_id": "theirs", "user_id": b["user"]["id"], "session_id": "other"})
    await server.db.file_tickets.insert_one({"_id": "mine", "user_id": a["user"]["id"]})
    await server.db.ws_tickets.insert_one({"_id": "mine", "user_id": a["user"]["id"]})
    await server.db.invites.insert_one({"_id": "unused", "creator_id": a["user"]["id"], "redeemed_by": None, "expires_at": now() + timedelta(days=1)})
    await server.db.messages.insert_one({"id": "history", "sender_id": a["user"]["id"], "chat_id": chat_id, "type": "text", "text": "shared"})
    await server.db.attachments.insert_one({"id": "file", "owner_id": a["user"]["id"], "chat_id": chat_id, "key": "private-provider-object"})
    sessions = await server.db.sessions.find({"user_id": a["user"]["id"]}).to_list(10)
    socket = ClosingSocket()
    server.auth.sockets[sessions[0]["_id"]] = {socket}
    closed = await client.post("/api/account/close", headers=headers(a),
        json={"password": "a-long-test-passphrase", "confirmation": "DELETE"})
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    assert closed.json()["data_deletion"] == "awaiting_operator_cleanup"
    assert closed.json()["operational_cleanup"] == "completed"
    assert closed.json()["retention_policy_version"] == 2
    assert closed.json()["physical_erasure_completed"] is False
    assert socket.code == 4401
    assert await server.db.sessions.count_documents({"user_id": a["user"]["id"], "revoked": False}) == 0
    assert await server.db.devices.count_documents({"user_id": a["user"]["id"]}) == 0
    assert await server.db.web_devices.count_documents({"user_id": a["user"]["id"]}) == 0
    assert await server.db.web_devices.count_documents({"user_id": b["user"]["id"]}) == 1
    assert await server.db.file_tickets.count_documents({"user_id": a["user"]["id"]}) == 0
    assert await server.db.ws_tickets.count_documents({"user_id": a["user"]["id"]}) == 0
    assert (await client.get("/api/auth/me", headers=headers(second))).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": "alice@example.com", "password": "a-long-test-passphrase"})).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]})).status_code == 401
    user = await server.db.users.find_one({"id": a["user"]["id"]})
    assert user["disabled"] and user["avatar"] is None and user["bio"] == "" and user["name"] == "Former member"
    request = await server.db.account_deletions.find_one({"_id": a["user"]["id"]})
    assert request["status"] == "awaiting_operator_cleanup"
    assert request["cleanup_state"] == "operational_cleanup_complete"
    assert await server.db.messages.count_documents({"id": "history"}) == 1
    assert await server.db.attachments.count_documents({"id": "file"}) == 1
    assert (await server.db.invites.find_one({"_id": "unused"}))["expires_at"] <= now()
    assert (await client.get("/api/auth/me", headers=headers(b))).status_code == 200

