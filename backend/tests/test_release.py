"""Release regression suite. Uses synthetic users and no external services."""
import os
import uuid
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "isolated-test-key-never-use-in-production"
os.environ["REGISTRATION_MODE"] = "open"
os.environ["SEED_DEMO_DATA"] = "false"

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient
import server
from auth_service import digest, now
from datetime import timedelta

@pytest_asyncio.fixture
async def client(monkeypatch):
    if os.getenv("MONGO_TEST_URL"):
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo = AsyncIOMotorClient(os.environ["MONGO_TEST_URL"], tz_aware=True)
    else:
        mongo = AsyncMongoMockClient(tz_aware=True)
    db = mongo["test_" + uuid.uuid4().hex]
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server.auth, "db", db)
    server.auth.rate.clear()
    server.auth.sockets.clear()
    monkeypatch.setattr(server.settings, "REGISTRATION_MODE", "open")
    await server.auth.indexes()
    await db.chats.create_index("key", unique=True)
    await db.messages.create_index([("chat_id", 1), ("sender_id", 1), ("client_message_id", 1)],
        unique=True, partialFilterExpression={"client_message_id": {"$type": "string"}})
    async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
        try:
            yield client
        finally:
            await mongo.drop_database(db.name)
            mongo.close()

async def account(client, name):
    r = await client.post("/api/auth/register", json={"email": name + "@example.com", "name": name, "password": "a-long-test-passphrase"})
    assert r.status_code == 200, r.text
    result = r.json()
    await server.db.users.update_one({"id": result["user"]["id"]}, {"$set": {"email_verified": True}})
    result["user"]["email_verified"] = True
    return result

def headers(user):
    return {"Authorization": "Bearer " + user["token"]}

async def pair(client):
    a, b, c = [await account(client, name) for name in ("alice", "bob", "carol")]
    # Synthetic accepted invitation relationship.
    await server.db.users.update_one({"id": b["user"]["id"]}, {"$set": {"invited_by": a["user"]["id"]}})
    r = await client.post("/api/chats", headers=headers(a), json={"other_user_id": b["user"]["id"]})
    assert r.status_code == 200, r.text
    return a, b, c, r.json()["id"]

@pytest.mark.asyncio
async def test_password_and_blank_name_validation(client):
    for body in [
        {"email": "a@example.com", "name": "A", "password": "1234"},
        {"email": "a@example.com", "name": "   ", "password": "valid-long-passphrase"},
    ]:
        assert (await client.post("/api/auth/register", json=body)).status_code == 422

@pytest.mark.asyncio
async def test_long_unicode_password(client):
    password = "🦁" * 100
    body = {"email": "long@example.com", "name": "Long", "password": password}
    assert (await client.post("/api/auth/register", json=body)).status_code == 200
    assert (await client.post("/api/auth/login", json=body)).status_code == 200

@pytest.mark.asyncio
async def test_logout_revokes_only_current_device(client):
    a = await account(client, "alice")
    other = (await client.post("/api/auth/login", json={"email": "alice@example.com", "password": "a-long-test-passphrase"})).json()
    assert (await client.post("/api/auth/logout", headers=headers(a))).status_code == 200
    assert (await client.get("/api/auth/me", headers=headers(a))).status_code == 401
    assert (await client.get("/api/auth/me", headers=headers(other))).status_code == 200

@pytest.mark.asyncio
async def test_rotation_and_reuse_detection(client):
    a = await account(client, "alice")
    r = await client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]})
    assert r.status_code == 200
    rotated = r.json()
    assert rotated["refresh_token"] != a["refresh_token"]
    assert (await client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]})).status_code == 401
    assert (await client.get("/api/auth/me", headers=headers(rotated))).status_code == 401

@pytest.mark.asyncio
async def test_web_cookie_no_refresh_secret_in_body(client):
    r = await client.post("/api/auth/register", headers={"X-Kuku-Platform": "web", "Origin": "http://localhost:8081"},
        json={"email": "web@example.com", "password": "long-enough-password", "name": "Web"})
    assert r.status_code == 200
    assert "refresh_token" not in r.json()
    assert "HttpOnly" in r.headers["set-cookie"]
    assert (await client.post("/api/auth/refresh", headers={"X-Kuku-Platform": "web", "Origin": "https://evil.example"}, json={})).status_code == 403
    assert (await client.post("/api/auth/refresh", headers={"X-Kuku-Platform": "web", "Origin": "http://localhost:8081"}, json={})).status_code == 200

@pytest.mark.asyncio
async def test_invitation_is_bound_expiring_and_single_use(client, monkeypatch):
    a = await account(client, "alice")
    invite = (await client.post("/api/invites", headers=headers(a), json={"email": "bob@example.com"})).json()
    monkeypatch.setattr(server.settings, "REGISTRATION_MODE", "invite")
    body = {"email": "wrong@example.com", "password": "long-enough-password", "name": "Bob", "invite_token": invite["invite_token"]}
    assert (await client.post("/api/auth/register", json=body)).status_code == 403
    body["email"] = "bob@example.com"
    r = await client.post("/api/auth/register", json=body)
    assert r.status_code == 200
    assert (await client.post("/api/auth/register", json=body)).status_code == 403
    contacts = (await client.get("/api/users", headers=headers(a))).json()
    assert [u["name"] for u in contacts] == ["Bob"]
    assert "email" not in contacts[0]

@pytest.mark.asyncio
async def test_expired_invite_rejected(client, monkeypatch):
    monkeypatch.setattr(server.settings, "REGISTRATION_MODE", "invite")
    await server.db.invites.insert_one({"_id": digest("expired"), "email": "b@example.com", "expires_at": now()-timedelta(seconds=1), "redeemed_by": None})
    r = await client.post("/api/auth/register", json={"email": "b@example.com", "password": "long-enough-password", "name": "B", "invite_token": "expired"})
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_unrelated_account_cannot_start_chat_or_read_chat(client):
    a,b,c,cid = await pair(client)
    assert (await client.post("/api/chats", headers=headers(c), json={"other_user_id": a["user"]["id"]})).status_code == 403
    for path in (f"/api/chats/{cid}", f"/api/chats/{cid}/messages"):
        assert (await client.get(path, headers=headers(c))).status_code == 404
    assert (await client.get("/api/users", headers=headers(c))).json() == []

@pytest.mark.asyncio
async def test_idempotent_send_and_cursor_history(client):
    a,b,c,cid = await pair(client)
    sent=[]
    for i in range(6):
        payload={"chat_id":cid,"type":"text","text":f"Message {i}","client_message_id":str(i)}
        r=await client.post(f"/api/chats/{cid}/messages",headers=headers(a),json=payload)
        assert r.status_code==200,r.text
        sent.append(r.json())
        retry=await client.post(f"/api/chats/{cid}/messages",headers=headers(a),json=payload)
        assert retry.json()["id"]==sent[-1]["id"]
    latest=(await client.get(f"/api/chats/{cid}/messages?limit=2",headers=headers(b))).json()
    assert [m["text"] for m in latest]==["Message 4","Message 5"]
    older=(await client.get(f"/api/chats/{cid}/messages?limit=2&before={latest[0]['id']}",headers=headers(b))).json()
    assert [m["text"] for m in older]==["Message 2","Message 3"]
    newer=(await client.get(f"/api/chats/{cid}/messages?after={sent[3]['id']}",headers=headers(b))).json()
    assert len(newer)==2
    payload["text"]="Changed"
    assert (await client.post(f"/api/chats/{cid}/messages",headers=headers(a),json=payload)).status_code==409
    assert await server.db.messages.count_documents({})==6

@pytest.mark.asyncio
async def test_empty_voice_and_mismatched_chat_rejected(client):
    a,b,c,cid=await pair(client)
    for payload in ({"chat_id":cid,"type":"text","text":"  "},{"chat_id":cid,"type":"voice","duration_ms":1000},{"chat_id":"other","type":"text","text":"hello"}):
        assert (await client.post(f"/api/chats/{cid}/messages",headers=headers(a),json=payload)).status_code==400

@pytest.mark.asyncio
async def test_space_membership_does_not_auto_admit(client):
    a,b,c,cid=await pair(client)
    r=await client.post("/api/spaces",headers=headers(a),json={"member_ids":[b["user"]["id"]]})
    assert r.status_code==200,r.text
    sid=r.json()["id"]
    for suffix in ("","/messages"):
        assert (await client.get(f"/api/spaces/{sid}{suffix}",headers=headers(c))).status_code==404
    for suffix,body in (("/join",{}),("/leave",{}),("/messages",{"text":"intrude"}),("/reactions",{"emoji":"X"}),("/state",{"is_playing":True,"position_sec":0})):
        assert (await client.post(f"/api/spaces/{sid}{suffix}",headers=headers(c),json=body)).status_code==404
    assert c["user"]["id"] not in (await server.db.spaces.find_one({"id":sid}))["members"]
    assert (await client.post("/api/auth/ws-ticket",headers=headers(c),json={"scope":"space:"+sid})).status_code==404

@pytest.mark.asyncio
async def test_space_cannot_publish_someone_elses_audio(client):
    a,b,c,cid=await pair(client)
    sid=(await client.post("/api/spaces",headers=headers(a),json={"member_ids":[b["user"]["id"]]})).json()["id"]
    upload=(await client.post("/api/audio/uploads",headers=headers(c),json={"title":"Private","data_url":"data:audio/wav;base64,AAAA"})).json()
    r=await client.post(f"/api/spaces/{sid}/content",headers=headers(a),json={"type":"audio","upload_id":upload["id"]})
    assert r.status_code==404

@pytest.mark.asyncio
async def test_socket_ticket_single_use_and_scope(client):
    a=await account(client,"alice")
    t=(await client.post("/api/auth/ws-ticket",headers=headers(a),json={"scope":"messages"})).json()["ticket"]
    assert await server.auth.consume_ticket(t,"calls") is None
    assert (await server.auth.consume_ticket(t,"messages"))["id"]==a["user"]["id"]
    assert await server.auth.consume_ticket(t,"messages") is None

@pytest.mark.asyncio
async def test_private_headers_and_cors(client):
    a=await account(client,"alice")
    r=await client.get("/api/auth/me",headers={**headers(a),"Origin":"https://untrusted.vercel.app"})
    assert r.headers["cache-control"]=="no-store"
    assert "access-control-allow-origin" not in r.headers

@pytest.mark.asyncio
async def test_calls_fail_explicitly_when_disabled(client):
    a,b,c,cid=await pair(client)
    assert (await client.post("/api/calls",headers=headers(a),json={"other_user_id":b["user"]["id"]})).status_code==503

@pytest.mark.asyncio
async def test_real_bytes_private_attachment_and_immutable_message(client, monkeypatch):
    import attachments
    class FakeStore:
        def __init__(self): self.objects = {}
        def put(self, key, file): self.objects[key] = file.read()
        def delete(self, key): self.objects.pop(key, None)
        def download(self, doc): return "https://private.example/" + doc["key"]
    storage = FakeStore()
    monkeypatch.setattr(attachments, "store", storage)
    a,b,c,cid = await pair(client)
    body = b"actual file bytes\x00\xff"
    endpoint = "/api/chats/" + cid + "/attachments?name=notes.txt"
    assert (await client.post(endpoint, headers=headers(c), content=body)).status_code == 404
    uploaded = await client.post(endpoint, headers=headers(a), content=body)
    assert uploaded.status_code == 200, uploaded.text
    attachment = uploaded.json()
    assert list(storage.objects.values()) == [body]
    download = "/api/attachments/" + attachment["id"] + "/download"
    assert (await client.get(download, headers=headers(b))).status_code == 404
    payload = {"chat_id":cid, "type":"file", "attachment_id":attachment["id"], "file_size":1, "file_name":"spoof", "client_message_id":"file1"}
    response = await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["file_size"] == len(body)
    assert response.json()["file_name"] == "notes.txt"
    assert (await client.get(download,headers=headers(b))).status_code == 200
    assert (await client.get(download,headers=headers(c))).status_code == 404
    assert (await client.post("/api/chats/"+cid+"/messages",headers=headers(b),json=payload)).status_code == 400
    monkeypatch.setattr(attachments,"MAX_BYTES",5)
    assert (await client.post(endpoint,headers=headers(a),content=body)).status_code == 413
    assert len(storage.objects) == 1

@pytest.mark.asyncio
async def test_recovery_single_use_revokes_sessions(client, monkeypatch):
    import account_recovery
    sent = []
    async def capture(email,code,kind): sent.append((email,code,kind))
    monkeypatch.setenv("RESEND_API_KEY","test-not-a-real-key")
    monkeypatch.setenv("EMAIL_FROM","KUKU <test@example.com>")
    monkeypatch.setattr(account_recovery,"send_code",capture)
    a = await account(client,"alice")
    other = (await client.post("/api/auth/login",json={"email":"alice@example.com","password":"a-long-test-passphrase"})).json()
    assert (await client.post("/api/auth/forgot-password",json={"email":"unknown@example.com"})).status_code == 200
    assert not sent
    assert (await client.post("/api/auth/forgot-password",json={"email":"alice@example.com"})).status_code == 200
    payload = {"email":"alice@example.com","code":sent[0][1],"password":"a-new-long-passphrase"}
    assert (await client.post("/api/auth/reset-password",json={**payload,"code":"wrong-code"})).status_code == 400
    assert (await client.post("/api/auth/reset-password",json=payload)).status_code == 200
    assert (await client.post("/api/auth/reset-password",json=payload)).status_code == 400
    for session in (a,other):
        assert (await client.get("/api/auth/me",headers=headers(session))).status_code == 401
    assert (await client.post("/api/auth/login",json={"email":"alice@example.com","password":payload["password"]})).status_code == 200

@pytest.mark.asyncio
async def test_unverified_account_is_gated_until_email_proof(client, monkeypatch):
    import account_recovery
    codes=[]
    async def capture(email,code,kind): codes.append(code)
    monkeypatch.setenv("RESEND_API_KEY","test-key")
    monkeypatch.setenv("EMAIL_FROM","test@example.com")
    monkeypatch.setattr(account_recovery,"send_code",capture)
    user=(await client.post("/api/auth/register",json={"email":"new@example.com","name":"New","password":"a-long-test-passphrase"})).json()
    assert (await client.get("/api/users",headers=headers(user))).status_code == 403
    assert (await client.post("/api/invites",headers=headers(user),json={"email":"friend@example.com"})).status_code == 403
    assert (await client.post("/api/auth/verification",headers=headers(user))).status_code == 200
    body={"email":"new@example.com","code":codes[0]}
    assert (await client.post("/api/auth/verify",headers=headers(user),json=body)).status_code == 200
    assert (await client.get("/api/users",headers=headers(user))).status_code == 200
    assert (await client.post("/api/auth/verify",headers=headers(user),json=body)).status_code == 400

@pytest.mark.asyncio
async def test_push_jobs_persist_with_message_and_retry_safely(client, monkeypatch):
    import push_service
    monkeypatch.setattr(server.settings,"PUSH_ENABLED",True)
    class FakeGateway:
        def __init__(self): self.fail=True;self.sent=[]
        async def send(self,payload):
            self.sent.extend(payload)
            if self.fail: raise RuntimeError("temporary provider failure")
            return [{"status":"ok","id":"receipt-1"} for p in payload]
        async def receipts(self,ids):
            return {identifier:{"status":"error","details":{"error":"DeviceNotRegistered"}} for identifier in ids}
    gateway=FakeGateway();monkeypatch.setattr(push_service,"gateway",gateway)
    a,b,c,cid=await pair(client)
    token="ExponentPushToken[test_device]"
    assert (await client.post("/api/devices",headers=headers(b),json={"token":token})).status_code == 200
    payload={"chat_id":cid,"type":"text","text":"private message body","client_message_id":"push-message"}
    sent=await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json=payload)
    assert sent.status_code == 200
    assert not any(k.startswith("push_") for k in sent.json())
    assert await push_service.deliver_one(server.db)
    stored=await server.db.messages.find_one({"id":sent.json()["id"]})
    assert stored["push_state"] == "retry"
    assert gateway.sent[0]["body"] == "You have a new message."
    assert "private message body" not in str(gateway.sent)
    gateway.fail=False
    await server.db.messages.update_one({"id":stored["id"]},{"$set":{"push_due":now()-timedelta(seconds=1)}})
    assert await push_service.deliver_one(server.db)
    assert (await server.db.messages.find_one({"id":stored["id"]}))["push_state"] == "sent"
    duplicate=await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json=payload)
    assert duplicate.json()["id"] == stored["id"]
    assert not any(k.startswith("push_") for k in duplicate.json())
    await server.db.push_receipts.update_many({},{"$set":{"due":now()-timedelta(seconds=1)}})
    await push_service.check_receipts(server.db)
    assert await server.db.devices.count_documents({}) == 0

@pytest.mark.asyncio
async def test_logout_removes_push_recipient_before_delivery(client,monkeypatch):
    import push_service
    monkeypatch.setattr(server.settings,"PUSH_ENABLED",True)
    a,b,c,cid=await pair(client)
    await client.post("/api/devices",headers=headers(b),json={"token":"ExpoPushToken[device_b]"})
    await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json={"chat_id":cid,"type":"text","text":"test"})
    await client.post("/api/auth/logout",headers=headers(b))
    class NeverSend:
        async def send(self,payload): raise AssertionError("Must not send to a logged-out session")
    monkeypatch.setattr(push_service,"gateway",NeverSend())
    assert await push_service.deliver_one(server.db)
    assert (await server.db.messages.find_one({"chat_id":cid}))["push_state"] == "sent"

@pytest.mark.asyncio
async def test_file_quota_and_owner_deletion(client,monkeypatch):
    import attachments
    class Store:
        def put(self,key,file): pass
        def delete(self,key): pass
    monkeypatch.setattr(attachments,"store",Store())
    monkeypatch.setattr(attachments,"USER_QUOTA_BYTES",10)
    a,b,c,cid=await pair(client)
    url="/api/chats/"+cid+"/attachments?name=test.txt"
    first=await client.post(url,headers=headers(a),content=b"12345678")
    assert first.status_code==200
    assert (await client.post(url,headers=headers(a),content=b"1234")).status_code==413
    file_id=first.json()["id"]
    payload={"chat_id":cid,"type":"file","attachment_id":file_id,"client_message_id":"delete-retry"}
    original=await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json=payload)
    assert original.status_code==200
    assert (await client.delete("/api/attachments/"+file_id,headers=headers(b))).status_code==404
    assert (await client.delete("/api/attachments/"+file_id,headers=headers(a))).status_code==200
    retry=await client.post("/api/chats/"+cid+"/messages",headers=headers(a),json=payload)
    assert retry.status_code==200 and retry.json()["id"]==original.json()["id"]
    assert retry.json()["attachment_deleted"] is True
    assert (await server.db.users.find_one({"id":a["user"]["id"]}))["storage_bytes"]==0
    assert (await client.post(url,headers=headers(a),content=b"1234")).status_code==200

@pytest.mark.asyncio
async def test_blocking_stops_both_directions_and_unblock_is_owner_only(client):
    a,b,c,cid=await pair(client)
    target=b['user']['id']
    assert (await client.post('/api/blocks/'+target,headers=headers(a))).status_code==200
    assert (await client.post('/api/blocks/'+target,headers=headers(a))).status_code==200
    for sender in (a,b):
        assert (await client.post('/api/chats/'+cid+'/messages',headers=headers(sender),json={'chat_id':cid,'type':'text','text':'blocked'})).status_code==403
        assert (await client.post('/api/chats/'+cid+'/attachments?name=test.txt',headers=headers(sender),content=b'bytes')).status_code==403
    assert (await client.get('/api/users',headers=headers(a))).json()==[]
    assert len((await client.get('/api/blocks',headers=headers(a))).json())==1
    assert (await client.get('/api/blocks',headers=headers(b))).json()==[]
    await client.delete('/api/blocks/'+target,headers=headers(c))
    assert await server.db.blocks.count_documents({})==1
    # Reciprocal blocks remain independent.
    await client.post('/api/blocks/'+a['user']['id'],headers=headers(b))
    await client.delete('/api/blocks/'+target,headers=headers(a))
    assert (await client.post('/api/chats/'+cid+'/messages',headers=headers(a),json={'chat_id':cid,'type':'text','text':'still blocked'})).status_code==403
    await client.delete('/api/blocks/'+a['user']['id'],headers=headers(b))
    assert (await client.post('/api/chats/'+cid+'/messages',headers=headers(a),json={'chat_id':cid,'type':'text','text':'allowed'})).status_code==200

@pytest.mark.asyncio
async def test_reports_require_actual_conversation_and_message_access(client):
    a,b,c,cid=await pair(client)
    msg=(await client.post('/api/chats/'+cid+'/messages',headers=headers(b),json={'chat_id':cid,'type':'text','text':'test'})).json()
    body={'target_id':b['user']['id'],'message_id':msg['id'],'reason':'harassment','note':'Test report'}
    assert (await client.post('/api/reports',headers=headers(c),json=body)).status_code==404
    assert (await client.post('/api/reports',headers=headers(a),json={**body,'message_id':'unknown'})).status_code==404
    response=await client.post('/api/reports',headers=headers(a),json=body)
    assert response.status_code==200 and response.json()['status']=='pending'
    assert (await client.get('/api/reports',headers=headers(b))).status_code==405

@pytest.mark.asyncio
async def test_block_cancels_queued_push_before_provider_submission(client,monkeypatch):
    import push_service
    monkeypatch.setattr(server.settings,'PUSH_ENABLED',True)
    a,b,c,cid=await pair(client)
    await client.post('/api/devices',headers=headers(b),json={'token':'ExpoPushToken[blocked_device]'})
    await client.post('/api/chats/'+cid+'/messages',headers=headers(a),json={'chat_id':cid,'type':'text','text':'queued'})
    await client.post('/api/blocks/'+a['user']['id'],headers=headers(b))
    class Provider:
        async def send(self,payload): raise AssertionError('Blocked recipients must not be notified')
    monkeypatch.setattr(push_service,'gateway',Provider())
    await push_service.deliver_one(server.db)
    assert (await server.db.messages.find_one({'chat_id':cid}))['push_state']=='sent'


@pytest.mark.asyncio
async def test_onboarding_profile_requires_verification_and_is_private(client):
    body = {"email": "new@example.com", "name": "New", "password": "a-long-test-passphrase"}
    a = (await client.post("/api/auth/register", json=body)).json()
    assert a["user"]["onboarding_complete"] is False
    assert (await client.post("/api/auth/profile", headers=headers(a),
        json={"name": "Changed", "bio": ""})).status_code == 403
    assert (await client.post("/api/auth/profile", json={"name": "Changed"})).status_code == 401
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$set": {"email_verified": True}})
    b = await account(client, "other")
    r = await client.post("/api/auth/profile", headers=headers(a), json={"name": "  New Name  ", "bio": "  Hello, world.  "})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"
    assert r.json()["bio"] == "Hello, world."
    assert r.json()["onboarding_complete"] is True
    assert (await client.get("/api/auth/me", headers=headers(a))).json()["onboarding_complete"] is True
    untouched = await server.db.users.find_one({"id": b["user"]["id"]})
    assert untouched["name"] == "other"
    from auth_service import profile
    public = profile(await server.db.users.find_one({"id": a["user"]["id"]}))
    assert "onboarding_complete" not in public and "email" not in public

@pytest.mark.asyncio
async def test_profile_validation_and_repeated_completion(client):
    a = await account(client, "alice")
    for payload in [{"name": " "}, {"name": "a" * 81}, {"name": "Alice", "bio": "a" * 161},
                    {"name": "Alice", "email_verified": True}, {"name": "Alice", "id": "someone-else"}]:
        assert (await client.post("/api/auth/profile", headers=headers(a), json=payload)).status_code == 422
    for _ in range(2):
        r = await client.post("/api/auth/profile", headers=headers(a), json={"name": "Alice", "bio": ""})
        assert r.status_code == 200 and r.json()["onboarding_complete"] is True
    await server.db.users.update_one({"id": a["user"]["id"]}, {"$unset": {"onboarding_complete": ""}})
    assert (await client.get("/api/auth/me", headers=headers(a))).json()["onboarding_complete"] is True
