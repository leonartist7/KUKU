"""Private R2 storage. Uploads stream through API with a strict byte limit."""
import os
import uuid
import tempfile
from urllib.parse import quote
import boto3
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from auth_service import now
from safety import allow_direct

MAX_BYTES = 25 * 1024 * 1024
USER_QUOTA_BYTES = 500 * 1024 * 1024

class ObjectStore:
    def client(self):
        required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
        if not all(os.getenv(k) for k in required):
            raise HTTPException(503, "File storage is not configured")
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

def attachment_router(db_getter, auth):
    router = APIRouter()
    async def member(chat_id, user):
        if not await db_getter().chats.find_one({"id": chat_id, "members": user["id"]}):
            raise HTTPException(404, "Chat not found")

    @router.post("/chats/{chat_id}/attachments")
    async def upload(chat_id: str, request: Request, name: str, user=Depends(auth.verified)):
        await member(chat_id, user)
        chat = await db_getter().chats.find_one({"id": chat_id})
        for other_id in chat["members"]:
            if other_id != user["id"]:
                await allow_direct(db_getter(), user["id"], other_id)
        await auth.limit("upload:" + user["id"], 30, 3600)
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
                await run_in_threadpool(store.put, key, file)
            except Exception:
                await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
                raise
        doc = {"id": str(uuid.uuid4()), "key": key, "chat_id": chat_id,
            "owner_id": user["id"], "name": name, "size": size, "created_at": now()}
        try:
            await db_getter().attachments.insert_one(doc)
        except Exception:
            await run_in_threadpool(store.delete, key)
            await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
            raise
        return {"id": doc["id"], "file_name": name, "file_size": size}

    @router.get("/attachments/{attachment_id}/download")
    async def download(attachment_id: str, user=Depends(auth.verified)):
        doc = await db_getter().attachments.find_one({"id": attachment_id})
        if not doc:
            raise HTTPException(404, "File not found")
        await member(doc["chat_id"], user)
        # Recipients may fetch only files actually shared in their conversation.
        if doc["owner_id"] != user["id"] and not await db_getter().messages.find_one({"attachment_id": attachment_id, "chat_id": doc["chat_id"]}):
            raise HTTPException(404, "File not found")
        return {"url": await run_in_threadpool(store.download, doc), "expires_in": 60}
    @router.delete("/attachments/{attachment_id}")
    async def delete(attachment_id: str, user=Depends(auth.verified)):
        doc = await db_getter().attachments.find_one({"id": attachment_id, "owner_id": user["id"]})
        if not doc:
            raise HTTPException(404, "File not found")
        await run_in_threadpool(store.delete, doc["key"])
        removed = await db_getter().attachments.delete_one({"id": attachment_id, "owner_id": user["id"]})
        if removed.deleted_count:
            await db_getter().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -doc["size"]}})
        await db_getter().messages.update_many({"attachment_id": attachment_id}, {"$set": {"attachment_deleted": True}})
        return {"ok": True}
    return router
