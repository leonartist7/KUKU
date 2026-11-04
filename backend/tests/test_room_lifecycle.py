"""Room and call lifecycle regressions; synthetic accounts, no real media provider."""
import asyncio
import base64
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import pytest_asyncio
from test_release import client, account, pair, headers, private_files, ticket_path
import server
from auth_service import digest, now


@pytest_asyncio.fixture
async def rooms(client):
    await server.db.space_messages.create_index(
        [("space_id", 1), ("sender_id", 1), ("client_message_id", 1)],
        unique=True, partialFilterExpression={"client_message_id": {"$type": "string"}})
    a, b, c, _ = await pair(client)
    response = await client.post("/api/spaces", headers=headers(a),
        json={"name": "Together", "member_ids": [b["user"]["id"]]})
    assert response.status_code == 200, response.text
    return a, b, c, response.json()["id"]


@pytest_asyncio.fixture
async def calls(client, monkeypatch):
    monkeypatch.setattr(server.settings, "ENABLE_CALLS", True)
    monkeypatch.setattr(server, "LIVEKIT_URL", "wss://fixture.livekit.example")
    monkeypatch.setattr(server, "LIVEKIT_API_KEY", "fixture-key")
    monkeypatch.setattr(server, "LIVEKIT_API_SECRET", "fixture-secret-value-is-long-enough")
    a, b, c, _ = await pair(client)
    return a, b, c


async def join(client, person, sid, connection):
    result = await client.post("/api/spaces/" + sid + "/join",
        headers=headers(person), json={"connection_id": connection})
    assert result.status_code == 200, result.text
    return result.json()


async def choose_video(client, person, sid):
    response = await client.post("/api/spaces/" + sid + "/content",
        headers=headers(person), json={"type": "youtube", "url": "https://youtu.be/dQw4w9WgXcQ"})
    assert response.status_code == 200, response.text
    return response.json()


async def make_call(client, a, b):
    result = await client.post("/api/calls", headers=headers(a), json={"other_user_id": b["user"]["id"]})
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.asyncio
async def test_space_content_requires_host_and_versions_are_authoritative(client, rooms):
    a, b, c, sid = rooms
    await join(client, a, sid, "alice-tab")
    await join(client, b, sid, "bob-tab")
    body = {"type": "youtube", "url": "https://youtu.be/dQw4w9WgXcQ"}
    assert (await client.post("/api/spaces/" + sid + "/content", headers=headers(b), json=body)).status_code == 403
    assert (await client.post("/api/spaces/" + sid + "/content", headers=headers(c), json=body)).status_code == 404
    chosen = await choose_video(client, a, sid)
    state = chosen["state"]
    assert state["version"] > 0 and state["session_id"] and state["server_time"]
    changed = await client.post("/api/spaces/" + sid + "/state", headers=headers(a),
        json={"is_playing": False, "position_sec": 12, "expected_version": state["version"]})
    assert changed.status_code == 200 and changed.json()["version"] > state["version"]
    assert (await client.post("/api/spaces/" + sid + "/state", headers=headers(a),
        json={"is_playing": True, "position_sec": 0, "expected_version": state["version"]})).status_code == 409
    assert (await client.post("/api/spaces/" + sid + "/state", headers=headers(a),
        content='{"is_playing":true,"position_sec":NaN}')).status_code == 422


@pytest.mark.asyncio
async def test_presence_is_connection_scoped_and_host_handoff_is_explicit(client, rooms):
    a, b, c, sid = rooms
    await join(client, a, sid, "alice-first")
    await join(client, a, sid, "alice-second")
    await join(client, b, sid, "bob-first")
    await choose_video(client, a, sid)
    await client.post("/api/spaces/" + sid + "/leave", headers=headers(a), json={"connection_id": "alice-first"})
    space = (await client.get("/api/spaces/" + sid, headers=headers(b))).json()
    assert set(space["active_members"]) == {a["user"]["id"], b["user"]["id"]}
    assert space["state"]["host_id"] == a["user"]["id"]
    assert (await client.post("/api/spaces/" + sid + "/host", headers=headers(b),
        json={"user_id": b["user"]["id"]})).status_code == 403
    transferred = await client.post("/api/spaces/" + sid + "/host", headers=headers(a),
        json={"user_id": b["user"]["id"]})
    assert transferred.status_code == 200 and transferred.json()["state"]["host_id"] == b["user"]["id"]
    assert (await client.post("/api/spaces/" + sid + "/state", headers=headers(a),
        json={"is_playing": False, "position_sec": 2})).status_code == 403


@pytest.mark.asyncio
async def test_host_departure_and_repeated_leave_create_one_session_memory(client, rooms):
    a, b, _, sid = rooms
    await join(client, a, sid, "alice")
    await join(client, b, sid, "bob")
    await choose_video(client, a, sid)
    await client.post("/api/spaces/" + sid + "/leave", headers=headers(a), json={"connection_id": "alice"})
    room = (await client.get("/api/spaces/" + sid, headers=headers(b))).json()
    assert room["state"]["host_id"] == b["user"]["id"] and room["state"]["is_playing"]
    for _ in range(2):
        assert (await client.post("/api/spaces/" + sid + "/leave", headers=headers(b),
            json={"connection_id": "bob"})).status_code == 200
    assert await server.db.space_sessions.count_documents({"space_id": sid}) == 1
    room = (await client.get("/api/spaces/" + sid, headers=headers(a))).json()
    assert not room["active_members"] and not room["state"]["is_playing"]


@pytest.mark.asyncio
async def test_expired_presence_is_not_reported_and_stale_socket_cannot_remove_new_connection(client, rooms):
    a, b, _, sid = rooms
    person = await server.db.users.find_one({"id": a["user"]["id"]})
    person["_session_id"] = jwt.decode(a["token"], server.settings.JWT_SECRET, algorithms=["HS256"])["sid"]
    await server._touch_space_connection(sid, person, "same-tab", socket_id="old-socket")
    await server._touch_space_connection(sid, person, "same-tab", socket_id="new-socket")
    await server._remove_space_connection(sid, person, "same-tab", socket_id="old-socket")
    assert a["user"]["id"] in (await client.get("/api/spaces/" + sid, headers=headers(a))).json()["active_members"]
    await server.db.spaces.update_one({"id": sid}, {"$set": {
        "presence_connections.same-tab.expires_at": (now() - timedelta(seconds=1)).isoformat()}})
    room = (await client.get("/api/spaces/" + sid, headers=headers(a))).json()
    assert room["active_members"] == []


@pytest.mark.asyncio
async def test_connection_id_cannot_be_stolen_by_another_member(client, rooms):
    a, b, _, sid = rooms
    await join(client, a, sid, "alice-device")
    assert (await client.post("/api/spaces/" + sid + "/join", headers=headers(b),
        json={"connection_id": "alice-device"})).status_code == 409
    assert (await client.post("/api/spaces/" + sid + "/leave", headers=headers(b),
        json={"connection_id": "alice-device"})).status_code == 200
    assert a["user"]["id"] in (await client.get("/api/spaces/" + sid, headers=headers(a))).json()["active_members"]


@pytest.mark.asyncio
async def test_space_messages_replay_once_reject_changed_text_and_paginate(client, rooms):
    a, b, c, sid = rooms
    path = "/api/spaces/" + sid + "/messages"
    async def send():
        return await client.post(path, headers=headers(a), json={"text": "Hello", "client_message_id": "draft-one"})
    responses = await asyncio.gather(send(), send())
    assert all(r.status_code == 200 for r in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert await server.db.space_messages.count_documents({"space_id": sid}) == 1
    assert (await client.post(path, headers=headers(a), json={"text": "Changed", "client_message_id": "draft-one"})).status_code == 409
    one = responses[0].json()
    two = (await client.post(path, headers=headers(b), json={"text": "Second", "client_message_id": "draft-two"})).json()
    assert (await client.get(path + "?after=" + one["id"], headers=headers(a))).json() == [two]
    assert (await client.get(path + "?limit=1", headers=headers(a))).json() == [two]
    assert (await client.get(path, headers=headers(c))).status_code == 404


@pytest.mark.asyncio
async def test_private_space_audio_is_binary_reference_only_and_supports_authorized_ranges(client, private_files, rooms):
    a, b, c, sid = rooms
    raw = b"ID3" + b"private-music-fixture" * 200
    response = await client.post("/api/audio/uploads/binary?name=song.mp3&title=Our%20song",
        headers=headers(a), content=raw)
    assert response.status_code == 200, response.text
    upload_id = response.json()["id"]
    saved = await server.db.audio_uploads.find_one({"id": upload_id})
    assert "data_url" not in saved and private_files.data[saved["key"]] == raw
    assert "key" not in response.text and "storage_provider" not in response.text
    assert (await client.get("/api/audio/uploads/" + upload_id + "/download", headers=headers(b))).status_code == 404
    chosen = await client.post("/api/spaces/" + sid + "/content", headers=headers(a),
        json={"type": "audio", "upload_id": upload_id})
    assert chosen.status_code == 200 and "url" not in chosen.json()["content"]
    assert raw.decode() not in (await client.get("/api/spaces/" + sid, headers=headers(b))).text
    path = "/api/audio/uploads/" + upload_id + "/download"
    assert (await client.get(path, headers=headers(c))).status_code == 404
    issued = (await client.get(path, headers=headers(b))).json()
    content_path = ticket_path(issued)
    actual = await client.get(content_path, headers={"Range": "bytes=3-18"})
    assert actual.status_code == 206 and actual.content == raw[3:19]
    assert actual.headers["content-range"] == f"bytes 3-18/{len(raw)}"
    assert actual.headers["content-type"] == "audio/mpeg"
    assert (await client.get(content_path, headers={"Range": "bytes=-10"})).content == raw[-10:]
    assert (await client.get(content_path, headers={"Range": "bytes=999999-"})).status_code == 416
    await server.db.spaces.update_one({"id": sid}, {"$pull": {"members": b["user"]["id"]}})
    assert (await client.get(content_path)).status_code == 404
    assert (await client.post("/api/audio/uploads", headers=headers(a),
        json={"title": "No inline uploads", "data_url": "data:audio/mpeg;base64,aGVsbG8="})).status_code == 400


@pytest.mark.asyncio
async def test_space_audio_legacy_records_are_metadata_only_and_logout_revokes_stream(client, private_files, rooms):
    a, b, _, sid = rooms
    raw = b"ID3legacy-private-song"
    await server.db.audio_uploads.insert_one({"id": "legacy", "uploader_id": a["user"]["id"],
        "title": "Older song", "data_url": "data:audio/mpeg;base64," + base64.b64encode(raw).decode()})
    await server.db.spaces.update_one({"id": sid}, {"$set": {"content": {
        "type": "audio", "source": "upload", "upload_id": "legacy",
        "url": "data:audio/mpeg;base64," + base64.b64encode(raw).decode()}}})
    assert "data_url" not in (await client.get("/api/audio/uploads/legacy", headers=headers(b))).text
    assert "base64" not in (await client.get("/api/spaces/" + sid, headers=headers(b))).text
    issued = (await client.get("/api/audio/uploads/legacy/download", headers=headers(b))).json()
    path = ticket_path(issued)
    assert (await client.get(path)).content == raw
    await client.post("/api/auth/logout", headers=headers(b))
    assert (await client.get(path)).status_code == 401


@pytest.mark.asyncio
async def test_audio_invalid_bytes_and_failed_storage_do_not_consume_quota(client, private_files, rooms, monkeypatch):
    a, _, _, _ = rooms
    path = "/api/audio/uploads/binary?name=audio.mp3"
    assert (await client.post(path, headers=headers(a), content=b"not audio")).status_code == 400
    assert (await client.post(path, headers=headers(a), content=b"")).status_code == 400
    def failed(*args):
        raise RuntimeError("isolated fixture")
    monkeypatch.setattr(private_files, "put", failed)
    assert (await client.post(path, headers=headers(a), content=b"ID3some encoded bytes")).status_code == 503
    user = await server.db.users.find_one({"id": a["user"]["id"]})
    total = await server.db.storage_usage.find_one({"_id": "files"})
    assert user.get("storage_bytes", 0) == 0 and total.get("bytes", 0) == 0


@pytest.mark.asyncio
async def test_call_flag_applies_to_all_routes(client, monkeypatch):
    monkeypatch.setattr(server.settings, "ENABLE_CALLS", False)
    a, b, _, _ = await pair(client)
    for method, path, body in [
        ("get", "/api/calls", None), ("get", "/api/calls/nonexistent", None),
        *[("post", "/api/calls/nonexistent/" + action, {}) for action in
          ("accept", "decline", "cancel", "end", "token", "heartbeat")]]:
        response = await getattr(client, method)(path, headers=headers(a), **({"json": body} if body is not None else {}))
        assert response.status_code == 503, (path, response.text)


@pytest.mark.asyncio
async def test_concurrent_calls_reserve_participants_once(client, calls):
    a, b, _ = calls
    async def make():
        return await client.post("/api/calls", headers=headers(a), json={"other_user_id": b["user"]["id"]})
    results = await asyncio.gather(make(), make())
    assert sorted(r.status_code for r in results) == [200, 409]
    assert await server.db.calls.count_documents({"status": "ringing"}) == 1
    assert await server.db.call_leases.count_documents({}) == 2


@pytest.mark.asyncio
async def test_ringing_timeout_is_server_owned_and_releases_busy_lease(client, calls):
    a, b, _ = calls
    call = await make_call(client, a, b)
    await server.db.calls.update_one({"id": call["id"]},
        {"$set": {"expires_at": (now() - timedelta(seconds=1)).isoformat()}})
    current = await client.get("/api/calls/" + call["id"], headers=headers(a))
    assert current.json()["status"] == "missed" and current.json()["end_reason"] == "ringing_timeout"
    assert await server.db.call_leases.count_documents({}) == 0
    assert (await client.post("/api/calls/" + call["id"] + "/accept", headers=headers(b), json={})).status_code == 409
    assert (await client.post("/api/calls", headers=headers(a), json={"other_user_id": b["user"]["id"]})).status_code == 200


@pytest.mark.asyncio
async def test_only_winning_accept_session_can_receive_tokens_or_heartbeat(client, calls, monkeypatch):
    a, b, c = calls
    monkeypatch.setattr(server, "LIVEKIT_URL", "wss://fixture.livekit.example")
    monkeypatch.setattr(server, "LIVEKIT_API_KEY", "fixture-key")
    monkeypatch.setattr(server, "LIVEKIT_API_SECRET", "fixture-secret-value-is-long-enough")
    call = await make_call(client, a, b)
    path = "/api/calls/" + call["id"]
    assert (await client.post(path + "/token", headers=headers(a), json={})).status_code == 409
    other_session = (await client.post("/api/auth/login", json={
        "email": "bob@example.com", "password": "a-long-test-passphrase"})).json()
    accepted = await client.post(path + "/accept", headers=headers(b), json={})
    assert accepted.status_code == 200 and accepted.json()["can_join_media"] is True
    assert accepted.json()["accepted_at"] and accepted.json()["started_at"] is None
    assert (await client.post(path + "/accept", headers=headers(other_session), json={})).status_code == 409
    assert (await client.post(path + "/token", headers=headers(other_session), json={})).status_code == 409
    assert (await client.post(path + "/heartbeat", headers=headers(other_session), json={})).status_code == 409
    assert (await client.get(path, headers=headers(c))).status_code == 404
    issued = await client.post(path + "/token", headers=headers(b), json={})
    assert issued.status_code == 200, issued.text
    claims = jwt.decode(issued.json()["token"], server.LIVEKIT_API_SECRET,
        algorithms=["HS256"], options={"verify_aud": False})
    assert claims["exp"] - claims["nbf"] <= 120
    assert claims["video"]["room"] == "call-" + call["id"]
    assert claims["video"]["canPublishData"] is False
    assert "session_id" not in str(accepted.json())


@pytest.mark.asyncio
async def test_call_duration_requires_both_media_ready_and_callee_hangup_notifies_both(client, calls, monkeypatch):
    a, b, _ = calls
    events = []
    async def send(uid, event):
        events.append((uid, event))
    monkeypatch.setattr(server.call_hub, "send_to", send)
    call = await make_call(client, a, b)
    path = "/api/calls/" + call["id"]
    await client.post(path + "/accept", headers=headers(b), json={})
    first = await client.post(path + "/heartbeat", headers=headers(a), json={"media_ready": True})
    assert first.json()["media_ready_at"] is None
    second = await client.post(path + "/heartbeat", headers=headers(b), json={"media_ready": True})
    assert second.json()["media_ready_at"] and second.json()["started_at"]
    events.clear()
    ended = await client.post(path + "/end", headers=headers(b), json={})
    assert ended.status_code == 200 and ended.json()["end_reason"] == "hangup"
    assert {uid for uid, event in events if event["type"] == "call_ended"} == {a["user"]["id"], b["user"]["id"]}
    assert await server.db.call_leases.count_documents({}) == 0
    assert (await client.post(path + "/end", headers=headers(a), json={})).status_code == 200
    assert (await client.post(path + "/token", headers=headers(a), json={})).status_code == 409


@pytest.mark.asyncio
async def test_call_block_and_verification_loss_deny_fresh_media(client, calls):
    a, b, _ = calls
    call = await make_call(client, a, b)
    path = "/api/calls/" + call["id"]
    await client.post(path + "/accept", headers=headers(b), json={})
    await server.db.blocks.insert_one({"owner_id": a["user"]["id"], "target_id": b["user"]["id"]})
    assert (await client.post(path + "/token", headers=headers(a), json={})).status_code == 403
    await server.db.blocks.delete_many({})
    await server.db.users.update_one({"id": b["user"]["id"]}, {"$set": {"email_verified": False}})
    assert (await client.post(path + "/heartbeat", headers=headers(a), json={})).status_code == 403

@pytest.mark.asyncio
async def test_one_participant_cannot_extend_an_abandoned_call_forever(client, calls):
    a, b, _ = calls
    call = await make_call(client, a, b)
    path = "/api/calls/" + call["id"]
    await client.post(path + "/accept", headers=headers(b), json={})
    past = now() - timedelta(seconds=60)
    deadline = past + timedelta(seconds=120)
    await server.db.calls.update_one({"id": call["id"]}, {"$set": {
        "heartbeats": {a["user"]["id"]: past.isoformat(), b["user"]["id"]: past.isoformat()},
        "expires_at": deadline.isoformat()}})
    alone = (await client.post(path + "/heartbeat", headers=headers(a), json={})).json()
    assert datetime.fromisoformat(alone["expires_at"]) <= now() + timedelta(seconds=65)
    together = (await client.post(path + "/heartbeat", headers=headers(b), json={})).json()
    assert datetime.fromisoformat(together["expires_at"]) >= now() + timedelta(seconds=110)


@pytest.mark.asyncio
async def test_expiry_snapshot_cannot_end_a_concurrently_renewed_call(client, calls):
    a, b, _ = calls
    call = await make_call(client, a, b)
    await client.post("/api/calls/" + call["id"] + "/accept", headers=headers(b), json={})
    stale = await server.db.calls.find_one({"id": call["id"]})
    await server.db.calls.update_one({"id": call["id"]},
        {"$set": {"expires_at": (now() + timedelta(seconds=180)).isoformat()}})
    result = await server._finish_call(stale, "active", "completed", "connection_lost", "call_ended")
    assert result["status"] == "active"
    assert await server.db.call_leases.count_documents({"call_id": call["id"]}) == 2


@pytest.mark.asyncio
async def test_simultaneous_accepts_from_distinct_sessions_have_one_winner(client, calls):
    a, b, _ = calls
    second = (await client.post("/api/auth/login", json={
        "email": "bob@example.com", "password": "a-long-test-passphrase"})).json()
    call = await make_call(client, a, b)
    path = "/api/calls/" + call["id"] + "/accept"
    results = await asyncio.gather(
        client.post(path, headers=headers(b), json={}),
        client.post(path, headers=headers(second), json={}))
    assert sorted(response.status_code for response in results) == [200, 409]


@pytest.mark.asyncio
async def test_private_audio_delete_restores_quota_but_active_room_reference_prevents_delete(client, private_files, rooms):
    a, _, _, sid = rooms
    raw = b"ID3" + b"owned-private-audio" * 10
    uploaded = await client.post("/api/audio/uploads/binary?name=owned.mp3",
        headers=headers(a), content=raw)
    upload_id = uploaded.json()["id"]
    path = "/api/audio/uploads/" + upload_id
    await client.post("/api/spaces/" + sid + "/content", headers=headers(a),
        json={"type": "audio", "upload_id": upload_id})
    assert (await client.delete(path, headers=headers(a))).status_code == 409
    await choose_video(client, a, sid)
    assert (await client.delete(path, headers=headers(a))).status_code == 200
    user = await server.db.users.find_one({"id": a["user"]["id"]})
    total = await server.db.storage_usage.find_one({"_id": "files"})
    assert user["storage_bytes"] == 0 and total["bytes"] == 0 and not private_files.data

@pytest.mark.asyncio
@pytest.mark.parametrize("change, expected", [("logout", 401), ("unverified", 403), ("membership", 404)])
async def test_audio_access_is_rechecked_after_private_provider_startup(client, private_files, rooms, monkeypatch, change, expected):
    from contextlib import asynccontextmanager
    a, b, _, sid = rooms
    uploaded = await client.post("/api/audio/uploads/binary?name=private.mp3",
        headers=headers(a), content=b"ID3private music")
    upload_id = uploaded.json()["id"]
    await client.post("/api/spaces/" + sid + "/content", headers=headers(a),
        json={"type": "audio", "upload_id": upload_id})
    issued = (await client.get("/api/audio/uploads/" + upload_id + "/download", headers=headers(b))).json()
    original = private_files.stream
    @asynccontextmanager
    async def delayed_open(key):
        async with original(key) as chunks:
            if change == "logout":
                session_id = jwt.decode(b["token"], server.settings.JWT_SECRET, algorithms=["HS256"])["sid"]
                await server.auth.revoke(session_id)
            elif change == "unverified":
                await server.db.users.update_one({"id": b["user"]["id"]}, {"$set": {"email_verified": False}})
            else:
                await server.db.spaces.update_one({"id": sid}, {"$pull": {"members": b["user"]["id"]}})
            yield chunks
    monkeypatch.setattr(private_files, "stream", delayed_open)
    denied = await client.get(ticket_path(issued))
    assert denied.status_code == expected
    assert b"ID3private music" not in denied.content



