import base64
import pytest
from test_release import client, account, headers, pair, private_files, ticket_path
import server


def subscription(endpoint='https://fcm.googleapis.com/fcm/send/fixture'):
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    raw = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
    return {'endpoint': endpoint, 'keys': {'p256dh': encode(raw), 'auth': encode(b'0123456789abcdef')}}


@pytest.mark.asyncio
async def test_voice_memo_private_bytes_and_validation(client, private_files):
    a, b, c, cid = await pair(client)
    raw = b'\x1a\x45\xdf\xa3' + b'encoded-opus-fixture' * 128
    endpoint = '/api/chats/' + cid + '/attachments?kind=voice&name=voice.webm'
    for invalid in [b'', b'pretend-voice', b'<html>not audio</html>']:
        assert (await client.post(endpoint, headers=headers(a), content=invalid)).status_code == 400
    assert (await client.post(endpoint, headers=headers(c), content=raw)).status_code == 404
    response = await client.post(endpoint, headers=headers(a), content=raw)
    assert response.status_code == 200
    fid = response.json()['id']
    body = {'chat_id': cid, 'type': 'voice', 'attachment_id': fid, 'duration_ms': 1500, 'client_message_id': 'voice-1'}
    for duration in [0, -1, 300001]:
        assert (await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json={**body, 'duration_ms': duration})).status_code == 400
    sent = await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json=body)
    assert sent.status_code == 200 and sent.json()['attachment_id'] == fid
    assert sent.json()['media'] is None
    assert (await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json=body)).json()['id'] == sent.json()['id']
    link = '/api/attachments/' + fid + '/download'
    assert (await client.get(link, headers=headers(c))).status_code == 404
    ticket = (await client.get(link, headers=headers(b))).json()
    assert ticket['media_type'] == 'audio/webm'
    response = await client.get(ticket_path(ticket))
    assert response.content == raw and response.headers['cache-control'] == 'no-store'
    assert (await client.delete('/api/attachments/'+fid, headers=headers(a))).status_code == 200


@pytest.mark.asyncio
async def test_browser_push_validates_hosts_and_revokes_subscription(client, monkeypatch):
    monkeypatch.setenv('WEB_PUSH_PUBLIC_KEY', 'test-public')
    monkeypatch.setenv('WEB_PUSH_PRIVATE_KEY', 'test-private')
    a = await account(client, 'alice')
    path = '/api/web-push/subscriptions'
    assert (await client.get('/api/notifications/config')).status_code == 401
    for endpoint in ['http://fcm.googleapis.com/x', 'https://127.0.0.1/private', 'https://fcm.googleapis.com.attacker.example/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x']:
        assert (await client.post(path, headers=headers(a), json=subscription(endpoint))).status_code == 422
    assert (await client.post(path, headers=headers(a), json=subscription())).status_code == 200
    assert await server.db.web_devices.count_documents({}) == 1
    await client.post('/api/auth/logout', headers=headers(a))
    assert await server.db.web_devices.count_documents({}) == 0


@pytest.mark.asyncio
async def test_browser_push_delivers_only_to_active_chat_member(client, monkeypatch):
    import push_service, web_push
    monkeypatch.setenv('WEB_PUSH_PUBLIC_KEY', 'test-public')
    monkeypatch.setenv('WEB_PUSH_PRIVATE_KEY', 'test-private')
    monkeypatch.setattr(server.settings, 'PUSH_ENABLED', False)
    a, b, c, cid = await pair(client)
    for user, suffix in [(b, 'recipient'), (c, 'outsider')]:
        assert (await client.post('/api/web-push/subscriptions', headers=headers(user), json=subscription('https://fcm.googleapis.com/fcm/send/'+suffix))).status_code == 200
    calls = []
    def capture(subscription, payload):
        calls.append((subscription, payload))
        return True
    monkeypatch.setattr(web_push, 'send_sync', capture)
    body = {'chat_id': cid, 'type': 'text', 'text': 'PRIVATE CONTENT MUST NEVER BE A PREVIEW'}
    assert (await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json=body)).status_code == 200
    assert await push_service.deliver_one(server.db)
    assert len(calls) == 1 and calls[0][1]['userId'] == b['user']['id']
    assert calls[0][1]['body'] == 'You have a new message.' and body['text'] not in str(calls)
    await client.post('/api/chats/'+cid+'/messages', headers=headers(a), json=body)
    await client.post('/api/auth/logout', headers=headers(b))
    assert await push_service.deliver_one(server.db) and len(calls) == 1


# Fenced delivery regressions. Providers are synthetic; no real alerts are sent.
async def queued_native_push(client, monkeypatch):
    import push_service
    monkeypatch.setattr(server.settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(push_service, "web_push_configured", lambda: False)
    a, b, _, cid = await pair(client)
    registered = await client.post("/api/devices", headers=headers(b),
        json={"token": "ExpoPushToken[fenced_delivery_fixture]"})
    assert registered.status_code == 200
    sent = await client.post("/api/chats/" + cid + "/messages", headers=headers(a),
        json={"chat_id": cid, "type": "text", "text": "PRIVATE FENCED MESSAGE"})
    assert sent.status_code == 200
    return a, b, sent.json()


async def use_browser_fixture(monkeypatch, recipient):
    import push_service
    await server.db.devices.delete_many({})
    session = await server.db.sessions.find_one({"user_id": recipient["user"]["id"], "revoked": False})
    await server.db.web_devices.insert_one({
        "_id": "browser-fixture", "user_id": recipient["user"]["id"], "session_id": session["_id"],
        "subscription": {"endpoint": "https://fcm.googleapis.com/fcm/send/fenced-fixture"}})
    monkeypatch.setattr(push_service, "web_push_configured", lambda: True)


@pytest.mark.asyncio
@pytest.mark.parametrize("channel", ["native", "browser"])
@pytest.mark.parametrize("outcome", ["success", "failure"])
async def test_deleted_during_provider_io_never_requeues_or_overwrites_cancelled(client, monkeypatch, channel, outcome):
    from auth_service import now
    import push_service
    _, recipient, message = await queued_native_push(client, monkeypatch)
    calls = []
    if channel == "browser":
        await use_browser_fixture(monkeypatch, recipient)
    async def provider_io(payload):
        calls.append(payload)
        claimed = await server.db.messages.find_one({"id": message["id"]})
        assert claimed["push_state"] == "sending" and claimed["push_lease"]
        # This simulates own-message removal after the provider request began.
        await server.db.messages.update_one({"id": message["id"]}, {"$set": {
            "deleted_at": now().isoformat(), "push_state": "cancelled"}})
        if outcome == "failure":
            raise RuntimeError("Synthetic provider completion after deletion")
        return [{"status": "ok", "id": "receipt-after-cancel"}]
    class Gateway:
        async def send(self, payload):
            return await provider_io(payload)
    async def browser(db, device, submitted):
        await provider_io({"message_id": submitted["id"]})
        return True
    monkeypatch.setattr(push_service, "gateway", Gateway())
    monkeypatch.setattr(push_service, "send_browser", browser)
    assert await push_service.deliver_one(server.db)
    stored = await server.db.messages.find_one({"id": message["id"]})
    assert stored["push_state"] == "cancelled" and stored["deleted_at"]
    assert len(calls) == 1 and "PRIVATE FENCED MESSAGE" not in str(calls)
    assert not await push_service.deliver_one(server.db)
    assert await server.db.push_receipts.count_documents({}) == 0
    await push_service.recover_delivery_states(server.db)
    assert "push_lease" not in await server.db.messages.find_one({"id": message["id"]})
    # A request already in flight cannot be recalled; these checks concern durable state.


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "failure"])
async def test_stale_worker_cannot_complete_or_retry_a_replacement_lease(client, monkeypatch, outcome):
    from datetime import timedelta
    from auth_service import now
    import push_service
    _, _, message = await queued_native_push(client, monkeypatch)
    class Gateway:
        async def send(self, payload):
            claimed = await server.db.messages.find_one({"id": message["id"]})
            assert claimed["push_lease"] != "replacement-worker"
            await server.db.messages.update_one({"id": message["id"]}, {"$set": {
                "push_state": "sending", "push_lease": "replacement-worker",
                "push_due": now() + timedelta(minutes=2), "push_attempts": 2}})
            if outcome == "failure":
                raise RuntimeError("Synthetic old-worker failure")
            return [{"status": "ok", "id": "stale-receipt"}]
    monkeypatch.setattr(push_service, "gateway", Gateway())
    assert await push_service.deliver_one(server.db)
    stored = await server.db.messages.find_one({"id": message["id"]})
    assert stored["push_state"] == "sending" and stored["push_lease"] == "replacement-worker"
    assert stored["push_attempts"] == 2
    assert await server.db.push_receipts.count_documents({}) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("channel", ["native", "browser"])
async def test_cancellation_during_recipient_validation_skips_provider_submission(client, monkeypatch, channel):
    from auth_service import now
    import push_service
    _, recipient, message = await queued_native_push(client, monkeypatch)
    if channel == "browser":
        await use_browser_fixture(monkeypatch, recipient)
    calls = []
    async def cancel_during_validation(*args):
        await server.db.messages.update_one({"id": message["id"]}, {"$set": {
            "push_state": "cancelled", "deleted_at": now().isoformat()}})
        return False
    class Gateway:
        async def send(self, payload):
            calls.append("native")
            return [{"status": "ok", "id": "unexpected"}]
    async def browser(*args):
        calls.append("browser")
        return True
    monkeypatch.setattr(push_service, "blocked", cancel_during_validation)
    monkeypatch.setattr(push_service, "gateway", Gateway())
    monkeypatch.setattr(push_service, "send_browser", browser)
    assert await push_service.deliver_one(server.db)
    assert calls == []
    assert (await server.db.messages.find_one({"id": message["id"]}))["push_state"] == "cancelled"


@pytest.mark.asyncio
async def test_recovery_cancels_legacy_tombstones_and_fences_expired_attempts(client, monkeypatch):
    from datetime import timedelta
    from auth_service import now
    import push_service
    old = now() - timedelta(minutes=3)
    docs = [
        {"id": "deleted-pending", "deleted_at": now().isoformat(), "push_state": "pending", "push_attempts": 0},
        {"id": "deleted-sending", "deleted_at": now().isoformat(), "push_state": "sending", "push_attempts": 6},
        {"id": "already-cancelled", "deleted_at": now().isoformat(), "push_state": "cancelled", "push_attempts": 1},
        {"id": "expired-live", "push_state": "sending", "push_attempts": 6},
        {"id": "cancelled-live", "push_state": "cancelled", "push_attempts": 1},
        {"id": "active-live", "push_state": "sending", "push_attempts": 1,
         "push_due": now() + timedelta(minutes=2)},
    ]
    for doc in docs:
        doc.setdefault("push_due", old)
        doc["push_lease"] = "old-attempt"
    await server.db.messages.insert_many(docs)
    await push_service.recover_delivery_states(server.db)
    for identifier in ("deleted-pending", "deleted-sending", "already-cancelled"):
        doc = await server.db.messages.find_one({"id": identifier})
        assert doc["push_state"] == "cancelled" and "push_lease" not in doc
    expired = await server.db.messages.find_one({"id": "expired-live"})
    assert expired["push_state"] == "failed" and "push_lease" not in expired
    assert (await server.db.messages.find_one({"id": "cancelled-live"}))["push_state"] == "cancelled"
    active = await server.db.messages.find_one({"id": "active-live"})
    assert active["push_state"] == "sending" and active["push_lease"] == "old-attempt"
    assert not await push_service.deliver_one(server.db)
