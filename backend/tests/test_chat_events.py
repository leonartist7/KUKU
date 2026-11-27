"""Synthetic replay, idempotency and authorization checks; no live members."""
import asyncio
from datetime import timedelta

import pytest
from test_release import client, pair, account, headers
import server
from auth_service import now


@pytest.mark.asyncio
async def test_message_events_are_private_ordered_and_replayable(client):
    a, b, outsider, chat_id = await pair(client)
    await server.chat_events.indexes()
    baseline = await client.get("/api/messages/sync", headers=headers(b))
    assert baseline.status_code == 200
    assert baseline.json()["reset"] is True
    start = baseline.json()["cursor"]
    for index in range(3):
        sent = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
            json={"chat_id": chat_id, "type": "text", "text": "private content " + str(index),
                  "client_message_id": "test-event-" + str(index)})
        assert sent.status_code == 200, sent.text
    page = (await client.get("/api/messages/sync?after=" + str(start), headers=headers(b))).json()
    assert len(page["events"]) == 3
    assert [event["cursor"] for event in page["events"]] == sorted(event["cursor"] for event in page["events"])
    assert all(event["type"] == "chat_changed" and event["live"] is False for event in page["events"])
    assert "private content" not in str(page)
    assert (await client.get("/api/messages/sync?after=" + str(page["cursor"]), headers=headers(b))).json()["events"] == []
    assert (await client.get("/api/messages/sync?after=0", headers=headers(outsider))).json()["events"] == []
    assert (await client.get("/api/messages/sync")).status_code == 401


@pytest.mark.asyncio
async def test_retried_sends_repair_events_without_duplicating_them(client):
    a, b, _, chat_id = await pair(client)
    payload = {"chat_id": chat_id, "type": "text", "text": "one", "client_message_id": "retry-event"}
    first = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a), json=payload)
    assert first.status_code == 200
    # Simulate a partially published invalidation after the message was committed.
    await server.db.chat_events.delete_one({"_id": b["user"]["id"] + ":" + first.json()["id"]})
    retry = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a), json=payload)
    assert retry.status_code == 200 and retry.json()["id"] == first.json()["id"]
    assert await server.db.messages.count_documents({"chat_id": chat_id}) == 1
    assert await server.db.chat_events.count_documents({"message_id": first.json()["id"]}) == 2


@pytest.mark.asyncio
async def test_replay_rechecks_membership_verification_and_session(client):
    a, b, _, chat_id = await pair(client)
    await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
        json={"chat_id": chat_id, "type": "text", "text": "hidden later"})
    await server.db.chats.update_one({"id": chat_id}, {"$pull": {"members": b["user"]["id"]}})
    page = (await client.get("/api/messages/sync?after=0", headers=headers(b))).json()
    assert page["events"] == [] and page["cursor"] > 0
    await server.db.users.update_one({"id": b["user"]["id"]}, {"$set": {"email_verified": False}})
    assert (await client.get("/api/messages/sync?after=0", headers=headers(b))).status_code == 403
    await client.post("/api/auth/logout", headers=headers(a))
    assert (await client.get("/api/messages/sync?after=0", headers=headers(a))).status_code == 401


@pytest.mark.asyncio
async def test_event_pages_are_bounded_and_expiry_is_checked_without_ttl_cleanup(client):
    a, b, _, chat_id = await pair(client)
    chat = await server.db.chats.find_one({"id": chat_id})
    await asyncio.gather(*[
        server.chat_events.publish_message(chat, {"id": "bulk-" + str(i), "sender_id": a["user"]["id"]})
        for i in range(115)
    ])
    page = await server.chat_events.read(b["user"]["id"], 0)
    assert len(page["events"]) == 100 and page["more"]
    rest = await server.chat_events.read(b["user"]["id"], page["cursor"])
    assert len(rest["events"]) == 15
    assert len({e["message_id"] for e in page["events"] + rest["events"]}) == 115
    await server.db.chat_events.update_many({"user_id": b["user"]["id"]},
        {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    assert (await server.chat_events.read(b["user"]["id"], 0))["events"] == []
    assert (await client.get("/api/messages/sync?after=-1", headers=headers(b))).status_code == 422
    assert (await client.get("/api/messages/sync?after=9007199254740992", headers=headers(b))).status_code == 422


class SyntheticSocket:
    """Exercises transport lifecycle without opening an external socket."""
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = asyncio.Queue()
        self.close_code = None
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, value):
        await self.sent.put(value)

    async def receive_text(self):
        value = await self.incoming.get()
        if isinstance(value, BaseException):
            raise value
        return value

    async def close(self, code=1000):
        from fastapi import WebSocketDisconnect
        self.close_code = code
        await self.incoming.put(WebSocketDisconnect(code))

    async def next_type(self, wanted):
        for _ in range(20):
            item = await asyncio.wait_for(self.sent.get(), timeout=3)
            if item["type"] == wanted:
                return item
        raise AssertionError("Missing socket event: " + wanted)


@pytest.mark.asyncio
async def test_socket_live_events_are_silent_on_replay_and_close_at_logout(client):
    a, b, _, chat_id = await pair(client)
    await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
        json={"chat_id": chat_id, "type": "text", "text": "earlier"})
    ticket = (await client.post("/api/auth/ws-ticket", headers=headers(b),
        json={"scope": "messages"})).json()["ticket"]
    socket = SyntheticSocket()
    task = asyncio.create_task(server.chat_events.socket(socket, ticket, after=0))
    try:
        assert (await socket.next_type("ready"))["cursor"] == 0
        replay = await socket.next_type("chat_changed")
        assert replay["live"] is False
        await socket.next_type("replay_complete")
        sent = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
            json={"chat_id": chat_id, "type": "text", "text": "new"})
        live = await socket.next_type("chat_changed")
        assert live["live"] is True and live["message_id"] == sent.json()["id"]
        denied = SyntheticSocket()
        await server.chat_events.socket(denied, ticket, after=0)
        assert denied.close_code == 4401 and not denied.accepted
        await client.post("/api/auth/logout", headers=headers(b))
        await asyncio.wait_for(task, timeout=3)
        assert socket.close_code == 4401
        assert b["user"]["id"] not in server.chat_events._waiters
    finally:
        if not task.done():
            task.cancel()
            from contextlib import suppress
            with suppress(asyncio.CancelledError):
                await task


@pytest.mark.asyncio
async def test_batched_inbox_latest_ties_and_private_profile_scope(client):
    a, b, c, chat_id = await pair(client)
    stamp = now().isoformat()
    await server.db.messages.insert_many([
        {"id": "tie-a", "chat_id": chat_id, "type": "text", "text": "older tie",
         "sender_id": a["user"]["id"], "created_at": stamp, "push_state": "private"},
        {"id": "tie-z", "chat_id": chat_id, "type": "text", "text": "latest tie",
         "sender_id": a["user"]["id"], "created_at": stamp, "push_state": "private"},
    ])
    listed = (await client.get("/api/chats", headers=headers(b))).json()
    assert len(listed) == 1 and listed[0]["last_message"]["id"] == "tie-z"
    assert "_id" not in listed[0]["last_message"] and "push_state" not in listed[0]["last_message"]
    assert "email" not in listed[0]["other"] and "password_hash" not in listed[0]["other"]
    assert (await client.get("/api/chats", headers=headers(c))).json() == []


@pytest.mark.asyncio
async def test_pending_event_repair_does_not_require_sender_retry(client, monkeypatch):
    a, b, _, chat_id = await pair(client)
    original = server.chat_events.publish_message
    async def interrupted(*args):
        raise RuntimeError("synthetic event interruption")
    monkeypatch.setattr(server.chat_events, "publish_message", interrupted)
    # ASGITransport propagates unexpected errors, matching a server interruption.
    with pytest.raises(RuntimeError):
        await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
            json={"chat_id": chat_id, "type": "text", "text": "committed before interruption"})
    pending = await server.db.messages.find_one({"chat_id": chat_id})
    assert pending["sync_pending"] is True
    monkeypatch.setattr(server.chat_events, "publish_message", original)
    await server.chat_events.repair_pending()
    assert "sync_pending" not in await server.db.messages.find_one({"id": pending["id"]})
    assert len((await server.chat_events.read(b["user"]["id"], 0))["events"]) == 1
    public = (await client.get("/api/chats/" + chat_id + "/messages", headers=headers(b))).json()
    assert "sync_pending" not in public[0]


@pytest.mark.asyncio
async def test_replay_filters_blocked_contacts_and_advances_cursor(client):
    a, b, _, chat_id = await pair(client)
    await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
        json={"chat_id": chat_id, "type": "text", "text": "before block"})
    await client.post("/api/blocks/" + a["user"]["id"], headers=headers(b))
    replay = await server.chat_events.read(b["user"]["id"], 0)
    assert replay["events"] == [] and replay["cursor"] > 0


@pytest.mark.asyncio
async def test_disabled_account_cannot_receive_new_direct_messages_or_contacts(client):
    a, b, _, chat_id = await pair(client)
    await server.db.users.update_one({"id": b["user"]["id"]}, {"$set": {"disabled": True}})
    assert (await client.get("/api/users", headers=headers(a))).json() == []
    assert (await client.post("/api/chats/" + chat_id + "/messages", headers=headers(a),
        json={"chat_id": chat_id, "type": "text", "text": "should not send"})).status_code == 403




