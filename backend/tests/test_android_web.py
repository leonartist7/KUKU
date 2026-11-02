import base64
import pytest
import server
from test_release import client, account, headers, pair, private_files, ticket_path


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
