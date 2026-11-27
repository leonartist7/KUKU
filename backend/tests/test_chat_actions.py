"""Chat-tool authorization, retry and realtime regressions. Synthetic accounts only."""
import asyncio
from datetime import timedelta

import pytest
import pytest_asyncio
from test_release import client, pair, headers, private_files
import server
from auth_service import now


@pytest_asyncio.fixture
async def people(client):
    await server.chat_actions.indexes()
    await server.chat_events.indexes()
    return await pair(client)


async def send(client, user, chat_id, text="Original message", **extra):
    body = {"chat_id": chat_id, "type": "text", "text": text, **extra}
    response = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(user), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def message_path(chat_id, message_id):
    return "/api/chats/" + chat_id + "/messages/" + message_id


async def mutate(client, user, chat_id, message, action, body):
    return await client.post(message_path(chat_id, message["id"]) + "/" + action,
                             headers=headers(user), json=body)


@pytest.mark.asyncio
async def test_reply_is_same_chat_reference_and_resolve_is_scoped(client, people):
    a, b, outsider, cid = people
    original = await send(client, a, cid, "A private original")
    reply = await send(client, b, cid, "Reply", reply_to_id=original["id"])
    assert reply["reply_to_id"] == original["id"]
    assert "reply_text" not in reply and "reply_preview" not in reply
    await server.db.messages.insert_one({"id": "foreign", "chat_id": "other-chat",
        "sender_id": outsider["user"]["id"], "text": "Never visible", "type": "text", "created_at": now().isoformat()})
    invalid = await client.post("/api/chats/" + cid + "/messages", headers=headers(a),
        json={"chat_id": cid, "type": "text", "text": "Wrong conversation", "reply_to_id": "foreign"})
    assert invalid.status_code == 400
    path = "/api/chats/" + cid + "/messages/resolve"
    batch = await client.post(path, headers=headers(b),
        json={"message_ids": [original["id"], reply["id"], "foreign", "missing", original["id"]]})
    assert {item["id"] for item in batch.json()} == {original["id"], reply["id"]}
    assert "Never visible" not in batch.text
    assert (await client.post(path, headers=headers(outsider), json={"message_ids": [original["id"]]})).status_code == 404
    assert (await client.get(message_path(cid, "foreign"), headers=headers(a))).status_code == 404
    assert (await client.post(path, headers=headers(a), json={"message_ids": ["x"] * 101})).status_code == 422


@pytest.mark.asyncio
async def test_reply_target_removal_is_current_and_original_reply_retry_still_succeeds(client, people):
    a, b, _, cid = people
    original = await send(client, a, cid)
    payload = {"chat_id": cid, "type": "text", "text": "A reply", "reply_to_id": original["id"],
               "client_message_id": "queued-reply"}
    first = await client.post("/api/chats/" + cid + "/messages", headers=headers(b), json=payload)
    assert first.status_code == 200
    removed = await mutate(client, a, cid, original, "remove", {"expected_revision": 0})
    assert removed.status_code == 200
    current = await client.get(message_path(cid, original["id"]), headers=headers(b))
    assert current.json()["deleted_at"] and current.json()["text"] is None
    retry = await client.post("/api/chats/" + cid + "/messages", headers=headers(b), json=payload)
    assert retry.status_code == 200 and retry.json()["id"] == first.json()["id"]
    changed_target = await client.post("/api/chats/" + cid + "/messages", headers=headers(b),
        json={**payload, "reply_to_id": first.json()["id"]})
    assert changed_target.status_code == 409
    new_reply = await client.post("/api/chats/" + cid + "/messages", headers=headers(b),
        json={**payload, "client_message_id": "a-new-reply"})
    assert new_reply.status_code == 400


@pytest.mark.asyncio
async def test_edit_is_owner_only_windowed_and_revision_checked(client, people):
    a, b, outsider, cid = people
    message = await send(client, a, cid)
    assert (await mutate(client, b, cid, message, "edit", {"text": "Other owner", "expected_revision": 0})).status_code == 403
    assert (await mutate(client, outsider, cid, message, "edit", {"text": "Outsider", "expected_revision": 0})).status_code == 404
    edited = await mutate(client, a, cid, message, "edit", {"text": "A careful edit", "expected_revision": 0})
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 1 and edited.json()["edited_at"]
    assert edited.json()["text"] == "A careful edit"
    assert (await mutate(client, a, cid, message, "edit", {"text": "Stale", "expected_revision": 0})).status_code == 409
    assert (await mutate(client, a, cid, message, "edit", {"text": "   ", "expected_revision": 1})).status_code == 400
    await server.db.messages.update_one({"id": message["id"]},
        {"$set": {"created_at": (now() - timedelta(minutes=16)).isoformat()}})
    assert (await mutate(client, a, cid, message, "edit", {"text": "Too late", "expected_revision": 1})).status_code == 409


@pytest.mark.asyncio
async def test_original_send_fingerprint_survives_edit_and_removal(client, people):
    a, b, _, cid = people
    payload = {"chat_id": cid, "type": "text", "text": "Original private phrase",
               "client_message_id": "lost-ack"}
    first = await client.post("/api/chats/" + cid + "/messages", headers=headers(a), json=payload)
    message = first.json()
    edited = await mutate(client, a, cid, message, "edit", {"text": "Current wording", "expected_revision": 0})
    assert edited.status_code == 200
    retry = await client.post("/api/chats/" + cid + "/messages", headers=headers(a), json=payload)
    assert retry.status_code == 200 and retry.json()["text"] == "Current wording"
    assert (await client.post("/api/chats/" + cid + "/messages", headers=headers(a),
        json={**payload, "text": "Current wording"})).status_code == 409
    removed = await mutate(client, a, cid, message, "remove", {"expected_revision": 1})
    assert removed.status_code == 200
    retry = await client.post("/api/chats/" + cid + "/messages", headers=headers(a), json=payload)
    assert retry.status_code == 200 and retry.json()["deleted_at"] and retry.json()["text"] is None
    assert "Original private phrase" not in retry.text and "Current wording" not in retry.text
    assert await server.db.messages.count_documents({"chat_id": cid}) == 1
    stored = await server.db.messages.find_one({"id": message["id"]})
    assert "_request_fingerprint" in stored and "text" not in stored and "emote_id" not in stored
    assert len(stored["_request_fingerprint"]) == 64
    inbox = (await client.get("/api/chats", headers=headers(b))).json()[0]["last_message"]
    assert inbox["deleted_at"] and "Original private phrase" not in str(inbox)
    assert "_request_fingerprint" not in str(inbox)


@pytest.mark.asyncio
async def test_legacy_message_freezes_original_fingerprint_before_first_edit(client, people):
    a, _, _, cid = people
    payload = {"chat_id": cid, "type": "text", "text": "Before tools", "client_message_id": "legacy-retry"}
    original = (await client.post("/api/chats/" + cid + "/messages", headers=headers(a), json=payload)).json()
    await server.db.messages.update_one({"id": original["id"]},
        {"$unset": {"revision": "", "_request_fingerprint": ""}})
    edited = await mutate(client, a, cid, original, "edit", {"text": "After tools", "expected_revision": 0})
    assert edited.status_code == 200 and edited.json()["revision"] == 1
    retried = await client.post("/api/chats/" + cid + "/messages", headers=headers(a), json=payload)
    assert retried.status_code == 200 and retried.json()["text"] == "After tools"


@pytest.mark.asyncio
async def test_owner_can_remove_emote_but_cannot_delete_attachment_original(client, private_files, people):
    a, b, outsider, cid = people
    emote = (await client.post("/api/chats/" + cid + "/messages", headers=headers(a),
        json={"chat_id": cid, "type": "emote", "emote_id": "fluent:hug"})).json()
    assert (await mutate(client, b, cid, emote, "remove", {"expected_revision": 0})).status_code == 403
    assert (await mutate(client, outsider, cid, emote, "remove", {"expected_revision": 0})).status_code == 404
    removed = await mutate(client, a, cid, emote, "remove", {"expected_revision": 0})
    assert removed.status_code == 200 and removed.json()["type"] == "text" and removed.json()["emote_id"] is None
    assert (await mutate(client, a, cid, emote, "remove", {"expected_revision": 0})).status_code == 200
    uploaded = await client.post("/api/chats/" + cid + "/attachments?name=family.txt",
        headers=headers(a), content=b"Family file bytes")
    attachment_id = uploaded.json()["id"]
    shared = (await client.post("/api/chats/" + cid + "/messages", headers=headers(a),
        json={"chat_id": cid, "type": "file", "attachment_id": attachment_id})).json()
    assert (await mutate(client, a, cid, shared, "remove", {"expected_revision": 0})).status_code == 409
    stored = await server.db.attachments.find_one({"id": attachment_id})
    assert private_files.data[stored["key"]] == b"Family file bytes"


@pytest.mark.asyncio
async def test_reactions_are_allowlisted_per_member_and_concurrent_updates_merge(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid)
    responses = await asyncio.gather(
        mutate(client, a, cid, message, "reaction", {"emoji": "❤️"}),
        mutate(client, b, cid, message, "reaction", {"emoji": "😂"}))
    assert all(response.status_code == 200 for response in responses), [r.text for r in responses]
    current = (await client.get(message_path(cid, message["id"]), headers=headers(a))).json()
    assert current["revision"] == 2
    assert {item["emoji"]: item["user_ids"] for item in current["reactions"]} == {
        "❤️": [a["user"]["id"]], "😂": [b["user"]["id"]]}
    replay = await mutate(client, a, cid, message, "reaction", {"emoji": "❤️"})
    assert replay.json()["revision"] == 2
    changed = await mutate(client, a, cid, message, "reaction", {"emoji": "👍"})
    assert changed.status_code == 200 and changed.json()["revision"] == 3
    cleared = await mutate(client, b, cid, message, "reaction", {"emoji": None})
    assert cleared.status_code == 200 and cleared.json()["reactions"] == [{"emoji": "👍", "user_ids": [a["user"]["id"]]}]
    assert (await mutate(client, a, cid, message, "reaction", {"emoji": "🔥"})).status_code == 400
    assert (await mutate(client, a, cid, message, "reaction", {"emoji": "❤️", "user_ids": ["someone-else"]})).status_code == 422


@pytest.mark.asyncio
async def test_reaction_state_never_exposes_removed_or_unknown_members(client, people):
    a, b, outsider, cid = people
    message = await send(client, a, cid)
    await server.db.messages.update_one({"id": message["id"]},
        {"$set": {"_reactions": {outsider["user"]["id"]: "❤️", a["user"]["id"]: "👍"}}})
    current = (await client.get(message_path(cid, message["id"]), headers=headers(b))).json()
    assert current["reactions"] == [{"emoji": "👍", "user_ids": [a["user"]["id"]]}]
    changed = await mutate(client, b, cid, message, "reaction", {"emoji": "😂"})
    assert changed.status_code == 200
    stored = await server.db.messages.find_one({"id": message["id"]})
    assert set(stored["_reactions"]) == {a["user"]["id"], b["user"]["id"]}


@pytest.mark.asyncio
async def test_block_denies_contact_mutations_but_privacy_removal_still_invalidates(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid, "Remove me privately")
    assert (await mutate(client, b, cid, message, "reaction", {"emoji": "❤️"})).status_code == 200
    assert (await mutate(client, b, cid, message, "pin", {"pinned": True})).status_code == 200
    baseline = await server.chat_events.latest()
    assert (await client.post("/api/blocks/" + a["user"]["id"], headers=headers(b))).status_code == 200
    assert (await mutate(client, a, cid, message, "edit", {"text": "Blocked edit", "expected_revision": 2})).status_code == 403
    assert (await mutate(client, b, cid, message, "reaction", {"emoji": "👍"})).status_code == 403
    assert (await mutate(client, a, cid, message, "pin", {"pinned": True})).status_code == 403
    cleared = await mutate(client, b, cid, message, "reaction", {"emoji": None})
    assert cleared.status_code == 200
    removed = await mutate(client, a, cid, message, "remove", {"expected_revision": cleared.json()["revision"]})
    assert removed.status_code == 200 and removed.json()["deleted_at"]
    events = await server.chat_events.read(b["user"]["id"], baseline)
    assert events["events"] and all(item["change"] == "updated" for item in events["events"])
    assert "Remove me privately" not in str(events)
    assert (await client.get(message_path(cid, message["id"]), headers=headers(b))).json()["text"] is None
    assert (await client.get("/api/chats/" + cid + "/pins", headers=headers(b))).json() == []


@pytest.mark.asyncio
async def test_search_is_literal_scoped_paginated_and_excludes_removed_text(client, people):
    a, b, outsider, cid = people
    matches = [await send(client, a, cid, "A literal .* phrase " + str(index)) for index in range(3)]
    await send(client, a, cid, "This would match a regex wildcard")
    await server.db.messages.insert_one({"id": "foreign-search", "chat_id": "private-other",
        "sender_id": outsider["user"]["id"], "text": "A literal .* phrase secret", "type": "text",
        "created_at": now().isoformat()})
    path = "/api/chats/" + cid + "/search"
    first = await client.get(path, headers=headers(b), params={"q": ".*", "limit": 2})
    assert first.status_code == 200 and len(first.json()) == 2
    rest = await client.get(path, headers=headers(b),
        params={"q": ".*", "limit": 2, "before": first.json()[-1]["id"]})
    found = first.json() + rest.json()
    assert {item["id"] for item in found} == {message["id"] for message in matches}
    assert "secret" not in first.text + rest.text
    assert (await client.get(path, headers=headers(outsider), params={"q": "literal"})).status_code == 404
    assert (await client.get(path, headers=headers(a), params={"q": "x"})).status_code == 422
    assert (await client.get(path, headers=headers(a), params={"q": "x" * 81})).status_code == 422
    assert (await client.get(path, headers=headers(a), params={"q": "literal", "before": "foreign-search"})).status_code == 400
    edited = await mutate(client, a, cid, matches[0], "edit", {"text": "New wording", "expected_revision": 0})
    assert edited.status_code == 200
    assert (await mutate(client, a, cid, matches[1], "remove", {"expected_revision": 0})).status_code == 200
    remaining = (await client.get(path, headers=headers(b), params={"q": ".*"})).json()
    assert [item["id"] for item in remaining] == [matches[2]["id"]]


@pytest.mark.asyncio
async def test_pins_have_atomic_twenty_limit_and_current_message_metadata(client, people):
    a, b, outsider, cid = people
    messages = [await send(client, a, cid, "Pin candidate " + str(i)) for i in range(21)]
    for message in messages[:19]:
        result = await mutate(client, a, cid, message, "pin", {"pinned": True})
        assert result.status_code == 200 and result.json()["pinned"] is True
    raced = await asyncio.gather(*[
        mutate(client, user, cid, message, "pin", {"pinned": True})
        for user, message in [(a, messages[19]), (b, messages[20])]])
    assert sorted(response.status_code for response in raced) == [200, 409]
    chat = await server.db.chats.find_one({"id": cid})
    assert len(chat["pinned_message_ids"]) == len(set(chat["pinned_message_ids"])) == 20
    pins = await client.get("/api/chats/" + cid + "/pins", headers=headers(b))
    assert len(pins.json()) == 20 and all(message["pinned"] for message in pins.json())
    assert all(message["pinned_at"] and message["pinned_by"] for message in pins.json())
    assert (await client.get("/api/chats/" + cid + "/pins", headers=headers(outsider))).status_code == 404


@pytest.mark.asyncio
async def test_pin_retry_is_idempotent_and_removing_a_pin_or_message_is_current(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid)
    first = await mutate(client, a, cid, message, "pin", {"pinned": True})
    assert first.status_code == 200
    repeated = await mutate(client, b, cid, message, "pin", {"pinned": True})
    assert repeated.status_code == 200 and repeated.json()["revision"] == first.json()["revision"]
    unpinned = await mutate(client, b, cid, message, "pin", {"pinned": False})
    assert unpinned.status_code == 200 and unpinned.json()["pinned"] is False
    repinned = await mutate(client, a, cid, message, "pin", {"pinned": True})
    removed = await mutate(client, a, cid, message, "remove", {"expected_revision": repinned.json()["revision"]})
    assert removed.status_code == 200 and removed.json()["pinned"] is False
    assert (await client.get("/api/chats/" + cid + "/pins", headers=headers(b))).json() == []
    assert (await mutate(client, b, cid, message, "pin", {"pinned": True})).status_code == 409


@pytest.mark.asyncio
async def test_pin_outbox_repairs_cross_document_interruption(client, people, monkeypatch):
    a, b, _, cid = people
    message = await send(client, a, cid)
    repair = server.chat_actions._repair_pin
    async def interrupted(*args):
        return None
    monkeypatch.setattr(server.chat_actions, "_repair_pin", interrupted)
    pinned = await mutate(client, a, cid, message, "pin", {"pinned": True})
    assert pinned.status_code == 200 and pinned.json()["pinned"] is True
    chat = await server.db.chats.find_one({"id": cid})
    assert chat["_pin_sync_pending"] and message["id"] in chat["_pin_pending"]
    monkeypatch.setattr(server.chat_actions, "_repair_pin", repair)
    await server.chat_events.repair_pending()
    current = await server.db.messages.find_one({"id": message["id"]})
    assert current["_pinned"] is True and current["revision"] == 1
    chat = await server.db.chats.find_one({"id": cid})
    assert chat.get("_pin_pending", []) == [] and not chat.get("_pin_sync_pending")
    hints = (await server.chat_events.read(b["user"]["id"], 0))["events"]
    assert [(item["change"], item["revision"]) for item in hints] == [("created", 0), ("updated", 1)]


@pytest.mark.asyncio
async def test_old_publication_cannot_clear_newer_revision_pending_marker(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid)
    chat = await server.db.chats.find_one({"id": cid})
    await server.db.messages.update_one({"id": message["id"]},
        {"$set": {"revision": 1, "text": "Newer private wording", "sync_pending": True}})
    await server.chat_events.publish_message(chat, message)
    pending = await server.db.messages.find_one({"id": message["id"]})
    assert pending["sync_pending"] is True
    await server.chat_events.repair_pending()
    repaired = await server.db.messages.find_one({"id": message["id"]})
    assert "sync_pending" not in repaired
    rows = await server.db.chat_events.find({"user_id": b["user"]["id"], "message_id": message["id"]}).sort("seq", 1).to_list(10)
    assert [row["revision"] for row in rows] == [0, 1]
    assert rows[0]["_id"] == b["user"]["id"] + ":" + message["id"]
    assert rows[1]["_id"] != rows[0]["_id"]
    assert "Newer private wording" not in str(rows)


@pytest.mark.asyncio
async def test_mutation_publication_failure_is_repaired_without_resending_content(client, people, monkeypatch):
    a, b, _, cid = people
    message = await send(client, a, cid)
    publish = server.chat_events.publish_message
    async def unavailable(*args):
        raise RuntimeError("Synthetic event storage outage")
    monkeypatch.setattr(server.chat_events, "publish_message", unavailable)
    edited = await mutate(client, a, cid, message, "edit", {"text": "Durably edited", "expected_revision": 0})
    assert edited.status_code == 200 and edited.json()["text"] == "Durably edited"
    assert (await server.db.messages.find_one({"id": message["id"]}))["sync_pending"] is True
    monkeypatch.setattr(server.chat_events, "publish_message", publish)
    await server.chat_events.repair_pending()
    hints = (await server.chat_events.read(b["user"]["id"], 0))["events"]
    assert [hint["revision"] for hint in hints] == [0, 1]
    assert hints[-1]["change"] == "updated" and "Durably edited" not in str(hints)


@pytest.mark.asyncio
@pytest.mark.parametrize("action,body", [
    ("edit", {"text": "No permission", "expected_revision": 0}),
    ("remove", {"expected_revision": 0}),
    ("reaction", {"emoji": "❤️"}),
    ("pin", {"pinned": True}),
])
async def test_tools_require_verified_active_member(client, people, action, body):
    a, b, outsider, cid = people
    message = await send(client, a, cid)
    endpoint = message_path(cid, message["id"]) + "/" + action
    assert (await client.post(endpoint, json=body)).status_code == 401
    assert (await client.post(endpoint, headers=headers(outsider), json=body)).status_code == 404
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"email_verified": False}})
    assert (await client.post(endpoint, headers=headers(a), json=body)).status_code == 403
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"email_verified": True}})
    await client.post("/api/auth/logout", headers=headers(a))
    assert (await client.post(endpoint, headers=headers(a), json=body)).status_code == 401


@pytest.mark.asyncio
async def test_body_cannot_override_actor_or_revision_type(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid)
    assert (await mutate(client, a, cid, message, "edit",
        {"text": "Wrong actor", "expected_revision": 0, "sender_id": b["user"]["id"]})).status_code == 422
    assert (await mutate(client, a, cid, message, "edit",
        {"text": "Wrong revision type", "expected_revision": True})).status_code == 422
    assert (await mutate(client, a, cid, message, "remove",
        {"expected_revision": -1})).status_code == 422

@pytest.mark.asyncio
async def test_reaction_capacity_is_bounded_even_for_a_larger_existing_membership(client, people):
    a, b, _, cid = people
    message = await send(client, a, cid)
    existing = [a["user"]["id"], *["synthetic-member-" + str(i) for i in range(19)]]
    await server.db.chats.update_one({"id": cid},
        {"$set": {"members": [*existing, b["user"]["id"]]}})
    await server.db.messages.update_one({"id": message["id"]},
        {"$set": {"_reactions": {uid: "❤️" for uid in existing}}})
    assert (await mutate(client, b, cid, message, "reaction", {"emoji": "😂"})).status_code == 409
    replaced = await mutate(client, a, cid, message, "reaction", {"emoji": "👍"})
    assert replaced.status_code == 200
    assert sum(len(item["user_ids"]) for item in replaced.json()["reactions"]) == 20
    stored = await server.db.messages.find_one({"id": message["id"]})
    assert len(stored["_reactions"]) == 20


@pytest.mark.asyncio
async def test_search_timeout_is_bounded_and_actionable(client, people, monkeypatch):
    from pymongo.errors import ExecutionTimeout
    a, b, _, cid = people
    await send(client, a, cid, "Search this")
    original_db = server.db
    class TimeoutMessages:
        def find(self, *args, **kwargs):
            assert kwargs["max_time_ms"] == 1500
            raise ExecutionTimeout("Synthetic bounded search")
    class SearchDB:
        messages = TimeoutMessages()
        def __getattr__(self, key):
            return getattr(original_db, key)
    monkeypatch.setattr(server.chat_actions, "get_db", lambda: SearchDB())
    response = await client.get("/api/chats/" + cid + "/search",
        headers=headers(b), params={"q": "Search"})
    assert response.status_code == 503 and "specific phrase" in response.json()["detail"]
