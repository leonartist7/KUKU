"""Synthetic logical recovery rehearsal. Never accepts a live URL or database."""
import asyncio, hashlib, json, os, pathlib, platform, re, subprocess, sys, tempfile, time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

def require(condition, message):
    if not condition: raise RuntimeError(message)

def docker(container, *args, data=None):
    require(re.fullmatch(r"[a-f0-9]{12,64}", container) is not None, "Invalid fixture container")
    result = subprocess.run(["docker", "exec", *(["-i"] if data is not None else []), container, *args],
                            input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    require(result.returncode == 0, "Fixture database tool failed: " + args[0])
    return result.stdout

async def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("KUKU_RESTORE_REHEARSAL") == "synthetic-only",
            "This runner requires the isolated cloud fixture workflow")
    source_id, target_id = os.environ["FIXTURE_SOURCE_CONTAINER"], os.environ["FIXTURE_TARGET_CONTAINER"]
    require(source_id != target_id, "Source and target must be different services")
    suffix = os.environ["GITHUB_RUN_ID"] + "_" + os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    require(re.fullmatch(r"[0-9]+_[0-9]+", suffix) is not None, "Invalid fixture namespace")
    source_name = "kuku_restore_source_fixture_" + suffix
    target_name = "kuku_restore_rehearsal_" + suffix
    # Only these literal loopback fixture endpoints can be used.
    source_uri = "mongodb://fixture_root:fixture-root-only@127.0.0.1:27017/?authSource=admin"
    admin_uri = "mongodb://fixture_root:fixture-root-only@127.0.0.1:27018/?authSource=admin"
    target_uri = "mongodb://restore_fixture:fixture-only@127.0.0.1:27018/" + target_name + "?authSource=" + target_name
    os.environ.update(APP_ENV="test", JWT_SECRET="synthetic-recovery-key-never-use-in-production",
                      REGISTRATION_MODE="open", SEED_DEMO_DATA="false", ENABLE_CALLS="false",
                      PUSH_ENABLED="false", FILE_STORAGE_PROVIDER="vercel",
                      PUBLIC_API_ORIGIN="https://fixture.invalid", MONGO_URL=source_uri, DB_NAME=source_name)
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tests"))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    import httpx
    from motor.motor_asyncio import AsyncIOMotorClient
    from bson import json_util
    from test_release import account, pair, headers
    import server
    import attachments
    from auth_service import now
    outbound = []
    provider_attempts = []

    class FixturePrivateStore:
        def __init__(self, objects):
            self.objects = dict(objects)
            self.opens = []
            self.on_open = None

        @asynccontextmanager
        async def stream(self, key):
            require(key in self.objects, "Provider double refused an unknown object key")
            self.opens.append(key)
            if self.on_open:
                callback, self.on_open = self.on_open, None
                await callback()
            data = self.objects[key]
            async def chunks():
                for offset in range(0, len(data), 7):
                    yield data[offset:offset + 7]
            yield chunks()

        def put(self, *_args, **_kwargs):
            raise RuntimeError("Provider-double writes are forbidden")

        def delete(self, *_args, **_kwargs):
            raise RuntimeError("Provider-double deletes are forbidden")

    class ForbiddenLiveKit:
        def __init__(self, *_args, **_kwargs):
            provider_attempts.append("livekit")
            raise RuntimeError("LiveKit access is forbidden in recovery rehearsal")

    attachments.blob_store = FixturePrivateStore({})
    server.lkapi.LiveKitAPI = ForbiddenLiveKit
    original_send = httpx.AsyncClient.send
    async def isolated_send(client, *args, **kwargs):
        if not isinstance(client._transport, httpx.ASGITransport):
            outbound.append("blocked-provider-request")
            raise RuntimeError("Outbound provider access forbidden in recovery rehearsal")
        return await original_send(client, *args, **kwargs)
    httpx.AsyncClient.send = isolated_send
    src = AsyncIOMotorClient(source_uri, tz_aware=True)
    admin = AsyncIOMotorClient(admin_uri, tz_aware=True)
    target = None
    began = time.perf_counter()
    checks = []
    def passed(label): checks.append(label)
    def bind(db):
        server.db = db
        server.auth.db = db
        server.auth.rate.clear()
        server.auth.sockets.clear()
    async def manifest(db):
        result = {}
        for name in sorted(await db.list_collection_names()):
            docs = await db[name].find({}).to_list(1000)
            require(len(docs) < 1000, "Fixture exceeded bounded size")
            encoded = sorted(json_util.dumps(doc, json_options=json_util.CANONICAL_JSON_OPTIONS, sort_keys=True) for doc in docs)
            indexes = await db[name].index_information()
            options = await db[name].options()
            result[name] = {"count": len(docs), "sha256": hashlib.sha256("\n".join(encoded).encode()).hexdigest(),
                            "indexes": json.loads(json_util.dumps(indexes)), "options": options}
        return result
    async def login(client, name):
        r = await client.post("/api/auth/login", json={"email": name + "@example.com", "password": "a-long-test-passphrase"})
        require(r.status_code == 200, "Restored sign-in failed")
        return r.json()
    def session_id(account):
        import jwt
        return jwt.decode(account["token"], os.environ["JWT_SECRET"], algorithms=["HS256"],
                          audience="kuku", issuer="kuku")["sid"]
    def local_url(url):
        parsed = urlsplit(url)
        require(parsed.scheme == "https" and parsed.netloc == "fixture.invalid", "Unexpected fixture URL")
        return parsed.path, {key: values[-1] for key, values in parse_qs(parsed.query).items()}
    try:
        require(not await src[source_name].list_collection_names(), "Source must start empty")
        require(not await admin[target_name].list_collection_names(), "Target must start empty")
        await admin[target_name].command("createUser", "restore_fixture", pwd="fixture-only",
                                        roles=[{"role": "readWrite", "db": target_name}])
        target = AsyncIOMotorClient(target_uri, tz_aware=True)
        from pymongo.errors import OperationFailure
        try:
            await target["kuku_restore_forbidden_fixture_" + suffix].probe.insert_one({"fixture": True})
        except OperationFailure as denied:
            require(denied.code == 13, "Unexpected namespace-denial error")
        else:
            raise RuntimeError("Target identity can write outside its restricted namespace")
        passed("restore identity cannot write outside the generated target database")
        db = src[source_name]; bind(db)
        await server.auth.indexes()
        await db.chats.create_index("key", unique=True)
        await db.messages.create_index([("chat_id", 1), ("sender_id", 1), ("client_message_id", 1)],
            unique=True, partialFilterExpression={"client_message_id": {"$type": "string"}})
        await db.create_collection("fixture_schema", validator={"kind": {"$type": "string"}})
        await db.fixture_schema.insert_one({"kind": "recovery-fixture"})
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://fixture") as client:
            alice, bob, outsider, chat = await pair(client)
            closing = await account(client, "closed-after-backup")
            payload = {"chat_id": chat, "type": "text", "text": "Synthetic recovery note",
                       "client_message_id": "restore-retry-" + suffix}
            sent = await client.post("/api/chats/" + chat + "/messages", headers=headers(alice), json=payload)
            require(sent.status_code == 200, "Source send failed")
            original_id = sent.json()["id"]
            room = await client.post("/api/spaces", headers=headers(alice),
                                     json={"name": "Recovery fixture", "member_ids": [bob["user"]["id"]]})
            require(room.status_code == 200, "Source Space failed")
            room_id = room.json()["id"]
            media = b"KUKU synthetic private-media fixture\n"
            audio = b"ID3KUKU synthetic private audio fixture for range recovery\n"
            media_hash = hashlib.sha256(media).hexdigest()
            audio_hash = hashlib.sha256(audio).hexdigest()
            await db.attachments.insert_one({"id": "fixture-media", "owner_id": alice["user"]["id"],
                "chat_id": chat, "key": "objects/fixture.bin", "size": len(media), "sha256": media_hash,
                "storage_provider": "vercel", "name": "fixture.bin", "media_type": "application/octet-stream",
                "quota_version": 1, "kind": "file", "created_at": now()})
            file_message = await client.post("/api/chats/" + chat + "/messages", headers=headers(alice), json={
                "chat_id": chat, "type": "file", "attachment_id": "fixture-media", "file_name": "fixture.bin",
                "file_size": len(media), "client_message_id": "restore-file-" + suffix})
            require(file_message.status_code == 200, "Source private file message failed")
            await db.audio_uploads.insert_one({"id": "fixture-audio", "uploader_id": alice["user"]["id"],
                "uploader_name": alice["user"]["name"], "title": "Recovery audio", "name": "fixture.mp3",
                "size": len(audio), "sha256": audio_hash, "key": "objects/fixture-audio.bin",
                "storage_provider": "vercel", "quota_version": 1, "duration_sec": 12,
                "media_type": "audio/mpeg", "cover_emoji": "🎵", "created_at": now().isoformat()})
            for identity, account_value in (("restore-alice", alice), ("restore-bob", bob)):
                joined = await client.post("/api/spaces/" + room_id + "/join", headers=headers(account_value),
                                           json={"connection_id": identity})
                require(joined.status_code == 200, "Source Space presence failed")
            content = await client.post("/api/spaces/" + room_id + "/content", headers=headers(alice),
                                        json={"type": "audio", "upload_id": "fixture-audio"})
            require(content.status_code == 200 and content.json()["content"]["upload_id"] == "fixture-audio",
                    "Source Space content failed")
            playback = await client.post("/api/spaces/" + room_id + "/state", headers=headers(alice),
                                         json={"is_playing": True, "position_sec": 4,
                                               "expected_version": content.json()["version"]})
            require(playback.status_code == 200 and playback.json()["is_playing"], "Source Space playback failed")
            space_message = await client.post("/api/spaces/" + room_id + "/messages", headers=headers(bob),
                json={"text": "Synthetic room recovery note", "client_message_id": "restore-space-" + suffix})
            require(space_message.status_code == 200, "Source Space message failed")

            server.settings.ENABLE_CALLS = True
            server.LIVEKIT_URL, server.LIVEKIT_API_KEY, server.LIVEKIT_API_SECRET = (
                "wss://fixture.invalid", "fixture-key", "fixture-secret")
            created_call = await client.post("/api/calls", headers=headers(alice),
                                             json={"other_user_id": bob["user"]["id"]})
            require(created_call.status_code == 200, "Source call creation failed")
            call_id = created_call.json()["id"]
            accepted_call = await client.post("/api/calls/" + call_id + "/accept", headers=headers(bob))
            require(accepted_call.status_code == 200 and accepted_call.json()["status"] == "active",
                    "Source call acceptance failed")

            alice_sid = session_id(alice)
            await db.devices.insert_one({"_id": "ExponentPushToken[synthetic_restore]",
                "user_id": alice["user"]["id"], "session_id": alice_sid, "updated_at": now()})
            await db.web_devices.insert_one({"_id": "synthetic-browser-device",
                "subscription": {"endpoint": "https://fcm.googleapis.com/fcm/send/synthetic",
                    "keys": {"p256dh": "synthetic", "auth": "synthetic"}},
                "user_id": alice["user"]["id"], "session_id": alice_sid, "updated_at": now()})
            ws_ticket = await client.post("/api/auth/ws-ticket", headers=headers(alice), json={"scope": "messages"})
            require(ws_ticket.status_code == 200, "Source websocket ticket failed")
            attachment_download = await client.get("/api/attachments/fixture-media/download", headers=headers(alice))
            audio_download = await client.get("/api/audio/uploads/fixture-audio/download", headers=headers(bob))
            require(attachment_download.status_code == 200 and audio_download.status_code == 200,
                    "Source private media ticket failed")
            old_attachment_url, old_audio_url = attachment_download.json()["url"], audio_download.json()["url"]
            grant_counts = {name: await db[name].count_documents({})
                            for name in ("devices", "web_devices", "ws_tickets", "file_tickets")}
            require(all(value > 0 for value in grant_counts.values()), "Recovery grants must be nonempty before archive")
            source_space = await db.spaces.find_one({"id": room_id})
            require(source_space.get("session_open") and len(source_space.get("presence_connections", {})) == 2
                    and source_space.get("state", {}).get("is_playing"), "Nested Space state was not created")
            source_space_version = source_space["version"]
            require(await db.call_leases.count_documents({"call_id": call_id}) == 2,
                    "Active call leases were not created")
            before = await manifest(db)
            dump_version = docker(source_id, "mongodump", "--version").decode().splitlines()[0]
            restore_version = docker(target_id, "mongorestore", "--version").decode().splitlines()[0]
            dump_started = time.perf_counter()
            archive = docker(source_id, "mongodump", "--uri=mongodb://fixture_root:fixture-root-only@127.0.0.1:27017/?authSource=admin",
                             "--db=" + source_name, "--archive", "--gzip")
            require(bool(archive), "Empty fixture archive")
            dump_ms = round((time.perf_counter() - dump_started) * 1000)
            # A closure NEWER than the archive must win over the restored active user.
            closed = await client.post("/api/account/close", headers=headers(closing),
                                       json={"password": "a-long-test-passphrase", "confirmation": "DELETE"})
            require(closed.status_code == 200, "Synthetic newer closure failed")
            closure = await db.account_deletions.find_one({"_id": closing["user"]["id"]})
            require(closure is not None, "Missing synthetic closure")
            restore_started = time.perf_counter()
            require(not await target[target_name].list_collection_names(), "Refuse nonempty target")
            docker(target_id, "mongorestore",
                   "--uri=mongodb://restore_fixture:fixture-only@127.0.0.1:27017/" + target_name + "?authSource=" + target_name,
                   "--archive", "--gzip", "--nsInclude=" + source_name + ".*",
                   "--nsFrom=" + source_name + ".*", "--nsTo=" + target_name + ".*", "--stopOnError", data=archive)
            restore_ms = round((time.perf_counter() - restore_started) * 1000)
            restored = target[target_name]
            require(await manifest(restored) == before, "Restored document/index/validator manifest differs")
            restored_media = await restored.attachments.find_one({"id": "fixture-media"})
            require(restored_media["sha256"] == media_hash and restored_media["size"] == len(media), "Restored media metadata mismatch")
            restored_audio = await restored.audio_uploads.find_one({"id": "fixture-audio"})
            require(restored_audio["sha256"] == audio_hash and restored_audio["size"] == len(audio),
                    "Restored audio metadata mismatch")
            passed("documents, counts, indexes and collection validators match")
            # Copy known bytes into a distinct temporary store; never reuse a live object namespace.
            with tempfile.TemporaryDirectory(prefix="kuku-fixture-media-") as temp:
                source_store, restored_store = pathlib.Path(temp) / "source", pathlib.Path(temp) / "restored"
                source_store.mkdir(); restored_store.mkdir()
                (source_store / "fixture.bin").write_bytes(media)
                (source_store / "fixture-audio.bin").write_bytes(audio)
                (restored_store / "fixture.bin").write_bytes((source_store / "fixture.bin").read_bytes())
                (restored_store / "fixture-audio.bin").write_bytes((source_store / "fixture-audio.bin").read_bytes())
                def verify_media(name, expected):
                    value = restored_store / name
                    require(value.exists() and hashlib.sha256(value.read_bytes()).hexdigest() == expected,
                            "Missing or corrupt restored media")
                verify_media("fixture.bin", media_hash)
                verify_media("fixture-audio.bin", audio_hash)
                (restored_store / "fixture.bin").write_bytes(b"corrupt")
                try: verify_media("fixture.bin", media_hash)
                except RuntimeError: pass
                else: raise RuntimeError("Corrupt-media negative control failed")
                (restored_store / "fixture.bin").unlink()
                try: verify_media("fixture.bin", media_hash)
                except RuntimeError: pass
                else: raise RuntimeError("Missing-media negative control failed")
                passed("separate fixture media store: valid bytes pass; missing/corrupt bytes fail")
            require((await restored.users.find_one({"id": closing["user"]["id"]})).get("disabled") is not True,
                    "Newer-closure test did not begin with an older active user")
            await restored.account_deletions.replace_one({"_id": closure["_id"]}, closure, upsert=True)
            await restored.users.update_one({"id": closure["_id"]}, {"$set": {"disabled": True,
                "closed_at": closure["requested_at"], "name": "Former member", "avatar": None, "bio": "",
                "deletion_status": "awaiting_operator_cleanup"}})
            await restored.sessions.update_many({}, {"$set": {"revoked": True}})
            bind(restored)
            fixture_store = FixturePrivateStore({"objects/fixture.bin": media,
                                                  "objects/fixture-audio.bin": audio})
            attachments.blob_store = fixture_store
            server.settings.ENABLE_CALLS = True
            async with server.app.router.lifespan_context(server.app):
                pass
            grants_after = {name: await restored[name].count_documents({})
                            for name in ("devices", "web_devices", "ws_tickets", "file_tickets")}
            require(not any(grants_after.values()), "Startup retained a revoked-session grant")
            recovered_space = await restored.spaces.find_one({"id": room_id})
            require(not recovered_space.get("presence_connections") and not recovered_space.get("session_open")
                    and not recovered_space.get("state", {}).get("is_playing")
                    and recovered_space.get("version", 0) > source_space_version,
                    "Startup did not reconcile restored Space presence/playback")
            require(await restored.space_sessions.count_documents({"space_id": room_id}) == 1,
                    "Startup did not preserve exactly one recovered Space summary")
            recovered_call = await restored.calls.find_one({"id": call_id})
            require(recovered_call.get("status") == "completed" and recovered_call.get("end_reason") == "session_ended",
                    "Startup did not terminate the restored active call")
            require(await restored.call_leases.count_documents({"call_id": call_id}) == 0,
                    "Startup retained restored call leases")
            passed("actual app startup removed revoked grants and reconciled nested Space/call state")
            passed("newer closure reconciled and old sessions revoked")
            old_attachment_path, old_attachment_query = local_url(old_attachment_url)
            old_audio_path, old_audio_query = local_url(old_audio_url)
            require((await client.get(old_attachment_path, params=old_attachment_query)).status_code == 401,
                    "Restored attachment ticket survived startup")
            require((await client.get(old_audio_path, params=old_audio_query)).status_code == 401,
                    "Restored audio ticket survived startup")
            require((await client.get("/api/auth/me", headers=headers(alice))).status_code == 401, "Old session survived")
            live_alice, live_bob, live_outsider = (
                await login(client, "alice"), await login(client, "bob"), await login(client, "carol"))
            require((await client.get("/api/auth/me", headers=headers(live_alice))).status_code == 200, "Profile failed")
            bob_sid = session_id(live_bob)
            await restored.devices.insert_one({"_id": "ExponentPushToken[healthy_restore_session]",
                "user_id": live_bob["user"]["id"], "session_id": bob_sid, "updated_at": now()})
            await restored.web_devices.insert_one({"_id": "healthy-browser-device",
                "subscription": {"endpoint": "https://fcm.googleapis.com/fcm/send/healthy-synthetic",
                    "keys": {"p256dh": "synthetic", "auth": "synthetic"}},
                "user_id": live_bob["user"]["id"], "session_id": bob_sid, "updated_at": now()})
            await restored.web_devices.insert_one({"_id": "orphaned-browser-device",
                "subscription": {"endpoint": "https://fcm.googleapis.com/fcm/send/orphaned-synthetic",
                    "keys": {"p256dh": "synthetic", "auth": "synthetic"}},
                "user_id": "missing-synthetic-user", "session_id": bob_sid, "updated_at": now()})
            healthy_ticket = await client.post("/api/auth/ws-ticket", headers=headers(live_bob),
                                               json={"scope": "messages"})
            healthy_file_ticket = await client.get("/api/attachments/fixture-media/download",
                                                   headers=headers(live_bob))
            require(healthy_ticket.status_code == 200 and healthy_file_ticket.status_code == 200,
                    "Healthy grant fixture failed")
            await server.reconcile_session_grants()
            require(await restored.devices.count_documents({"session_id": bob_sid}) == 1
                    and await restored.web_devices.count_documents({"session_id": bob_sid}) == 1
                    and await restored.ws_tickets.count_documents({"session_id": bob_sid}) == 1
                    and await restored.file_tickets.count_documents({"session_id": bob_sid}) == 1,
                    "Ordinary startup cleanup removed healthy session grants")
            for name in ("devices", "web_devices", "ws_tickets", "file_tickets"):
                await restored[name].delete_many({"session_id": bob_sid})
            passed("startup cleanup preserves grants for a healthy account session")
            retry = await client.post("/api/chats/" + chat + "/messages", headers=headers(live_alice), json=payload)
            require(retry.status_code == 200 and retry.json()["id"] == original_id, "Retry duplicated or lost its message")
            require(await restored.messages.count_documents({"client_message_id": payload["client_message_id"]}) == 1,
                    "Duplicate restored send")
            denied = await client.get("/api/chats/" + chat + "/messages", headers=headers(live_outsider))
            require(denied.status_code in (403, 404), "Outsider read restored conversation")
            got = await client.get("/api/spaces/" + room_id, headers=headers(live_alice))
            require(got.status_code == 200 and got.json()["name"] == "Recovery fixture"
                    and got.json()["content"]["upload_id"] == "fixture-audio"
                    and not got.json()["state"]["is_playing"] and not got.json()["active_members"],
                    "Restored Space state unavailable")
            denied = await client.get("/api/spaces/" + room_id, headers=headers(live_outsider))
            require(denied.status_code in (403, 404), "Outsider read restored Space")
            require((await client.get("/api/attachments/fixture-media/download",
                                      headers=headers(live_outsider))).status_code == 404,
                    "Outsider received a restored attachment ticket")
            require((await client.get("/api/audio/uploads/fixture-audio/download",
                                      headers=headers(live_outsider))).status_code == 404,
                    "Outsider received a restored audio ticket")

            download = await client.get("/api/attachments/fixture-media/download", headers=headers(live_bob))
            require(download.status_code == 200, "Restored attachment ticket failed")
            attachment_path, attachment_query = local_url(download.json()["url"])
            streamed = await client.get(attachment_path, params=attachment_query)
            require(streamed.status_code == 200 and streamed.content == media
                    and streamed.headers.get("cache-control") == "no-store"
                    and streamed.headers.get("x-content-type-options") == "nosniff",
                    "Restored attachment provider-double stream failed")
            require((await client.get(attachment_path, params=attachment_query)).status_code == 401,
                    "One-use attachment ticket was reusable")

            audio_ticket = await client.get("/api/audio/uploads/fixture-audio/download", headers=headers(live_bob))
            require(audio_ticket.status_code == 200, "Restored audio ticket failed")
            audio_path, audio_query = local_url(audio_ticket.json()["url"])
            ranged = await client.get(audio_path, params=audio_query, headers={"Range": "bytes=5-17"})
            require(ranged.status_code == 206 and ranged.content == audio[5:18]
                    and ranged.headers.get("content-range") == "bytes 5-17/" + str(len(audio))
                    and ranged.headers.get("accept-ranges") == "bytes"
                    and ranged.headers.get("cache-control") == "no-store",
                    "Restored audio provider-double range stream failed")

            async def two_private_chunks():
                yield b"first"
                yield b"second"
            async def fixture_visible(_current):
                return None
            guarded = attachments.authorized_chunks(two_private_chunks(), server.auth,
                {"session_id": bob_sid, "user_id": live_bob["user"]["id"]}, fixture_visible)
            require(await anext(guarded) == b"first", "Private stream guard lost its first chunk")
            await restored.sessions.update_one({"_id": bob_sid}, {"$set": {"revoked": True}})
            try:
                await anext(guarded)
            except Exception as denied_chunk:
                require(getattr(denied_chunk, "status_code", None) == 401,
                        "Private stream guard returned an unexpected revocation error")
            else:
                raise RuntimeError("Private stream continued after mid-stream session revocation")
            passed("private attachment streams recheck authorization between provider chunks")

            revocation_ticket = await client.get("/api/attachments/fixture-media/download", headers=headers(live_alice))
            require(revocation_ticket.status_code == 200, "Attachment revocation fixture ticket failed")
            revocation_path, revocation_query = local_url(revocation_ticket.json()["url"])
            async def revoke_during_provider_startup():
                await restored.sessions.update_one({"_id": session_id(live_alice)}, {"$set": {"revoked": True}})
            fixture_store.on_open = revoke_during_provider_startup
            require((await client.get(revocation_path, params=revocation_query)).status_code == 401,
                    "Attachment bytes survived session revocation during provider startup")
            require(fixture_store.opens == ["objects/fixture.bin", "objects/fixture-audio.bin",
                                             "objects/fixture.bin"],
                    "Provider double opened an unexpected object")
            passed("restored private attachment/audio APIs stream exact provider-double bytes with access checks")
            denied = await client.post("/api/auth/login", json={"email": "closed-after-backup@example.com",
                                                                "password": "a-long-test-passphrase"})
            require(denied.status_code in (401, 403), "Restored closure allowed sign-in")
            require(not outbound and not provider_attempts, "A live provider request was attempted")
            server.settings.ENABLE_CALLS = False
            passed("actual restored API: sign-in, session revocation, membership, retry, Space and closed-account denial")
            report = {"scope": "SYNTHETIC ONLY; no live database or media recovery claim",
                "source_sha": os.environ.get("KUKU_SOURCE_SHA"), "checked_at": datetime.now(timezone.utc).isoformat(),
                "runner_kernel": platform.release(), "mongo_source": (await src.server_info())["version"], "mongo_target": (await target.server_info())["version"],
                "dump_tool": dump_version, "restore_tool": restore_version, "archive_bytes": len(archive),
                "archive_sha256": hashlib.sha256(archive).hexdigest(), "dump_ms": dump_ms, "restore_ms": restore_ms,
                "elapsed_ms": round((time.perf_counter() - began) * 1000), "collection_counts": {k: v["count"] for k,v in before.items()},
                "seeded_session_grants": grant_counts, "remaining_session_grants_after_startup": grants_after,
                "startup_lifespan_exercised": True,
                "space_recovery": {"version_before": source_space_version,
                    "version_after": recovered_space["version"], "session_summaries": 1,
                    "presence_connections_after": len(recovered_space.get("presence_connections", {}))},
                "call_recovery": {"status": recovered_call["status"], "end_reason": recovered_call["end_reason"],
                    "leases_after": 0},
                "provider_double": {"stream_opens": len(fixture_store.opens),
                    "opened_keys": fixture_store.opens, "range_status": ranged.status_code},
                "checks": checks, "intercepted_async_httpx_attempts": len(outbound),
                "intercepted_livekit_attempts": len(provider_attempts), "live_restore_verified": False,
                "limits": ["provider-double bytes are not a real Blob/R2 restore",
                           "no FCV/PIT consistency or RPO/RTO guarantee", "no physical erasure proof",
                           "no real device/provider delivery, LiveKit media or call-quality test",
                           "only async HTTPX and LiveKit construction are instrumented; other network clients are not"]}
            out = pathlib.Path("test-results/restore-rehearsal.json")
            out.parent.mkdir(exist_ok=True)
            out.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report))
            print("Synthetic restore rehearsal passed")
    finally:
        # Destroy only these generated namespaces on the two literal fixture hosts.
        try:
            await src.drop_database(source_name)
        finally:
            try:
                await admin.drop_database(target_name)
            finally:
                src.close(); admin.close()
                if target: target.close()
                httpx.AsyncClient.send = original_send

if __name__ == "__main__":
    asyncio.run(main())
