"""Attachment grants and slow-I/O revocation. All users/storage are synthetic."""
import pytest

import attachments
import server
from auth_service import now
from test_release import client, pair, headers, private_files


async def uploaded_file(client, owner, chat_id):
    response = await client.post("/api/chats/" + chat_id + "/attachments?name=private.txt",
                                headers=headers(owner), content=b"private fixture bytes")
    assert response.status_code == 200, response.text
    return response.json()["id"]


@pytest.mark.asyncio
async def test_text_or_space_reference_cannot_share_another_members_unshared_upload(client, private_files):
    owner, recipient, _, chat_id = await pair(client)
    attachment_id = await uploaded_file(client, owner, chat_id)
    for actor in (owner, recipient):
        for kind in ("text", "space_invite"):
            response = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(actor),
                json={"chat_id": chat_id, "type": kind, "text": "A forged attachment grant",
                      "attachment_id": attachment_id})
            assert response.status_code == 400
    assert await server.db.messages.count_documents({"chat_id": chat_id}) == 0
    assert (await client.get("/api/attachments/" + attachment_id + "/download",
                             headers=headers(recipient))).status_code == 404


@pytest.mark.asyncio
async def test_legacy_or_tampered_reference_is_not_attachment_sharing_proof(client, private_files):
    owner, recipient, _, chat_id = await pair(client)
    attachment_id = await uploaded_file(client, owner, chat_id)
    base = {"chat_id": chat_id, "attachment_id": attachment_id, "created_at": now().isoformat()}
    # Old malformed text references, someone else's media references and revoked
    # owner media must not make a private draft downloadable or previewable.
    for index, extra in enumerate([
        {"sender_id": owner["user"]["id"], "type": "text"},
        {"sender_id": recipient["user"]["id"], "type": "file"},
        {"sender_id": owner["user"]["id"], "type": "image", "deleted_at": now().isoformat()},
        {"sender_id": owner["user"]["id"], "type": "file", "attachment_deleted": True},
    ]):
        await server.db.messages.insert_one({**base, "id": "invalid-grant-" + str(index), **extra})
        for suffix in ("download", "preview"):
            response = await client.get("/api/attachments/" + attachment_id + "/" + suffix,
                                        headers=headers(recipient))
            assert response.status_code == 404
    shared = await client.post("/api/chats/" + chat_id + "/messages", headers=headers(owner),
        json={"chat_id": chat_id, "type": "file", "attachment_id": attachment_id})
    assert shared.status_code == 200
    assert (await client.get("/api/attachments/" + attachment_id + "/download",
                             headers=headers(recipient))).status_code == 200


async def revoke_access(client, owner, recipient, chat_id, reason):
    if reason == "logout":
        assert (await client.post("/api/auth/logout", headers=headers(owner))).status_code == 200
    elif reason == "membership":
        await server.db.chats.update_one({"id": chat_id}, {"$pull": {"members": owner["user"]["id"]}})
    elif reason == "verification":
        await server.db.users.update_one({"id": owner["user"]["id"]}, {"$set": {"email_verified": False}})
    else:
        assert (await client.post("/api/blocks/" + owner["user"]["id"],
                                  headers=headers(recipient))).status_code == 200


async def assert_no_saved_upload(private_files, owner):
    assert private_files.data == {}
    assert await server.db.attachments.count_documents({}) == 0
    user = await server.db.users.find_one({"id": owner["user"]["id"]})
    usage = await server.db.storage_usage.find_one({"_id": "files"}) or {}
    assert user.get("storage_bytes", 0) == 0
    assert usage.get("bytes", 0) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("logout", 401), ("membership", 404), ("verification", 403), ("block", 403)])
async def test_upload_rechecks_access_after_slow_request_body(client, private_files, reason, status):
    owner, recipient, _, chat_id = await pair(client)
    async def body():
        yield b"first chunk"
        await revoke_access(client, owner, recipient, chat_id, reason)
        yield b"last chunk"
    response = await client.post("/api/chats/" + chat_id + "/attachments?name=slow.txt",
                                headers=headers(owner), content=body())
    assert response.status_code == status, response.text
    await assert_no_saved_upload(private_files, owner)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("logout", 401), ("membership", 404), ("verification", 403), ("block", 403)])
async def test_upload_revoked_during_provider_write_removes_bytes_and_reservations(client, private_files, monkeypatch, reason, status):
    owner, recipient, _, chat_id = await pair(client)
    original = attachments.run_in_threadpool
    async def provider_io(function, *args, **kwargs):
        result = await original(function, *args, **kwargs)
        if function == private_files.put:
            assert private_files.data  # provider write really occurred
            await revoke_access(client, owner, recipient, chat_id, reason)
        return result
    monkeypatch.setattr(attachments, "run_in_threadpool", provider_io)
    response = await client.post("/api/chats/" + chat_id + "/attachments?name=slow-provider.txt",
                                headers=headers(owner), content=b"private bytes")
    assert response.status_code == status, response.text
    await assert_no_saved_upload(private_files, owner)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("logout", 401), ("membership", 404), ("verification", 403)])
async def test_presigned_download_is_not_returned_after_access_changes_during_provider_io(client, private_files, monkeypatch, reason, status):
    owner, recipient, _, chat_id = await pair(client)
    attachment_id = await uploaded_file(client, owner, chat_id)
    # Exercise the alternative R2 grant path without contacting R2.
    await server.db.attachments.update_one({"id": attachment_id}, {"$set": {"storage_provider": "r2"}})
    def presign(doc):
        return "https://private-storage.example.test/newly-issued-private-grant"
    monkeypatch.setattr(attachments.store, "download", presign)
    original = attachments.run_in_threadpool
    async def provider_io(function, *args, **kwargs):
        result = await original(function, *args, **kwargs)
        if function == presign:
            await revoke_access(client, owner, recipient, chat_id, reason)
        return result
    monkeypatch.setattr(attachments, "run_in_threadpool", provider_io)
    response = await client.get("/api/attachments/" + attachment_id + "/download", headers=headers(owner))
    assert response.status_code == status, response.text
    assert "newly-issued-private-grant" not in response.text
