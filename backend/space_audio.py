"""Space audio uses private binary object storage; room snapshots carry references only."""
import base64
import binascii
import os
import re
import secrets
import tempfile
import time
import uuid
from contextlib import AsyncExitStack
from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from auth_service import digest, now
from attachments import provider, storage_for, USER_QUOTA_BYTES, TOTAL_QUOTA_BYTES

MAX_AUDIO_BYTES = 10 * 1024 * 1024


def audio_metadata(doc):
    return {key: doc.get(key) for key in (
        "id", "uploader_id", "uploader_name", "title", "duration_sec",
        "cover_emoji", "created_at", "size", "media_type")}


def audio_type(prefix):
    if prefix.startswith(b"ID3") or (len(prefix) > 1 and prefix[0] == 255 and prefix[1] & 224 == 224):
        return "audio/mpeg"
    if prefix.startswith(b"OggS"):
        return "audio/ogg"
    if prefix.startswith(b"RIFF") and prefix[8:12] == b"WAVE":
        return "audio/wav"
    if prefix[4:8] == b"ftyp":
        return "audio/mp4"
    if prefix.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if prefix.startswith(b"fLaC"):
        return "audio/flac"
    raise HTTPException(400, "Choose an MP3, M4A, WAV, Ogg, WebM or FLAC audio file")


def range_bounds(header, size):
    if not header:
        return 0, size - 1, 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
    if not match or not any(match.groups()):
        raise HTTPException(416, "This audio range is unavailable", headers={"Content-Range": "bytes */" + str(size)})
    start, end = match.groups()
    if not start:
        length = int(end)
        if length <= 0:
            raise HTTPException(416, "This audio range is unavailable", headers={"Content-Range": "bytes */" + str(size)})
        low, high = max(0, size - length), size - 1
    else:
        low, high = int(start), min(int(end), size - 1) if end else size - 1
    if low < 0 or low >= size or high < low:
        raise HTTPException(416, "This audio range is unavailable", headers={"Content-Range": "bytes */" + str(size)})
    return low, high, 206


def space_audio_router(get_db, auth):
    router = APIRouter()

    async def visible(upload_id, user):
        doc = await get_db().audio_uploads.find_one({"id": upload_id})
        if not doc:
            raise HTTPException(404, "Audio not found")
        if doc["uploader_id"] != user["id"]:
            room = await get_db().spaces.find_one({"members": user["id"], "content.upload_id": upload_id})
            if not room:
                raise HTTPException(404, "Audio not found")
        return doc

    async def release(user_id, size):
        await get_db().users.update_one({"id": user_id}, {"$inc": {"storage_bytes": -size}})
        await get_db().storage_usage.update_one({"_id": "files"}, {"$inc": {"bytes": -size}})

    @router.get("/audio/uploads")
    async def uploads(user=Depends(auth.verified)):
        docs = await get_db().audio_uploads.find({"uploader_id": user["id"]},
            {"data_url": 0, "key": 0}).sort("created_at", -1).limit(200).to_list(200)
        return [audio_metadata(doc) for doc in docs]

    @router.get("/audio/uploads/{upload_id}")
    async def metadata(upload_id: str, user=Depends(auth.verified)):
        return audio_metadata(await visible(upload_id, user))

    @router.post("/audio/uploads")
    async def reject_inline(user=Depends(auth.verified)):
        raise HTTPException(400, "Update KUKU and choose the audio file again. Audio now uploads privately as a file.")

    @router.post("/audio/uploads/binary")
    async def upload(request: Request, name: str = Query(min_length=1, max_length=180),
                     title: str = Query(default="", max_length=160),
                     duration_sec: float | None = Query(default=None, ge=0, le=43200, allow_inf_nan=False),
                     user=Depends(auth.verified)):
        await auth.limit("space-audio-upload:" + user["id"], 20, 3600)
        name = name.replace("\\", "/").split("/")[-1].strip()
        if not name or any(ord(c) < 32 for c in name):
            raise HTTPException(400, "Choose a file with a valid name")
        storage_name = provider()
        selected = storage_for(storage_name)
        if hasattr(selected, "require_config"):
            selected.require_config()
        key, size = "space-audio/" + str(uuid.uuid4()), 0
        with tempfile.TemporaryFile() as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise HTTPException(413, "Audio files must be 10 MB or smaller")
                file.write(chunk)
            if not size:
                raise HTTPException(400, "The audio file is empty")
            file.seek(0)
            media_type = audio_type(file.read(32))
            file.seek(0)
            reserved = await get_db().users.update_one({
                "id": user["id"], "$or": [{"storage_bytes": {"$exists": False}},
                {"storage_bytes": {"$lte": USER_QUOTA_BYTES - size}}]},
                {"$inc": {"storage_bytes": size}})
            if not reserved.matched_count:
                raise HTTPException(413, "Your file storage limit has been reached")
            try:
                await get_db().storage_usage.update_one({"_id": "files"}, {"$setOnInsert": {"bytes": 0}}, upsert=True)
                total = await get_db().storage_usage.update_one({
                    "_id": "files", "bytes": {"$lte": TOTAL_QUOTA_BYTES - size}},
                    {"$inc": {"bytes": size}})
            except Exception:
                await get_db().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
                raise
            if not total.matched_count:
                await get_db().users.update_one({"id": user["id"]}, {"$inc": {"storage_bytes": -size}})
                raise HTTPException(413, "KUKU's shared file space is full")
            try:
                await run_in_threadpool(selected.put, key, file)
            except Exception:
                await release(user["id"], size)
                raise HTTPException(503, "Your audio could not be saved. Please try again.") from None
        doc = {"id": str(uuid.uuid4()), "uploader_id": user["id"], "uploader_name": user["name"],
               "title": title.strip() or name, "name": name, "size": size,
               "key": key, "storage_provider": storage_name, "quota_version": 1,
               "duration_sec": duration_sec, "media_type": media_type,
               "cover_emoji": "🎵", "created_at": now().isoformat()}
        try:
            # Uploads may take time: do not attach bytes after an account/session was revoked.
            current = await auth.session_user(user["_session_id"], user["id"])
            if not current.get("email_verified"):
                raise HTTPException(403, "Verify your email before sharing audio")
            await get_db().audio_uploads.insert_one(doc)
        except Exception:
            try:
                await run_in_threadpool(selected.delete, key)
            finally:
                await release(user["id"], size)
            raise
        return audio_metadata(doc)

    @router.get("/audio/uploads/{upload_id}/download")
    async def download(upload_id: str, user=Depends(auth.verified)):
        doc = await visible(upload_id, user)
        await auth.limit("space-audio-download:" + user["id"], 120, 3600)
        origin = os.getenv("PUBLIC_API_ORIGIN", "").rstrip("/")
        if not re.fullmatch(r"https://[a-zA-Z0-9.-]+(?::\d+)?", origin):
            raise HTTPException(503, "Audio playback is getting ready. Please try again later.")
        token = secrets.token_urlsafe(32)
        # Reusable for a short period so a media element can request multiple byte ranges.
        # Each range request rechecks session, verification and current room membership.
        await get_db().file_tickets.insert_one({
            "_id": digest(token), "audio_upload_id": upload_id, "user_id": user["id"],
            "session_id": user["_session_id"], "expires_at": now() + timedelta(seconds=120)})
        return {"url": origin + "/api/audio/uploads/" + upload_id + "/content?ticket=" + token,
                "media_type": doc.get("media_type") or _legacy_type(doc), "expires_in": 120}

    def _legacy_type(doc):
        data_url = doc.get("data_url", "")
        media_type = data_url.split(";", 1)[0].removeprefix("data:")
        return media_type if media_type in ("audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/mp4", "audio/webm", "audio/flac") else "application/octet-stream"

    @router.get("/audio/uploads/{upload_id}/content")
    async def content(upload_id: str, request: Request, ticket: str = Query(min_length=32, max_length=128)):
        issued = await get_db().file_tickets.find_one({
            "_id": digest(ticket), "audio_upload_id": upload_id, "expires_at": {"$gt": now()}})
        if not issued:
            raise HTTPException(401, "Playback access expired. Reopen this audio in KUKU.")
        user = await auth.session_user(issued["session_id"], issued["user_id"])
        if not user.get("email_verified"):
            raise HTTPException(403, "Verify your email before listening")
        doc = await visible(upload_id, user)
        stack = AsyncExitStack()
        try:
            if "data_url" in doc:
                # Read-only compatibility: never place legacy base64 back in a room snapshot.
                raw = base64.b64decode(doc["data_url"].split(",", 1)[1], validate=True)
                if not raw or len(raw) > MAX_AUDIO_BYTES:
                    raise HTTPException(400, "This older audio file cannot be opened")
                size = len(raw)
                async def original():
                    yield raw
                source = original()
            else:
                size = doc["size"]
                selected = storage_for(doc.get("storage_provider", "r2"))
                if doc.get("storage_provider") == "vercel":
                    source = await stack.enter_async_context(selected.stream(doc["key"]))
                else:
                    response = await run_in_threadpool(selected.client().get_object,
                        Bucket=os.environ["R2_BUCKET"], Key=doc["key"])
                    body = response["Body"]
                    stack.callback(body.close)
                    async def original():
                        while True:
                            chunk = await run_in_threadpool(body.read, 64 * 1024)
                            if not chunk:
                                break
                            yield chunk
                    source = original()
            low, high, status = range_bounds(request.headers.get("range"), size)
            # Private-provider startup may take time: repeat access checks before headers.
            active = await auth.session_user(issued["session_id"], issued["user_id"])
            if not active.get("email_verified"):
                raise HTTPException(403, "Verify your email before listening")
            await visible(upload_id, active)
        except HTTPException:
            await stack.aclose()
            raise
        except (ValueError, IndexError, binascii.Error):
            await stack.aclose()
            raise HTTPException(400, "This older audio file cannot be opened") from None
        except Exception:
            await stack.aclose()
            raise HTTPException(503, "This audio could not be opened. Try again shortly.") from None

        async def selected_range():
            offset = 0
            last_check = 0.0
            try:
                async for chunk in source:
                    next_offset = offset + len(chunk)
                    if next_offset > low and offset <= high:
                        # Revalidate long transfers without adding DB round trips to every 64 KiB.
                        if time.monotonic() - last_check >= 2:
                            active = await auth.session_user(issued["session_id"], issued["user_id"])
                            if not active.get("email_verified"):
                                break
                            await visible(upload_id, active)
                            last_check = time.monotonic()
                        yield chunk[max(0, low - offset): min(len(chunk), high + 1 - offset)]
                    offset = next_offset
                    if offset > high:
                        break
            finally:
                await stack.aclose()

        response_headers = {"Content-Length": str(high - low + 1), "Accept-Ranges": "bytes",
            "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename*=UTF-8''" + quote(doc.get("name") or doc["title"], safe="")}
        if status == 206:
            response_headers["Content-Range"] = f"bytes {low}-{high}/{size}"
        return StreamingResponse(selected_range(), status_code=status,
            media_type=doc.get("media_type") or _legacy_type(doc), headers=response_headers,
            background=BackgroundTask(stack.aclose))

    @router.delete("/audio/uploads/{upload_id}")
    async def delete(upload_id: str, user=Depends(auth.verified)):
        doc = await get_db().audio_uploads.find_one({"id": upload_id, "uploader_id": user["id"]})
        if not doc:
            raise HTTPException(404, "Audio not found")
        if await get_db().spaces.find_one({"content.upload_id": upload_id}):
            raise HTTPException(409, "Choose different audio in its Space before removing this file")
        if doc.get("key"):
            await run_in_threadpool(storage_for(doc.get("storage_provider", "r2")).delete, doc["key"])
        removed = await get_db().audio_uploads.delete_one({"id": upload_id, "uploader_id": user["id"]})
        if removed.deleted_count and doc.get("quota_version") == 1:
            await release(user["id"], doc["size"])
        return {"ok": True}

    return router

