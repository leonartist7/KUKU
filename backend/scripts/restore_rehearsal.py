"""Synthetic logical recovery rehearsal. Never accepts a live URL or database."""
import asyncio, hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time
from datetime import datetime, timezone

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
                      PUSH_ENABLED="false", MONGO_URL=source_uri, DB_NAME=source_name)
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tests"))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    import httpx
    from motor.motor_asyncio import AsyncIOMotorClient
    from bson import json_util
    from test_release import account, pair, headers
    import server
    from auth_service import now
    outbound = []
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
    try:
        require(not await src[source_name].list_collection_names(), "Source must start empty")
        require(not await admin[target_name].list_collection_names(), "Target must start empty")
        await admin[target_name].command("createUser", "restore_fixture", pwd="fixture-only",
                                        roles=[{"role": "readWrite", "db": target_name}])
        target = AsyncIOMotorClient(target_uri, tz_aware=True)
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
            media_hash = hashlib.sha256(media).hexdigest()
            await db.attachments.insert_one({"id": "fixture-media", "owner_id": alice["user"]["id"],
                "chat_id": chat, "key": "objects/fixture.bin", "size": len(media), "sha256": media_hash,
                "storage_provider": "isolated-fixture", "name": "fixture.bin", "created_at": now()})
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
            passed("documents, counts, indexes and collection validators match")
            # Copy known bytes into a distinct temporary store; never reuse a live object namespace.
            with tempfile.TemporaryDirectory(prefix="kuku-fixture-media-") as temp:
                source_store, restored_store = pathlib.Path(temp) / "source", pathlib.Path(temp) / "restored"
                source_store.mkdir(); restored_store.mkdir()
                (source_store / "fixture.bin").write_bytes(media)
                (restored_store / "fixture.bin").write_bytes((source_store / "fixture.bin").read_bytes())
                def verify_media():
                    value = restored_store / "fixture.bin"
                    require(value.exists() and hashlib.sha256(value.read_bytes()).hexdigest() == media_hash,
                            "Missing or corrupt restored media")
                verify_media()
                (restored_store / "fixture.bin").write_bytes(b"corrupt")
                try: verify_media()
                except RuntimeError: pass
                else: raise RuntimeError("Corrupt-media negative control failed")
                (restored_store / "fixture.bin").unlink()
                try: verify_media()
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
            for name in ("devices", "web_devices", "ws_tickets", "file_tickets", "call_leases", "room_presence"):
                await restored[name].delete_many({})
            passed("newer closure reconciled and old sessions/ephemeral credentials invalidated")
            bind(restored)
            require((await client.get("/api/auth/me", headers=headers(alice))).status_code == 401, "Old session survived")
            live_alice, live_outsider = await login(client, "alice"), await login(client, "carol")
            require((await client.get("/api/auth/me", headers=headers(live_alice))).status_code == 200, "Profile failed")
            retry = await client.post("/api/chats/" + chat + "/messages", headers=headers(live_alice), json=payload)
            require(retry.status_code == 200 and retry.json()["id"] == original_id, "Retry duplicated or lost its message")
            require(await restored.messages.count_documents({"client_message_id": payload["client_message_id"]}) == 1,
                    "Duplicate restored send")
            denied = await client.get("/api/chats/" + chat + "/messages", headers=headers(live_outsider))
            require(denied.status_code in (403, 404), "Outsider read restored conversation")
            got = await client.get("/api/spaces/" + room_id, headers=headers(live_alice))
            require(got.status_code == 200 and got.json()["name"] == "Recovery fixture", "Restored Space state unavailable")
            denied = await client.get("/api/spaces/" + room_id, headers=headers(live_outsider))
            require(denied.status_code in (403, 404), "Outsider read restored Space")
            denied = await client.post("/api/auth/login", json={"email": "closed-after-backup@example.com",
                                                                "password": "a-long-test-passphrase"})
            require(denied.status_code in (401, 403), "Restored closure allowed sign-in")
            require(not outbound, "A provider request was attempted")
            passed("actual restored API: sign-in, session revocation, membership, retry, Space and closed-account denial")
            report = {"scope": "SYNTHETIC ONLY; no live database or media recovery claim",
                "source_sha": os.environ.get("KUKU_SOURCE_SHA"), "checked_at": datetime.now(timezone.utc).isoformat(),
                "mongo_source": (await src.server_info())["version"], "mongo_target": (await target.server_info())["version"],
                "dump_tool": dump_version, "restore_tool": restore_version, "archive_bytes": len(archive),
                "archive_sha256": hashlib.sha256(archive).hexdigest(), "dump_ms": dump_ms, "restore_ms": restore_ms,
                "elapsed_ms": round((time.perf_counter() - began) * 1000), "collection_counts": {k: v["count"] for k,v in before.items()},
                "checks": checks, "provider_attempts": len(outbound), "live_restore_verified": False,
                "limits": ["fixture filesystem is not a real Blob/R2 restore", "no FCV/PIT consistency or RPO/RTO guarantee",
                           "no physical erasure proof", "no actual HTTP server startup/lifespan or device test"]}
            out = pathlib.Path("test-results/restore-rehearsal.json")
            out.parent.mkdir(exist_ok=True)
            out.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report))
            print("Synthetic restore rehearsal passed")
    finally:
        # Destroy only these generated namespaces on the two literal fixture hosts.
        await src.drop_database(source_name)
        await admin.drop_database(target_name)
        src.close(); admin.close()
        if target: target.close()
        httpx.AsyncClient.send = original_send

if __name__ == "__main__":
    asyncio.run(main())
