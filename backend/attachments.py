"""Private R2 storage. Uploads stream through API with a strict byte limit."""
import os
import uuid
import tempfile
import secrets
from datetime import timedelta
from contextlib import AsyncExitStack
from urllib.parse import quote
import boto3
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from starlette.concurrency import run_in_threadpool
from auth_service import now, digest
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from private_blob import PrivateBlobStore
from safety import allow_direct

MAX_BYTES = 25 * 1024 * 1024
USER_QUOTA_BYTES = 500 * 1024 * 1024
TOTAL_QUOTA_BYTES = 750 * 1024 * 1024

class ObjectStore:
    def ready(self):
        return all(os.getenv(k) for k in ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"])
    def require_config(self):
        if not self.ready():
            raise HTTPException(503, "File sharing is getting ready. Please try again later.")
    def client(self):
        required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
        if not all(os.getenv(k) for k in required):
            raise HTTPException(503, "File sharing is getting ready. Please try again later.")
        return boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto", config=Config(signature_version="s3v4"))
    def put(self, key, file):
        self.client().upload_fileobj(file, os.environ["R2_BUCKET"], key,
            ExtraArgs={"ContentType": "application/octet-stream"})
    def delete(self, key):
        self.client().delete_object(Bucket=os.environ["R2_BUCKET"], Key=key)
    def download(self, doc):
        return self.client().generate_presigned_url("get_object", Params={
            "Bucket": os.environ["R2_BUCKET"], "Key": doc["key"],
            "ResponseContentType": "application/octet-stream",
            "ResponseContentDisposition": "attachment; filename*=UTF-8''" + quote(doc["name"], safe=""),
        }, ExpiresIn=60)

store = ObjectStore()
blob_store = PrivateBlobStore()

def provider():
    value = os.getenv("FILE_STORAGE_PROVIDER", "r2")
    if value not in ("r2", "vercel"):
        raise HTTPException(503, "File sharing is getting ready. Please try again later.")
    return value

def storage_for(name):
    return blob_store if name == "vercel" else store


def attachment_router(db_getter, auth):
    router = APIRouter()
    async def member(chat_id, user):
        if not await db_getter().chats.find_one({"id": chat_id, "members": user["id"]}):
            raise HTTPException(404, "Chat not found")

    async def visible_file(attachment_id, user):
        doc = await db_getter().attachments.find_one({"id": attachment_id})
        if not doc:
            raise HTTPException(404, "File not found")
        await member(doc["chat_id"], user)
        if doc["owner_id"] != user["id"] and not await db_getter().messages.find_one({"attachment_id": attachment_id, "chat_id": doc["chat_id"]}):
            raise HTTPException(404, "File not found")
        return doc

    async def release_quota(user_id, size):
        await db_getter().users.update_one({"id": user_id}, {"$inc": {"storage_bytes": -size}})
        await db_getter().storage_usage.update_one({"_id": "files"}, {"$inc": {"bytes": -size}})

    @router.get("/files/status")
    async def file_status(user=Depends(auth.verified)):
        selected = storage_for(provider())
        usage = await db_getter().storage_usage.find_one({"_id": "files"}) or {}
        return {"available": bool(selected.ready()), "max_file_bytes": MAX_BYTES,
            "used_bytes": user.get("storage_bytes", 0), "quota_bytes": USER_QUOTA_BYTES,
            "remaining_bytes": max(0, min(USER_QUOTA_BYTES - user.get("storage_bytes", 0), TOTAL_QUOTA_BYTES - usage.get("bytes", 0)))}

    @router.post("/chats/{chat_id}/attachments")
    async def upload(chat_id: str, request: Request, name: str, user=Depends(auth.verified)):
        await member(chat_id, user)
        chat = await db_getter().chats.find_one({"id": chat_id})
        for other_id in chat["members"]:
            if other_id != user["id"]:
                await allow_direct(db_getter(), user["id"], other_id)
        await auth.limit("upload:" + user["id"], 30, 3600)
        storage_provider = provider()
        selected_store = storage_for(storage_provider)
        if hasattr(selected_store, "require_config"):
            selected_store.require_config()
        name = name.replace("\\", "/").split("/")[-1].strip()
        if not name or len(name) > 180 or any(ord(c) < 32 for c in name):
            raise HTTPException(400, "Invalid filename")
        key = "attachments/" + str(uuid.uuid4())
        size = 0
        with tempfile.TemporaryFile() as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Files must be 25 MB or smaller")
                file.write(chunk)
            if not size:
                raise HTTPException(400, "The file is empty")
            file.seek(0)
            reserved = await db_getter().users.update_one({"id": user["id"],
                "$or": [{"storage_bytes": {"$exists": False}}, {"storage_bytes": {"$lte": USER_QUOTA_BYTES - size}}]},
                {"$inc": {"storage_bytes": size}})
            if not reserved.matched_count:
                raise HTTPException(413, "Your file storage limit has been reached")
            try:
                await db_getter().storage_usage.update_one({"_id": "files"}, {"$setOnInsert": {"bytes": 0}}, upsert=True)
                total = await db_getter().storage_usage.update_one({"_id": "files", "bytes": {"$lte": TOTAL_QUOTA_BYTES - size}}, {"$inc": {"bytes": size}})
            except Exception:
                await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
                raise
            if not total.matched_count:
                await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
                raise HTTPException(413, "KUKU’s shared file space is full. Remove an older file and try again.")
            try:
                await run_in_threadpool(selected_store.put, key, file)
            except Exception:
                await release_quota(user["id"], size)
                raise
        doc = {"id": str(uuid.uuid4()), "key": key, "chat_id": chat_id,
            "owner_id": user["id"], "name": name, "size": size, "created_at": now(),
            "storage_provider": storage_provider, "quota_version": 1}
        try:
            await db_getter().attachments.insert_one(doc)
        except Exception:
            try:
                await run_in_threadpool(selected_store.delete, key)
            finally:
                await release_quota(user["id"], size)
            raise
        return {"id": doc["id"], "file_name": name, "file_size": size}

    @router.get("/attachments/{attachment_id}/download")
    async def download(attachment_id: str, user=Depends(auth.verified)):
        doc = await visible_file(attachment_id, user)
        await auth.limit("download:" + user["id"], 120, 3600)
        if doc.get("storage_provider", "r2") != "vercel":
            return {"url": await run_in_threadpool(store.download, doc), "expires_in": 60}
        origin = os.getenv("PUBLIC_API_ORIGIN", "").rstrip("/")
        if not origin.startswith("https://") or "/" in origin[8:] or "?" in origin or "#" in origin:
            raise HTTPException(503, "Downloads are getting ready. Please try again later.")
        token = secrets.token_urlsafe(32)
        await db_getter().file_tickets.insert_one({"_id": digest(token), "attachment_id": attachment_id,
            "user_id": user["id"], "session_id": user["_session_id"], "expires_at": now() + timedelta(seconds=60)})
        return {"url": origin + "/api/attachments/" + attachment_id + "/content?ticket=" + token, "expires_in": 60}

    @router.get("/attachments/{attachment_id}/content")
    async def content(attachment_id: str, ticket: str = Query(min_length=32, max_length=128)):
        issued = await db_getter().file_tickets.find_one_and_delete({"_id": digest(ticket),
            "attachment_id": attachment_id, "expires_at": {"$gt": now()}})
        if not issued:
            raise HTTPException(401, "This download link has expired. Open the file in KUKU again.")
        user = await auth.session_user(issued["session_id"], issued["user_id"])
        if not user.get("email_verified"):
            raise HTTPException(403, "Verify your email before downloading files")
        doc = await visible_file(attachment_id, user)
        if doc.get("storage_provider") != "vercel":
            raise HTTPException(404, "File not found")
        stack = AsyncExitStack()
        try:
            stream = await stack.enter_async_context(blob_store.stream(doc["key"]))
        except Exception:
            await stack.aclose()
            raise HTTPException(503, "Your file couldn’t be opened. Please try again.") from None
        return StreamingResponse(stream, media_type="application/octet-stream",
            headers={"Content-Length": str(doc["size"]), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment; filename*=UTF-8''" + quote(doc["name"], safe="")},
            background=BackgroundTask(stack.aclose))

    @router.delete("/attachments/{attachment_id}")
    async def delete(attachment_id: str, user=Depends(auth.verified)):
        doc = await db_getter().attachments.find_one({"id": attachment_id, "owner_id": user["id"]})
        if not doc:
            raise HTTPException(404, "File not found")
        await run_in_threadpool(storage_for(doc.get("storage_provider", "r2")).delete, doc["key"])
        removed = await db_getter().attachments.delete_one({"id": attachment_id, "owner_id": user["id"]})
        if removed.deleted_count:
            if doc.get("quota_version") == 1:
                await release_quota(user["id"], doc["size"])
            else:
                await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -doc["size"]}})
        await db_getter().messages.update_many({"attachment_id": attachment_id}, {"$set": {"attachment_deleted": True}})
        return {"ok": True}
    return router
