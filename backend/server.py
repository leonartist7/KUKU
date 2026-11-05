from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import asyncio
import weakref
import uuid
import logging
import bcrypt
import jwt
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from auth_service import AuthService, hash_password, verify_password, profile
from auth_service import digest
from space_audio import space_audio_router
from chat_events import ChatEvents
from chat_actions import ChatActions, public_message as chat_message_view, request_fingerprint, same_send
from account_privacy import account_privacy_router, account_privacy_indexes
import settings
from safety import safety_router, allow_direct
from attachments import attachment_router
from account_recovery import recovery_router
from push_service import device_router, run_worker
from web_push import web_push_router, configured as web_push_configured
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from livekit import api as lkapi

# ---------- Config ----------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("connect")

MONGO_URL = settings.MONGO_URL
DB_NAME = settings.DB_NAME
JWT_SECRET = settings.JWT_SECRET
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
auth = AuthService(db)
chat_events = ChatEvents(lambda: db, auth)
chat_actions = ChatActions(lambda: db, auth, chat_events)
get_current_user = auth.verified


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.command("ping")
    await auth.indexes()
    await chat_events.indexes()
    await chat_actions.indexes()
    await account_privacy_indexes(db)
    await db.calls.create_index([("status", 1), ("expires_at", 1)])
    await db.calls.create_index("id", unique=True)
    await db.calls.create_index([("members", 1), ("created_at", -1)])
    await db.call_leases.create_index("expires_at", expireAfterSeconds=0)
    await db.space_messages.create_index([("space_id", 1), ("created_at", 1), ("id", 1)])
    await db.space_messages.create_index([("space_id", 1), ("sender_id", 1), ("client_message_id", 1)],
        unique=True, partialFilterExpression={"client_message_id": {"$type": "string"}})
    await db.spaces.create_index([("members", 1), ("updated_at", -1)])
    await db.spaces.create_index("id", unique=True)
    await db.audio_uploads.create_index("id", unique=True)
    await db.blocks.create_index("owner_id")
    await db.reports.create_index([("status", 1), ("created_at", 1)])
    await db.account_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.attachments.create_index("id", unique=True)
    await db.chats.create_index("key", unique=True)
    await db.messages.create_index([("chat_id", 1), ("created_at", 1), ("id", 1)])
    await db.messages.create_index([("chat_id", 1), ("sender_id", 1), ("client_message_id", 1)],
        unique=True, partialFilterExpression={"client_message_id": {"$type": "string"}})
    await db.messages.create_index([("push_state", 1), ("push_due", 1)])
    await db.push_receipts.create_index("expires_at", expireAfterSeconds=0)
    if settings.SEED_DEMO_DATA:
        await seed()
    worker = asyncio.create_task(run_worker(db)) if settings.PUSH_ENABLED or web_push_configured() else None
    room_worker = asyncio.create_task(room_lifecycle_worker())
    try:
        yield
    finally:
        room_worker.cancel()
        with suppress(asyncio.CancelledError):
            await room_worker
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        client.close()


app = FastAPI(title="KUKU API", lifespan=lifespan)
app.websocket("/ws/messages")(chat_events.socket)
api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(safety_router(lambda: db, auth))
api.include_router(device_router(lambda: db, auth))
api.include_router(web_push_router(lambda: db, auth))
api.include_router(recovery_router(lambda: db, auth))
api.include_router(attachment_router(lambda: db, auth, chat_events))
api.include_router(space_audio_router(lambda: db, auth))
api.include_router(chat_events.router)
api.include_router(chat_actions.router)
api.include_router(account_privacy_router(lambda: db, auth))


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Never echo credentials/large payloads or non-JSON NaN values from invalid input.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": item["loc"], "msg": item["msg"], "type": item["type"]}
        for item in error.errors()]})

@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def public_message(message, chat=None):
    return chat_message_view(message, chat)

def serialize_user(user: dict) -> dict:
    return profile(user)


# ---------- Models ----------
EMOTE_IDS = frozenset("fluent:" + slug for slug in ("heart","hug","laugh","love","kiss","think","party","smile","sleep","wow","fire","confetti"))
class MessageIn(BaseModel):
    chat_id: str
    type: Literal["text", "voice", "image", "file", "space_invite", "emote"]
    text: Optional[str] = Field(default=None, max_length=10000)
    emote_id: Optional[str] = Field(default=None, max_length=40)
    client_message_id: Optional[str] = Field(default=None, max_length=100)
    media: Optional[str] = Field(default=None, max_length=100)
    attachment_id: Optional[str] = Field(default=None, max_length=100)
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    duration_ms: Optional[int] = None  # for voice
    space_id: Optional[str] = None  # for space_invite
    space_name: Optional[str] = None
    reply_to_id: Optional[str] = Field(default=None, min_length=1, max_length=100)


class ChatCreateIn(BaseModel):
    other_user_id: str


class CallCreateIn(BaseModel):
    other_user_id: str
    duration_sec: int = 0
    status: Literal["completed", "missed", "outgoing", "incoming"] = "completed"


# ---------- Users ----------
@api.get("/users")
async def list_users(current=Depends(get_current_user)):
    ids = await auth.contacts(current["id"])
    users = await db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "password_hash": 0}).to_list(200)
    return [serialize_user(u) for u in users]


# ---------- Chats ----------
def chat_key(a: str, b: str) -> str:
    return ":".join(sorted([a, b]))


@api.get("/chats")
async def list_chats(current=Depends(get_current_user)):
    chats = await db.chats.find({"members": current["id"]}, {"_id": 0}).to_list(500)
    # Two bounded batch reads replace two serial lookups for every conversation.
    chat_ids = [chat["id"] for chat in chats]
    other_ids = list({uid for chat in chats for uid in chat["members"] if uid != current["id"]})
    users = await db.users.find({"id": {"$in": other_ids}}, {"_id": 0, "password_hash": 0}).to_list(1000) if other_ids else []
    users_by_id = {user["id"]: user for user in users}
    latest = await db.messages.aggregate([
        {"$match": {"chat_id": {"$in": chat_ids}}},
        {"$sort": {"chat_id": -1, "created_at": -1, "id": -1}},
        {"$group": {"_id": "$chat_id", "message": {"$first": "$$ROOT"}}},
    ]).to_list(500) if chat_ids else []
    last_by_chat = {row["_id"]: row["message"] for row in latest}
    out = []
    for c in chats:
        other_id = next((m for m in c["members"] if m != current["id"]), None)
        other = users_by_id.get(other_id)
        last_msg = last_by_chat.get(c["id"])
        out.append(
            {
                "id": c["id"],
                "type": c.get("type", "dm"),
                "other": serialize_user(other) if other else None,
                "last_message": public_message(last_msg, c),
                "updated_at": c.get("updated_at", c.get("created_at")),
            }
        )
    out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return out


@api.post("/chats")
async def create_chat(payload: ChatCreateIn, current=Depends(get_current_user)):
    if payload.other_user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot chat with yourself")
    other = await db.users.find_one({"id": payload.other_user_id}, {"_id": 0})
    if not other:
        raise HTTPException(status_code=404, detail="User not found")
    await auth.require_contact(current["id"], payload.other_user_id)
    key = chat_key(current["id"], payload.other_user_id)
    existing = await db.chats.find_one({"key": key}, {"_id": 0})
    if existing:
        return {"id": existing["id"], "type": existing.get("type", "dm")}
    chat = {
        "id": str(uuid.uuid4()),
        "key": key,
        "type": "dm",  # future: "space"
        "members": [current["id"], payload.other_user_id],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    try:
        await db.chats.insert_one(chat)
    except DuplicateKeyError:
        chat = await db.chats.find_one({"key": key})
    return {"id": chat["id"], "type": chat["type"]}


@api.get("/chats/{chat_id}")
async def get_chat(chat_id: str, current=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "members": current["id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    other_id = next((m for m in chat["members"] if m != current["id"]), None)
    other = await db.users.find_one({"id": other_id}, {"_id": 0, "password_hash": 0}) if other_id else None
    return {
        "id": chat["id"],
        "type": chat.get("type", "dm"),
        "other": serialize_user(other) if other else None,
    }


@api.get("/chats/{chat_id}/messages")
async def list_messages(chat_id: str, before: Optional[str] = None, after: Optional[str] = None, limit: int = Query(50, ge=1, le=100), current=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "members": current["id"]})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    query = {"chat_id": chat_id}
    if before and after:
        raise HTTPException(400, "Choose before or after")
    cursor = before or after
    if cursor:
        anchor = await db.messages.find_one({"chat_id": chat_id, "id": cursor})
        if not anchor:
            raise HTTPException(400, "Invalid message cursor")
        op = "$lt" if before else "$gt"
        query["$or"] = [{"created_at": {op: anchor["created_at"]}},
            {"created_at": anchor["created_at"], "id": {op: anchor["id"]}}]
    direction = 1 if after else -1
    msgs = await db.messages.find(query, {"_id": 0}).sort([("created_at", direction), ("id", direction)]).limit(limit).to_list(limit)
    return [public_message(m, chat) for m in (msgs if after else list(reversed(msgs)))]


@api.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, payload: MessageIn, current=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "members": current["id"]})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    for other_id in chat["members"]:
        if other_id != current["id"]:
            await allow_direct(db, current["id"], other_id)
    if payload.chat_id != chat_id:
        raise HTTPException(400, "Conversation does not match")
    if payload.client_message_id:
        previous = await db.messages.find_one({"chat_id": chat_id, "sender_id": current["id"], "client_message_id": payload.client_message_id}, {"_id": 0})
        if previous:
            if not same_send(previous, payload):
                raise HTTPException(409, "Message ID already used")
            await chat_events.publish_message(chat, previous)
            return public_message(previous, chat)
    if payload.type == "emote":
        if payload.emote_id not in EMOTE_IDS or any((payload.text, payload.media, payload.attachment_id, payload.space_id, payload.space_name, payload.duration_ms, payload.file_name, payload.file_size)):
            raise HTTPException(400, "Choose an emote from the KUKU collection")
    elif payload.emote_id is not None:
        raise HTTPException(400, "Emotes must use an emote message")
    if payload.type == "text" and not (payload.text or "").strip():
        raise HTTPException(400, "Empty message")
    if payload.media:
        raise HTTPException(400, "Upload files through the attachments endpoint")
    if payload.reply_to_id:
        original = await db.messages.find_one({"id": payload.reply_to_id, "chat_id": chat_id,
                                               "deleted_at": {"$exists": False}})
        if not original:
            raise HTTPException(400, "Reply to an existing message in this conversation")
    attachment = None
    if payload.type in ("file", "image", "voice"):
        attachment = await db.attachments.find_one({"id": payload.attachment_id, "chat_id": chat_id, "owner_id": current["id"]})
        if not attachment:
            raise HTTPException(400, "Upload a file to this conversation first")
        if payload.type == "voice" and (attachment.get("kind") != "voice" or not payload.duration_ms or not 250 <= payload.duration_ms <= 300000):
            raise HTTPException(400, "Upload a voice recording of up to five minutes first")
    if payload.type == "space_invite":
        space = await db.spaces.find_one({"id": payload.space_id})
        if not space or not set(chat["members"]).issubset(space["members"]):
            raise HTTPException(403, "Space membership is required for all recipients")
    # Legacy media limit while old messages remain readable.
    if payload.media and len(payload.media) > 14 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Media is too large (max ~10MB)")
    msg = {
        "id": str(uuid.uuid4()),
        "chat_id": chat_id,
        "sync_pending": True,
        "revision": 0,
        "_request_fingerprint": request_fingerprint(payload),
        **({"client_message_id": payload.client_message_id} if payload.client_message_id else {}),
        "sender_id": current["id"],
        "sender_name": current["name"],
        "type": payload.type,
        "emote_id": payload.emote_id,
        "text": payload.text,
        "media": payload.media,
        "attachment_id": payload.attachment_id,
        "file_name": attachment["name"] if attachment else None,
        "file_size": attachment["size"] if attachment else None,
        "duration_ms": payload.duration_ms,
        "space_id": payload.space_id,
        "space_name": payload.space_name,
        "reply_to_id": payload.reply_to_id,
        "created_at": now_iso(),
    }
    if settings.PUSH_ENABLED or web_push_configured():
        from auth_service import now
        msg.update({"push_state": "pending", "push_due": now(), "push_attempts": 0})
    try:
        await db.messages.insert_one(msg)
    except DuplicateKeyError:
        previous = await db.messages.find_one({"chat_id": chat_id, "sender_id": current["id"], "client_message_id": payload.client_message_id}, {"_id": 0})
        if not previous or not same_send(previous, payload):
            raise HTTPException(409, "Message ID already used")
        await chat_events.publish_message(chat, previous)
        return public_message(previous, chat)
    await db.chats.update_one({"id": chat_id}, {"$set": {"updated_at": msg["created_at"]}})
    await chat_events.publish_message(chat, msg)
    return public_message(msg, chat)


# ---------- Files Hub ----------
@api.get("/files")
async def list_files(current=Depends(get_current_user)):
    """Aggregate all non-text messages from chats current user belongs to."""
    user_chats = await db.chats.find({"members": current["id"]}, {"_id": 0, "id": 1}).to_list(500)
    chat_ids = [c["id"] for c in user_chats]
    msgs = await db.messages.find(
        {"chat_id": {"$in": chat_ids}, "type": {"$in": ["image", "file", "voice"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
    # attach sender info briefly
    sender_ids = list({m["sender_id"] for m in msgs})
    senders = {
        u["id"]: u
        for u in await db.users.find({"id": {"$in": sender_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)
    }
    out = []
    for m in msgs:
        s = senders.get(m["sender_id"])
        out.append({**public_message(m), "sender": serialize_user(s) if s else None})
    return out


# ---------- Calls (authoritative signaling; media readiness is separate) ----------
RING_SECONDS = 45
ACTIVE_CALL_SECONDS = 120


def _require_calls():
    if not settings.ENABLE_CALLS:
        raise HTTPException(503, "Calls are not enabled for this release")


def _call_view(c: dict, other: Optional[dict] = None, current: Optional[dict] = None) -> dict:
    view = {key: c.get(key) for key in (
        "id", "members", "initiator_id", "status", "started_at", "accepted_at",
        "media_ready_at", "ended_at", "created_at", "expires_at", "end_reason")}
    view["duration_sec"] = c.get("duration_sec", 0)
    view["other"] = serialize_user(other) if other else None
    if current:
        key = "initiator_session_id" if current["id"] == c.get("initiator_id") else "accepted_by_session_id"
        view["can_join_media"] = c.get(key) == current.get("_session_id")
    return view


async def _call_event(call: dict, event: str):
    # Own devices also reconcile answer/end state. Never serialize session IDs.
    for member_id in call["members"]:
        await call_hub.send_to(member_id, {
            "type": event, "call_id": call["id"], "status": call["status"],
            "end_reason": call.get("end_reason"), "call": _call_view(call),
        })


async def _disconnect_call_media(call: dict):
    if not call.get("token_issued") or not all((LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)):
        return
    try:
        async with lkapi.LiveKitAPI(url=LIVEKIT_URL, api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET) as service:
            await asyncio.wait_for(asyncio.gather(*(
                service.room.remove_participant(lkapi.RoomParticipantIdentity(
                    room="call-" + call["id"], identity=member_id))
                for member_id in call["members"])), timeout=5)
        await db.calls.update_one({"id": call["id"]}, {"$set": {"revocation_pending": False}})
    except Exception:
        # Revocation must not rely only on the recipient's UI. Retry in the worker.
        await db.calls.update_one({"id": call["id"]}, {"$set": {"revocation_pending": True}})
        logger.warning("Call media removal pending for call %s", call["id"])


async def _finish_call(call: dict, expected_status: str, status: str, reason: str, event: str):
    async with _call_token_lock(call["id"]):
        return await _finish_call_locked(call, expected_status, status, reason, event)


async def _finish_call_locked(call: dict, expected_status: str, status: str, reason: str, event: str):
    ended = now_iso()
    duration = 0
    if call.get("media_ready_at"):
        duration = max(0, int((datetime.now(timezone.utc) - datetime.fromisoformat(call["media_ready_at"])).total_seconds()))
    query = {"id": call["id"], "status": expected_status}
    if reason in ("ringing_timeout", "connection_lost"):
        query["expires_at"] = call.get("expires_at", {"$exists": False})
    changed = await db.calls.find_one_and_update(
        query,
        {"$set": {"status": status, "ended_at": ended, "duration_sec": duration,
                  "end_reason": reason, "updated_at": ended}},
        return_document=ReturnDocument.AFTER)
    if not changed:
        return await db.calls.find_one({"id": call["id"]})
    await db.call_leases.delete_many({"call_id": call["id"]})
    await _call_event(changed, event)
    await _disconnect_call_media(changed)
    return changed


async def expire_calls():
    timestamp = now_iso()
    expired = await db.calls.find({
        "status": {"$in": ["ringing", "active"]},
        "$or": [{"expires_at": {"$lte": timestamp}},
                {"status": "ringing", "expires_at": {"$exists": False},
                 "created_at": {"$lte": (datetime.now(timezone.utc) - timedelta(seconds=RING_SECONDS)).isoformat()}}],
    }).limit(100).to_list(100)
    for call in expired:
        ringing = call["status"] == "ringing"
        await _finish_call(call, call["status"], "missed" if ringing else "completed",
                           "ringing_timeout" if ringing else "connection_lost",
                           "call_missed" if ringing else "call_ended")


async def room_lifecycle_worker():
    while True:
        try:
            await chat_events.repair_pending()
            if settings.ENABLE_CALLS:
                await expire_calls()
                for call in await db.calls.find({"status": {"$in": ["ringing", "active"]}}).limit(100).to_list(100):
                    sessions = [(call["initiator_id"], call.get("initiator_session_id"))]
                    if call["status"] == "active":
                        sessions.append((next(uid for uid in call["members"] if uid != call["initiator_id"]),
                                         call.get("accepted_by_session_id")))
                    try:
                        for uid, sid in sessions:
                            active = await auth.session_user(sid, uid)
                            if not active.get("email_verified"):
                                raise HTTPException(403, "Verification required")
                        await allow_direct(db, call["members"][0], call["members"][1])
                    except HTTPException:
                        await _finish_call(call, call["status"], "completed" if call["status"] == "active" else "missed",
                                           "session_ended", "call_ended")
                for call in await db.calls.find({"revocation_pending": True}).limit(20).to_list(20):
                    await _disconnect_call_media(call)
            # Expired Space connections are also removed when no clients are reading.
            for space in await db.spaces.find({"presence_connections": {"$exists": True}}).limit(200).to_list(200):
                await _prune_space_connections(space["id"])
        except Exception:
            logger.warning("Room lifecycle maintenance will retry")
        await asyncio.sleep(15)


async def _authorized_call(call_id: str, current: dict) -> dict:
    _require_calls()
    await expire_calls()
    call = await db.calls.find_one({"id": call_id, "members": current["id"]})
    if not call:
        raise HTTPException(404, "Call not found")
    return call


async def _call_contacts(call: dict, current: dict):
    for other_id in call["members"]:
        if other_id != current["id"]:
            await auth.require_contact(current["id"], other_id)
            await allow_direct(db, current["id"], other_id)
            other = await db.users.find_one({"id": other_id, "email_verified": True})
            if not other or other.get("disabled"):
                raise HTTPException(403, "This person is unavailable")


def _require_call_session(call: dict, current: dict):
    key = "initiator_session_id" if current["id"] == call["initiator_id"] else "accepted_by_session_id"
    if call.get(key) != current.get("_session_id"):
        raise HTTPException(409, "This call is open on another device")


async def user_active_call(user_id: str) -> Optional[dict]:
    return await db.calls.find_one(
        {"members": user_id, "status": {"$in": ["ringing", "active"]}}, {"_id": 0})


@api.get("/calls")
async def list_calls(current=Depends(get_current_user)):
    _require_calls()
    await expire_calls()
    calls = await db.calls.find({"members": current["id"]}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    out = []
    for call in calls:
        other_id = next((m for m in call["members"] if m != current["id"]), None)
        other = await db.users.find_one({"id": other_id}) if other_id else None
        out.append(_call_view(call, other, current))
    return out


@api.get("/calls/{call_id}")
async def get_call(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    other_id = next((m for m in call["members"] if m != current["id"]), None)
    other = await db.users.find_one({"id": other_id}) if other_id else None
    return _call_view(call, other, current)


@api.post("/calls")
async def create_call(payload: CallCreateIn, current=Depends(get_current_user)):
    _require_calls()
    if not all((LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)):
        raise HTTPException(503, "Calls are getting ready. Please try again later.")
    if payload.other_user_id == current["id"]:
        raise HTTPException(400, "Cannot call yourself")
    await auth.require_contact(current["id"], payload.other_user_id)
    await allow_direct(db, current["id"], payload.other_user_id)
    other = await db.users.find_one({"id": payload.other_user_id, "email_verified": True})
    if not other or other.get("disabled"):
        raise HTTPException(404, "User not found")
    await auth.limit("call:" + current["id"], 20, 60)
    await expire_calls()
    members = [current["id"], payload.other_user_id]
    for member_id in members:
        if await user_active_call(member_id):
            raise HTTPException(409, "You're already in a call" if member_id == current["id"] else "This person is busy")
    timestamp = datetime.now(timezone.utc)
    expires = timestamp + timedelta(seconds=RING_SECONDS)
    call = {"id": str(uuid.uuid4()), "members": members,
            "initiator_id": current["id"], "initiator_session_id": current["_session_id"],
            "status": "ringing", "duration_sec": 0, "started_at": None,
            "accepted_at": None, "media_ready_at": None, "ended_at": None,
            "created_at": timestamp.isoformat(), "expires_at": expires.isoformat(),
            "end_reason": None, "media_ready_members": []}
    # One unique _id per participant. Sorted acquisition avoids opposing partial locks.
    # A crash during acquisition can only reserve someone until the short ringing lease expires.
    try:
        for member_id in sorted(members):
            try:
                await db.call_leases.find_one_and_update(
                    {"_id": member_id, "expires_at": {"$lte": timestamp}},
                    {"$set": {"call_id": call["id"], "expires_at": expires}},
                    upsert=True, return_document=ReturnDocument.AFTER)
            except DuplicateKeyError:
                raise HTTPException(409, "A participant is already in another call") from None
        await db.calls.insert_one(call)
    except Exception:
        await db.call_leases.delete_many({"call_id": call["id"]})
        raise
    await call_hub.send_to(payload.other_user_id, {
        "type": "incoming_call", "call": _call_view(call),
        "from": {"id": current["id"], "name": current["name"]}})
    return _call_view(call, other, current)


@api.post("/calls/{call_id}/accept")
async def accept_call(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["initiator_id"] == current["id"]:
        raise HTTPException(400, "Cannot accept your own call")
    await _call_contacts(call, current)
    if call["status"] == "active":
        _require_call_session(call, current)
        return _call_view(call, current=current)
    timestamp = datetime.now(timezone.utc)
    changed = await db.calls.find_one_and_update(
        {"id": call_id, "status": "ringing", "expires_at": {"$gt": timestamp.isoformat()}},
        {"$set": {"status": "active", "accepted_at": timestamp.isoformat(),
                  "accepted_by_session_id": current["_session_id"],
                  "heartbeats": {uid: timestamp.isoformat() for uid in call["members"]},
                  "updated_at": timestamp.isoformat(),
                  "expires_at": (timestamp + timedelta(seconds=ACTIVE_CALL_SECONDS)).isoformat()}},
        return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "This call has already been answered or ended")
    await db.call_leases.update_many({"call_id": call_id},
        {"$set": {"expires_at": timestamp + timedelta(seconds=ACTIVE_CALL_SECONDS)}})
    await _call_event(changed, "call_accepted")
    return _call_view(changed, current=current)


@api.post("/calls/{call_id}/decline")
async def decline_call(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["initiator_id"] == current["id"]:
        raise HTTPException(400, "Cannot decline your own call")
    if call["status"] in ("completed", "missed"):
        return _call_view(call, current=current)
    if call["status"] != "ringing":
        raise HTTPException(409, "This call has already been answered")
    finished = await _finish_call(call, "ringing", "missed", "declined", "call_declined")
    if finished["status"] == "active":
        raise HTTPException(409, "This call has already been answered")
    return _call_view(finished, current=current)


@api.post("/calls/{call_id}/cancel")
async def cancel_call(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["initiator_id"] != current["id"]:
        raise HTTPException(403, "Only the caller can cancel")
    if call["status"] in ("completed", "missed"):
        return _call_view(call, current=current)
    if call["status"] != "ringing":
        raise HTTPException(409, "This call has already been answered. Use Hang up.")
    finished = await _finish_call(call, "ringing", "missed", "cancelled", "call_missed")
    if finished["status"] == "active":
        raise HTTPException(409, "This call has already been answered. Use Hang up.")
    return _call_view(finished, current=current)


@api.post("/calls/{call_id}/end")
async def end_call(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["status"] in ("completed", "missed"):
        return _call_view(call, current=current)
    if call["status"] != "active":
        raise HTTPException(409, "This call has not been answered")
    return _call_view(await _finish_call(call, "active", "completed", "hangup", "call_ended"), current=current)


class CallHeartbeatIn(BaseModel):
    media_ready: bool = False


@api.post("/calls/{call_id}/heartbeat")
async def call_heartbeat(call_id: str, payload: CallHeartbeatIn, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["status"] != "active":
        raise HTTPException(409, "This call has ended")
    _require_call_session(call, current)
    await _call_contacts(call, current)
    timestamp = datetime.now(timezone.utc)
    change = {"$set": {"heartbeats." + current["id"]: timestamp.isoformat()}}
    if payload.media_ready:
        change["$addToSet"] = {"media_ready_members": current["id"]}
    changed = await db.calls.find_one_and_update(
        {"id": call_id, "status": "active"}, change, return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "This call has ended")
    # Both participants must stay alive. One healthy device cannot hold an abandoned call forever.
    heartbeats = changed.get("heartbeats") or {}
    oldest = min(heartbeats.get(uid) or changed.get("accepted_at") or timestamp.isoformat() for uid in call["members"])
    expires = datetime.fromisoformat(oldest) + timedelta(seconds=ACTIVE_CALL_SECONDS)
    await db.calls.update_one({"id": call_id, "status": "active"}, {"$max": {"expires_at": expires.isoformat()}})
    if set(changed.get("media_ready_members", [])) == set(call["members"]) and not changed.get("media_ready_at"):
        await db.calls.update_one({"id": call_id, "status": "active", "media_ready_at": None},
            {"$set": {"media_ready_at": timestamp.isoformat(), "started_at": timestamp.isoformat()}})
        changed = await db.calls.find_one({"id": call_id})
    changed = await db.calls.find_one({"id": call_id})
    if changed["status"] == "active":
        await db.call_leases.update_many({"call_id": call_id},
            {"$max": {"expires_at": datetime.fromisoformat(changed["expires_at"])}})
    return _call_view(changed, current=current)


class CallTokenOut(BaseModel):
    url: str
    room: str
    token: str


@api.post("/calls/{call_id}/token")
async def call_token(call_id: str, current=Depends(get_current_user)):
    call = await _authorized_call(call_id, current)
    if call["status"] != "active":
        raise HTTPException(409, "Answer the call before connecting audio")
    _require_call_session(call, current)
    await _call_contacts(call, current)
    if not all((LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)):
        raise HTTPException(503, "Calls are getting ready. Please try again later.")
    await auth.limit("call-token:" + current["id"], 30, 60)
    # Ending a call and minting a token use the same per-call lock in this single-worker beta.
    async with _call_token_lock(call_id):
        call = await db.calls.find_one({"id": call_id, "status": "active"})
        if not call:
            raise HTTPException(409, "This call has ended")
        await db.calls.update_one({"id": call_id}, {"$set": {"token_issued": True}})
        room = "call-" + call_id
        token = (lkapi.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
            .with_identity(current["id"]).with_name(current["name"])
            .with_ttl(timedelta(seconds=120))
            .with_grants(lkapi.VideoGrants(room_join=True, room=room, can_publish=True,
                                         can_subscribe=True, can_publish_data=False,
                                         can_publish_sources=["microphone"]))
            .to_jwt())
    return CallTokenOut(url=LIVEKIT_URL, room=room, token=token)


# Locks are scoped by active call and pruned on completion; this is not shared fan-out.
_call_token_locks = weakref.WeakValueDictionary()


def _call_token_lock(call_id):
    return _call_token_locks.setdefault(call_id, asyncio.Lock())
# ---------- Health ----------
@api.get("/")
async def root():
    return {"ok": True, "name": "Connect API"}


# ---------- Seed ----------
DEMO_USERS = [
    {"email": "ava@connect.app", "name": "Ava Fields", "password": "connect123",
     "bio": "Designer · loves slow mornings."},
    {"email": "leo@connect.app", "name": "Leo Marsh", "password": "connect123",
     "bio": "Writes letters · drinks tea."},
    {"email": "noor@connect.app", "name": "Noor Patel", "password": "connect123",
     "bio": "Architect · plant collector."},
    {"email": "sage@connect.app", "name": "Sage Okafor", "password": "connect123",
     "bio": "Runs on jazz and rain."},
]


async def seed():
    await db.users.create_index("email", unique=True)
    await db.chats.create_index("members")
    await db.messages.create_index([("chat_id", 1), ("created_at", 1)])
    await db.calls.create_index("members")

    # ensure all demo users
    user_ids = {}
    for u in DEMO_USERS:
        existing = await db.users.find_one({"email": u["email"]}, {"_id": 0})
        if existing:
            user_ids[u["email"]] = existing["id"]
        else:
            doc = {
                "id": str(uuid.uuid4()),
                "email": u["email"],
                "name": u["name"],
                "password_hash": hash_password(u["password"]),
                "avatar": None,
                "bio": u["bio"],
                "created_at": now_iso(),
            }
            await db.users.insert_one(doc)
            user_ids[u["email"]] = doc["id"]

    ava = user_ids["ava@connect.app"]
    leo = user_ids["leo@connect.app"]
    noor = user_ids["noor@connect.app"]
    sage = user_ids["sage@connect.app"]

    # only seed chats once
    if await db.chats.count_documents({}) > 0:
        return

    async def make_chat(a: str, b: str, msgs: list):
        chat = {
            "id": str(uuid.uuid4()),
            "key": chat_key(a, b),
            "type": "dm",
            "members": [a, b],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.chats.insert_one(chat)
        base_time = datetime.now(timezone.utc) - timedelta(hours=2)
        last_t = (base_time).isoformat()
        for i, m in enumerate(msgs):
            t = (base_time + timedelta(minutes=i * 3)).isoformat()
            doc = {
                "id": str(uuid.uuid4()),
                "chat_id": chat["id"],
                "sender_id": m["sender"],
                "sender_name": next(u["name"] for u in DEMO_USERS if user_ids[u["email"]] == m["sender"]),
                "type": m.get("type", "text"),
                "text": m.get("text"),
                "media": m.get("media"),
                "file_name": m.get("file_name"),
                "file_size": m.get("file_size"),
                "duration_ms": m.get("duration_ms"),
                "created_at": t,
            }
            await db.messages.insert_one(doc)
            last_t = t
        await db.chats.update_one({"id": chat["id"]}, {"$set": {"updated_at": last_t}})

    await make_chat(ava, leo, [
        {"sender": leo, "text": "morning ☀️ how did the sketches go?"},
        {"sender": ava, "text": "slow but good. trying to keep things quiet."},
        {"sender": leo, "text": "sending you something I wrote last night"},
        {"sender": leo, "type": "file", "file_name": "letter-march.txt", "file_size": 1240},
        {"sender": ava, "text": "this is beautiful. thank you."},
        {"sender": ava, "type": "voice", "duration_ms": 7400},
    ])
    await make_chat(ava, noor, [
        {"sender": noor, "text": "the new place finally has light in the kitchen"},
        {"sender": noor, "type": "image", "file_name": "kitchen.jpg", "file_size": 88200},
        {"sender": ava, "text": "oh wow. plants will be so happy."},
        {"sender": noor, "text": "come over saturday?"},
    ])
    await make_chat(ava, sage, [
        {"sender": sage, "text": "playlist incoming"},
        {"sender": sage, "type": "file", "file_name": "rainy-jazz.m3u", "file_size": 540},
        {"sender": ava, "text": "perfect for tonight"},
    ])

    # seed a call
    await db.calls.insert_one({
        "id": str(uuid.uuid4()),
        "members": [ava, leo],
        "initiator_id": leo,
        "duration_sec": 184,
        "status": "completed",
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat(),
    })


# ---------- Spaces (Phase 2) ----------
import asyncio
import re
import json as _json

# KUKU has no licensed bundled music catalog. Listen together uses private uploads.
AUDIO_LIBRARY = []


def _yt_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|v/|shorts/))([\w-]{11})", url)
    if m:
        return m.group(1)
    # Accept bare 11-char id
    m2 = re.fullmatch(r"[\w-]{11}", url.strip())
    return m2.group(0) if m2 else None


# WebSocket connection pool, keyed by space id
class SpaceHub:
    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def join(self, space_id: str, ws: WebSocket):
        async with self.lock:
            self.rooms.setdefault(space_id, set()).add(ws)

    async def leave(self, space_id: str, ws: WebSocket):
        async with self.lock:
            if space_id in self.rooms:
                self.rooms[space_id].discard(ws)
                if not self.rooms[space_id]:
                    del self.rooms[space_id]

    async def broadcast(self, space_id: str, message: dict):
        sockets = list(self.rooms.get(space_id, []))
        dead = []
        for ws in sockets:
            try:
                identity = ws.scope.get("kuku_user")
                if identity:
                    active = await auth.session_user(identity["_session_id"], identity["id"])
                    if not active.get("email_verified"):
                        raise HTTPException(403, "Verification required")
                    if not await db.spaces.find_one({"id": space_id, "members": identity["id"]}):
                        raise HTTPException(404, "Space not found")
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
                try:
                    await ws.close(code=4401)
                except Exception:
                    pass
        if dead:
            async with self.lock:
                for ws in dead:
                    self.rooms.get(space_id, set()).discard(ws)


hub = SpaceHub()


# Call signaling hub — sockets keyed by user id
class CallHub:
    def __init__(self):
        self.clients: dict[str, set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def register(self, user_id: str, ws: WebSocket):
        async with self.lock:
            self.clients.setdefault(user_id, set()).add(ws)

    async def unregister(self, user_id: str, ws: WebSocket):
        async with self.lock:
            sockets = self.clients.get(user_id)
            if sockets:
                sockets.discard(ws)
                if not sockets:
                    del self.clients[user_id]

    async def send_to(self, user_id: str, message: dict):
        sockets = list(self.clients.get(user_id, []))
        dead = []
        for ws in sockets:
            try:
                identity = ws.scope.get("kuku_user")
                if identity:
                    active = await auth.session_user(identity["_session_id"], identity["id"])
                    if not active.get("email_verified"):
                        raise HTTPException(403, "Verification required")
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
                with suppress(Exception):
                    await ws.close(code=4401)
        if dead:
            async with self.lock:
                for ws in dead:
                    self.clients.get(user_id, set()).discard(ws)


call_hub = CallHub()


PRESENCE_SECONDS = 75


def _valid_connections(space):
    threshold = now_iso()
    return {key: value for key, value in (space.get("presence_connections") or {}).items()
            if value.get("expires_at", "") > threshold and value.get("user_id") in space.get("members", [])}


def _public_presence(space):
    presence = {}
    for value in _valid_connections(space).values():
        uid, at = value["user_id"], value.get("at", "")
        if at > presence.get(uid, ""):
            presence[uid] = at
    return presence


def _safe_space_content(content):
    if not content:
        return None
    content = dict(content)
    # Legacy room records may contain the entire base64 file. Only return its reference.
    if content.get("source") == "upload":
        content.pop("url", None)
    return content


def _serialize_space(s: dict, users_by_id: dict | None = None) -> dict:
    presence = _public_presence(s)
    state = dict(s.get("state") or {
        "is_playing": False, "position_sec": 0.0,
        "host_id": s.get("creator_id"), "updated_at": s.get("created_at")})
    version = s.get("version", 0)
    timestamp = now_iso()
    state.update({"version": version, "session_id": s.get("session_id"),
                  "server_time": timestamp})
    return {
        "id": s["id"], "name": s.get("name") or "Untitled space",
        "creator_id": s.get("creator_id"), "members": s.get("members", []),
        "member_users": [serialize_user(users_by_id[uid]) for uid in s.get("members", [])
                         if users_by_id and uid in users_by_id],
        "presence": presence, "active_members": list(presence), "mode": s.get("mode", "idle"),
        "content": _safe_space_content(s.get("content")), "state": state,
        "version": version, "server_time": timestamp, "session_id": s.get("session_id"),
        "created_at": s.get("created_at"), "updated_at": s.get("updated_at")}


def _space_cas(space):
    return {"id": space["id"], "version": space.get("version", {"$exists": False})}


def _position_now(space):
    state = space.get("state") or {}
    position = state.get("position_sec", 0.0)
    if state.get("is_playing") and state.get("updated_at"):
        try:
            position += max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(state["updated_at"])).total_seconds())
        except (TypeError, ValueError):
            pass
    duration = (space.get("content") or {}).get("duration_sec")
    return min(position, duration) if isinstance(duration, (int, float)) and duration > 0 else position


async def _prune_space_connections(space_id):
    space = await db.spaces.find_one({"id": space_id})
    if not space:
        return None
    active = _valid_connections(space)
    for key, value in (space.get("presence_connections") or {}).items():
        if key not in active:
            await db.spaces.update_one(
                {"id": space_id, "presence_connections." + key: value},
                {"$unset": {"presence_connections." + key: ""}})
    return await _reconcile_space_lifecycle(space_id)


async def _reconcile_space_lifecycle(space_id):
    # CAS the playback version and the exact connection set to avoid handoff/join races.
    for _ in range(3):
        space = await db.spaces.find_one({"id": space_id})
        if not space:
            return None
        presence = _public_presence(space)
        state = space.get("state") or {}
        host = state.get("host_id") or space.get("creator_id")
        changed_state = None
        updates = {}
        ended_session = not presence and space.get("session_open")
        if presence and host not in presence:
            host = space["creator_id"] if space.get("creator_id") in presence else sorted(presence)[0]
            changed_state = {**state, "position_sec": _position_now(space),
                             "host_id": host, "updated_at": now_iso()}
        elif ended_session:
            changed_state = {**state, "position_sec": _position_now(space), "is_playing": False,
                             "host_id": space.get("creator_id"), "updated_at": now_iso()}
            updates["session_open"] = False
        if not changed_state:
            return space
        updates.update({"state": changed_state, "updated_at": now_iso()})
        query = {**_space_cas(space), "presence_connections": space.get("presence_connections", {})}
        changed = await db.spaces.find_one_and_update(query,
            {"$set": updates, "$inc": {"version": 1}}, return_document=ReturnDocument.AFTER)
        if not changed:
            continue
        if ended_session and space.get("content") and space.get("session_id"):
            entry = {"_id": space_id + ":" + space["session_id"], "id": str(uuid.uuid4()),
                     "type": "session", "session_id": space["session_id"], "space_id": space_id,
                     "space_name": space.get("name") or "Untitled space",
                     "summary": _build_session_summary(space),
                     "content": _safe_space_content(space["content"]), "members": space.get("members", []),
                     "created_at": now_iso()}
            try:
                await db.space_sessions.insert_one(entry)
            except DuplicateKeyError:
                pass
        await hub.broadcast(space_id, {"type": "state", "state": _serialize_space(changed)["state"],
                                       "version": changed["version"], "server_time": now_iso(),
                                       "reason": "session_ended" if ended_session else "host_handoff"})
        return changed
    return await db.spaces.find_one({"id": space_id})


def _connection_id(value, user):
    value = value or ("http-" + digest(user["_session_id"])[:32])
    if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", value):
        raise HTTPException(400, "Invalid room connection")
    return value


async def _touch_space_connection(space_id, user, connection_id, socket_id=None, refresh=False):
    space = await _ensure_member(space_id, user["id"])
    existing = (space.get("presence_connections") or {}).get(connection_id)
    if existing and (existing.get("session_id") != user["_session_id"] or existing.get("user_id") != user["id"]):
        raise HTTPException(409, "This room connection is already in use")
    if refresh and (not existing or existing.get("socket_id") != socket_id):
        raise HTTPException(409, "This room connection has been replaced")
    if not existing and len(space.get("presence_connections") or {}) >= 64:
        await _prune_space_connections(space_id)
        space = await _ensure_member(space_id, user["id"])
        if len(space.get("presence_connections") or {}) >= 64:
            raise HTTPException(429, "Too many room connections. Close another tab and try again.")
    timestamp = datetime.now(timezone.utc)
    connection = {"user_id": user["id"], "session_id": user["_session_id"],
                  "at": timestamp.isoformat(),
                  "expires_at": (timestamp + timedelta(seconds=PRESENCE_SECONDS)).isoformat(),
                  "socket_id": socket_id or (existing or {}).get("socket_id")}
    query = {"id": space_id, "members": user["id"], "$or": [
        {"presence_connections." + connection_id: {"$exists": False}},
        {"presence_connections." + connection_id + ".session_id": user["_session_id"],
         "presence_connections." + connection_id + ".user_id": user["id"]}]}
    if refresh:
        query["presence_connections." + connection_id + ".socket_id"] = socket_id
    changed = await db.spaces.update_one(query,
        {"$set": {"presence_connections." + connection_id: connection, "updated_at": timestamp.isoformat()}})
    if not changed.matched_count:
        raise HTTPException(409, "This room connection has been replaced")
    # A new occupancy begins a new summary session only after the previous one closed.
    await db.spaces.update_one({"id": space_id, "session_open": {"$ne": True}},
        {"$set": {"session_open": True, "session_id": str(uuid.uuid4())}})
    return await _reconcile_space_lifecycle(space_id)


async def _remove_space_connection(space_id, user, connection_id, socket_id=None):
    query = {"id": space_id, "presence_connections." + connection_id + ".session_id": user["_session_id"],
             "presence_connections." + connection_id + ".user_id": user["id"]}
    if socket_id:
        query["presence_connections." + connection_id + ".socket_id"] = socket_id
    await db.spaces.update_one(query, {"$unset": {"presence_connections." + connection_id: ""}})
    return await _reconcile_space_lifecycle(space_id)


async def _presence_event(space_id, user, event, space=None):
    space = space or await db.spaces.find_one({"id": space_id})
    if not space:
        return
    view = _serialize_space(space)
    await hub.broadcast(space_id, {"type": "presence", "event": event,
        "user_id": user["id"], "user_name": user["name"], "at": now_iso(),
        "active_members": view["active_members"], "presence": view["presence"],
        "state": view["state"], "version": view["version"], "server_time": view["server_time"]})


async def _enrich_users(ids: list[str]) -> dict:
    users = await db.users.find({"id": {"$in": list(set(ids))}}, {"_id": 0, "password_hash": 0}).to_list(500)
    return {u["id"]: u for u in users}


# ---------- Models ----------
class SpaceCreateIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    member_ids: List[str] = Field(default_factory=list, max_length=20)


class SpaceContentIn(BaseModel):
    type: Literal["youtube", "audio"]
    url: Optional[str] = Field(default=None, max_length=2048)
    audio_id: Optional[str] = Field(default=None, max_length=100)
    upload_id: Optional[str] = Field(default=None, max_length=100)
    title: Optional[str] = Field(default=None, max_length=160)


class SpaceStateIn(BaseModel):
    is_playing: bool
    position_sec: float = Field(ge=0, le=43200, allow_inf_nan=False)
    expected_version: Optional[int] = Field(default=None, ge=0)


class SpaceConnectionIn(BaseModel):
    connection_id: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,80}$")


class SpaceHostIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)


class SpaceMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    client_message_id: Optional[str] = Field(default=None, min_length=1, max_length=80)


class SpaceReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


# ---------- Routes ----------
@api.get("/audio/library")
async def audio_library(current=Depends(get_current_user)):
    return AUDIO_LIBRARY




@api.post("/spaces")
async def create_space(payload: SpaceCreateIn, current=Depends(get_current_user)):
    if len({current['id'], *payload.member_ids}) > 20:
        raise HTTPException(400, "A Space supports up to 20 invited people")
    for member_id in payload.member_ids:
        if member_id != current["id"]:
            await auth.require_contact(current["id"], member_id)
    await auth.limit("space-create:" + current["id"], 20, 3600)
    members = [current["id"], *sorted(set(payload.member_ids) - {current["id"]})]
    space = {
        "id": str(uuid.uuid4()),
        "name": (payload.name or "").strip() or None,
        "creator_id": current["id"],
        "members": members,
        "presence": {},
        "presence_connections": {},
        "version": 0,
        "session_id": str(uuid.uuid4()),
        "session_open": False,
        "mode": "idle",
        "content": None,
        "state": {
            "is_playing": False,
            "position_sec": 0.0,
            "host_id": current["id"],
            "updated_at": now_iso(),
        },
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.spaces.insert_one(space)
    return _serialize_space(space)


@api.get("/spaces")
async def list_spaces(current=Depends(get_current_user)):
    spaces = await db.spaces.find({"members": current["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    all_user_ids = {uid for s in spaces for uid in s.get("members", [])}
    users_by_id = await _enrich_users(list(all_user_ids))
    out = [_serialize_space(s, users_by_id) for s in spaces]
    active = [s for s in out if s["active_members"]]
    saved = [s for s in out if not s["active_members"]]
    return {"active": active, "saved": saved}


@api.get("/spaces/{space_id}")
async def get_space(space_id: str, current=Depends(get_current_user)):
    s = await db.spaces.find_one({"id": space_id, "members": current["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Space not found")
    s = await _prune_space_connections(space_id)
    users_by_id = await _enrich_users(s.get("members", []))
    return _serialize_space(s, users_by_id)


async def _ensure_member(space_id: str, user_id: str) -> dict:
    s = await db.spaces.find_one({"id": space_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Space not found")
    if user_id not in s.get("members", []):
        raise HTTPException(status_code=404, detail="Space not found")
    return s


@api.post("/spaces/{space_id}/join")
async def join_space(space_id: str, payload: Optional[SpaceConnectionIn] = None, current=Depends(get_current_user)):
    space = await _ensure_member(space_id, current["id"])
    for member_id in space["members"]:
        if member_id != current["id"]:
            await allow_direct(db, current["id"], member_id)
    connection_id = _connection_id(payload.connection_id if payload else None, current)
    await _prune_space_connections(space_id)
    space = await _touch_space_connection(space_id, current, connection_id)
    await _presence_event(space_id, current, "join", space)
    users_by_id = await _enrich_users(space.get("members", []))
    return {**_serialize_space(space, users_by_id), "connection_id": connection_id}


@api.post("/spaces/{space_id}/leave")
async def leave_space(space_id: str, payload: Optional[SpaceConnectionIn] = None, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    connection_id = _connection_id(payload.connection_id if payload else None, current)
    # Closing the transport first prevents an in-flight heartbeat recreating a departed lease.
    for socket in list(hub.rooms.get(space_id, [])):
        identity = socket.scope.get("kuku_user") or {}
        if (socket.scope.get("kuku_connection_id") == connection_id
                and identity.get("_session_id") == current["_session_id"]):
            with suppress(Exception):
                await socket.close(code=1000)
    space = await _remove_space_connection(space_id, current, connection_id)
    await _presence_event(space_id, current, "leave", space)
    return {"ok": True}


@api.post("/spaces/{space_id}/host")
async def transfer_space_host(space_id: str, payload: SpaceHostIn, current=Depends(get_current_user)):
    await _prune_space_connections(space_id)
    space = await _ensure_member(space_id, current["id"])
    host_id = (space.get("state") or {}).get("host_id") or space.get("creator_id")
    if current["id"] not in (host_id, space.get("creator_id")):
        raise HTTPException(403, "Only the host or owner can hand over control")
    if payload.user_id not in _public_presence(space):
        raise HTTPException(409, "Choose someone who is in the Space now")
    for member_id in space["members"]:
        if member_id != current["id"]:
            await allow_direct(db, current["id"], member_id)
    state = {**(space.get("state") or {}), "host_id": payload.user_id,
             "position_sec": _position_now(space), "updated_at": now_iso()}
    changed = await db.spaces.find_one_and_update(
        {**_space_cas(space), "members": current["id"],
         "presence_connections": space.get("presence_connections", {})},
        {"$set": {"state": state, "updated_at": now_iso()}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "The Space changed. Refresh and try again.")
    view = _serialize_space(changed)
    await hub.broadcast(space_id, {"type": "state", "state": view["state"],
        "version": view["version"], "server_time": view["server_time"], "reason": "host_handoff"})
    return view


def _build_session_summary(s: dict) -> dict:
    content = s.get("content") or {}
    title = content.get("title") or content.get("video_id") or "Shared moment"
    return {
        "title": title,
        "mode": s.get("mode", "idle"),
        "ended_at": now_iso(),
    }


async def _space_host(space_id, current):
    await _prune_space_connections(space_id)
    space = await _ensure_member(space_id, current["id"])
    host_id = (space.get("state") or {}).get("host_id") or space.get("creator_id")
    if host_id != current["id"]:
        raise HTTPException(403, "Only the host can control playback")
    for member_id in space["members"]:
        if member_id != current["id"]:
            await allow_direct(db, current["id"], member_id)
    return space


@api.post("/spaces/{space_id}/content")
async def set_space_content(space_id: str, payload: SpaceContentIn, current=Depends(get_current_user)):
    space = await _space_host(space_id, current)
    if payload.type == "youtube":
        video_id = _yt_id(payload.url or "")
        if not video_id:
            raise HTTPException(400, "Choose a valid YouTube video link")
        content = {"type": "youtube", "video_id": video_id,
                   "title": payload.title or "YouTube · " + video_id}
        mode = "video"
    else:
        if payload.upload_id:
            upload = await db.audio_uploads.find_one({"id": payload.upload_id, "uploader_id": current["id"]})
            if not upload:
                raise HTTPException(404, "Audio upload not found")
            content = {"type": "audio", "source": "upload", "upload_id": upload["id"],
                       "title": upload["title"], "artist": upload.get("uploader_name") or "Shared audio",
                       "cover_emoji": upload.get("cover_emoji") or "🎵",
                       "duration_sec": upload.get("duration_sec")}
        else:
            track = next((track for track in AUDIO_LIBRARY if track["id"] == payload.audio_id), None)
            if not track:
                raise HTTPException(400, "Choose an audio track")
            content = {"type": "audio", "source": "library", "audio_id": track["id"],
                       **{key: track[key] for key in ("url", "title", "artist", "cover_emoji", "duration_sec")}}
        mode = "audio"
    state = {"is_playing": True, "position_sec": 0.0,
             "host_id": current["id"], "updated_at": now_iso()}
    changed = await db.spaces.find_one_and_update(
        {**_space_cas(space), "members": current["id"]},
        {"$set": {"content": content, "mode": mode, "state": state, "updated_at": now_iso(),
                  "session_id": space.get("session_id") or str(uuid.uuid4())},
         "$inc": {"version": 1}}, return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "The Space changed. Refresh and try again.")
    view = _serialize_space(changed)
    await hub.broadcast(space_id, {"type": "content", "content": view["content"], "mode": mode,
        "state": view["state"], "version": view["version"], "server_time": view["server_time"],
        "by": current["id"], "by_name": current["name"]})
    return {"ok": True, "content": view["content"], "state": view["state"],
            "version": view["version"], "server_time": view["server_time"]}


@api.post("/spaces/{space_id}/state")
async def set_space_state(space_id: str, payload: SpaceStateIn, current=Depends(get_current_user)):
    space = await _space_host(space_id, current)
    if payload.expected_version is not None and payload.expected_version != space.get("version", 0):
        raise HTTPException(409, "Playback changed. Refresh and try again.")
    if not space.get("content"):
        raise HTTPException(409, "Choose something to play first")
    position = payload.position_sec
    duration = space["content"].get("duration_sec")
    if isinstance(duration, (int, float)) and duration > 0:
        position = min(position, duration)
    state = {"is_playing": payload.is_playing, "position_sec": position,
             "host_id": current["id"], "updated_at": now_iso()}
    changed = await db.spaces.find_one_and_update(
        {**_space_cas(space), "members": current["id"]},
        {"$set": {"state": state, "updated_at": now_iso()}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "Playback changed. Refresh and try again.")
    view = _serialize_space(changed)
    await hub.broadcast(space_id, {"type": "state", "state": view["state"],
        "version": view["version"], "server_time": view["server_time"],
        "by": current["id"], "by_name": current["name"]})
    return view["state"]


@api.get("/spaces/{space_id}/messages")
async def list_space_messages(space_id: str, before: Optional[str] = None, after: Optional[str] = None,
                              limit: int = Query(50, ge=1, le=100), current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    if before and after:
        raise HTTPException(400, "Choose before or after")
    query = {"space_id": space_id}
    cursor = before or after
    if cursor:
        anchor = await db.space_messages.find_one({"space_id": space_id, "id": cursor})
        if not anchor:
            raise HTTPException(400, "Invalid message cursor")
        op = "$lt" if before else "$gt"
        query["$or"] = [{"created_at": {op: anchor["created_at"]}},
                        {"created_at": anchor["created_at"], "id": {op: anchor["id"]}}]
    direction = 1 if after else -1
    messages = await db.space_messages.find(query, {"_id": 0}).sort([
        ("created_at", direction), ("id", direction)]).limit(limit).to_list(limit)
    return messages if after else list(reversed(messages))


@api.post("/spaces/{space_id}/messages")
async def send_space_message(space_id: str, payload: SpaceMessageIn, current=Depends(get_current_user)):
    space = await _ensure_member(space_id, current["id"])
    for member_id in space["members"]:
        if member_id != current["id"]:
            await allow_direct(db, current["id"], member_id)
    await auth.limit("space-message:" + current["id"], 90, 60)
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Write a message first")
    query = {"space_id": space_id, "sender_id": current["id"], "client_message_id": payload.client_message_id}
    if payload.client_message_id:
        previous = await db.space_messages.find_one(query, {"_id": 0})
        if previous:
            if previous["text"] != text:
                raise HTTPException(409, "Message ID already used")
            return previous
    message = {"id": str(uuid.uuid4()), "space_id": space_id,
               "sender_id": current["id"], "sender_name": current["name"],
               "text": text, "created_at": now_iso()}
    if payload.client_message_id:
        message["client_message_id"] = payload.client_message_id
    try:
        await db.space_messages.insert_one(message)
    except DuplicateKeyError:
        previous = await db.space_messages.find_one(query, {"_id": 0})
        if not previous or previous["text"] != text:
            raise HTTPException(409, "Message ID already used")
        return previous
    message.pop("_id", None)
    await hub.broadcast(space_id, {"type": "message", "message": message})
    return message


@api.post("/spaces/{space_id}/reactions")
async def send_reaction(space_id: str, payload: SpaceReactionIn, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    await auth.limit("space-reaction:" + current["id"], 60, 60)
    emoji = payload.emoji[:8]
    await hub.broadcast(space_id, {
        "type": "reaction",
        "emoji": emoji,
        "by": current["id"],
        "by_name": current["name"],
        "at": now_iso(),
    })
    return {"ok": True}


@api.get("/space-sessions")
async def list_sessions(current=Depends(get_current_user)):
    sessions = await db.space_sessions.find({"members": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [{**entry, "content": _safe_space_content(entry.get("content"))} for entry in sessions]


# ---------- WebSocket ----------
@app.websocket("/api/ws/spaces/{space_id}")
async def space_ws(websocket: WebSocket, space_id: str, ticket: str = Query(...),
                   connection_id: Optional[str] = Query(default=None, pattern=r"^[A-Za-z0-9-]{1,80}$")):
    user = await auth.consume_ticket(ticket, "space:" + space_id)
    if not user or not user.get("email_verified"):
        await websocket.close(code=4401)
        return
    try:
        space = await _ensure_member(space_id, user["id"])
        for member_id in space["members"]:
            if member_id != user["id"]:
                await allow_direct(db, user["id"], member_id)
    except HTTPException:
        await websocket.close(code=4404)
        return
    connection_id = _connection_id(connection_id or str(uuid.uuid4()), user)
    socket_id = str(uuid.uuid4())
    await websocket.accept()
    websocket.scope["kuku_user"] = user
    websocket.scope["kuku_connection_id"] = connection_id
    websocket.scope["kuku_socket_id"] = socket_id
    auth.sockets.setdefault(user["_session_id"], set()).add(websocket)
    await hub.join(space_id, websocket)
    try:
        await _prune_space_connections(space_id)
        space = await _touch_space_connection(space_id, user, connection_id, socket_id)
        await _presence_event(space_id, user, "join", space)
        users_by_id = await _enrich_users(space.get("members", []))
        await websocket.send_json({"type": "snapshot", "space": _serialize_space(space, users_by_id)})
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=25)
            except asyncio.TimeoutError:
                active = await auth.session_user(user["_session_id"], user["id"])
                if not active.get("email_verified"):
                    raise HTTPException(403, "Verification required")
                space = await _ensure_member(space_id, user["id"])
                lease = (space.get("presence_connections") or {}).get(connection_id)
                if not lease or lease.get("socket_id") != socket_id or lease.get("expires_at", "") <= now_iso():
                    raise HTTPException(409, "Room connection expired")
                await websocket.send_json({"type": "heartbeat", "server_time": now_iso()})
                continue
            active = await auth.session_user(user["_session_id"], user["id"])
            if not active.get("email_verified"):
                raise HTTPException(403, "Verification required")
            space = await _ensure_member(space_id, user["id"])
            for member_id in space["members"]:
                if member_id != user["id"]:
                    await allow_direct(db, user["id"], member_id)
            await _touch_space_connection(space_id, user, connection_id, socket_id, refresh=True)
            try:
                message = _json.loads(data)
            except (ValueError, TypeError):
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "server_time": now_iso(),
                                           "client_time": message.get("client_time")})
    except (WebSocketDisconnect, HTTPException):
        with suppress(Exception):
            await websocket.close(code=4401)
    finally:
        auth.sockets.get(user["_session_id"], set()).discard(websocket)
        await hub.leave(space_id, websocket)
        space = await _remove_space_connection(space_id, user, connection_id, socket_id)
        await _presence_event(space_id, user, "leave", space)


@app.websocket("/api/ws/calls")
async def call_ws(websocket: WebSocket, ticket: str = Query(...)):
    if not settings.ENABLE_CALLS:
        await websocket.close(code=4403)
        return
    user = await auth.consume_ticket(ticket, "calls")
    if not user or not user.get("email_verified"):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    websocket.scope["kuku_user"] = user
    auth.sockets.setdefault(user["_session_id"], set()).add(websocket)
    await call_hub.register(user["id"], websocket)
    try:
        await expire_calls()
        call = await user_active_call(user["id"])
        if call and call["status"] == "ringing" and call["initiator_id"] != user["id"]:
            caller = await db.users.find_one({"id": call["initiator_id"]})
            await websocket.send_json({"type": "incoming_call", "call": _call_view(call),
                "from": {"id": call["initiator_id"], "name": caller["name"] if caller else "KUKU member"}})
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=25)
            except asyncio.TimeoutError:
                data = "{}"
            active = await auth.session_user(user["_session_id"], user["id"])
            if not active.get("email_verified") or not settings.ENABLE_CALLS:
                raise HTTPException(403, "Calls unavailable")
            try:
                message = _json.loads(data)
            except (ValueError, TypeError):
                continue
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "server_time": now_iso()})
    except (WebSocketDisconnect, HTTPException):
        with suppress(Exception):
            await websocket.close(code=4401)
    finally:
        auth.sockets.get(user["_session_id"], set()).discard(websocket)
        await call_hub.unregister(user["id"], websocket)


@app.get("/health/live")
async def live():
    return {"ok": True}

@app.get("/health/ready")
async def ready():
    try:
        await asyncio.wait_for(db.command("ping"), timeout=3)
    except Exception:
        raise HTTPException(503, "Database unavailable")
    return {"ok": True}

# Mount router & CORS
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Kuku-Platform", "Range"],
    expose_headers=["Accept-Ranges", "Content-Range", "Content-Length"],
)
