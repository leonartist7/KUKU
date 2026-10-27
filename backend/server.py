from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, Query
from pymongo.errors import DuplicateKeyError
from auth_service import AuthService, hash_password, verify_password, profile
import settings
from attachments import attachment_router
from account_recovery import recovery_router
from push_service import device_router, run_worker
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
get_current_user = auth.verified


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.command("ping")
    await auth.indexes()
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
    worker = asyncio.create_task(run_worker(db)) if settings.PUSH_ENABLED else None
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        client.close()


app = FastAPI(title="KUKU API", lifespan=lifespan)
api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(device_router(lambda: db, auth))
api.include_router(recovery_router(lambda: db, auth))
api.include_router(attachment_router(lambda: db, auth))

@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def public_message(message):
    return {k: v for k, v in message.items() if k != "_id" and not k.startswith("push_")} if message else None

def serialize_user(user: dict) -> dict:
    return profile(user)


# ---------- Models ----------
class MessageIn(BaseModel):
    chat_id: str
    type: Literal["text", "voice", "image", "file", "space_invite"]
    text: Optional[str] = Field(default=None, max_length=10000)
    client_message_id: Optional[str] = Field(default=None, max_length=100)
    media: Optional[str] = Field(default=None, max_length=100)
    attachment_id: Optional[str] = Field(default=None, max_length=100)
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    duration_ms: Optional[int] = None  # for voice
    space_id: Optional[str] = None  # for space_invite
    space_name: Optional[str] = None


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
    # Enrich with other user + last message
    out = []
    for c in chats:
        other_id = next((m for m in c["members"] if m != current["id"]), None)
        other = await db.users.find_one({"id": other_id}, {"_id": 0, "password_hash": 0}) if other_id else None
        last_msg = await db.messages.find_one(
            {"chat_id": c["id"]}, sort=[("created_at", -1)], projection={"_id": 0}
        )
        out.append(
            {
                "id": c["id"],
                "type": c.get("type", "dm"),
                "other": serialize_user(other) if other else None,
                "last_message": public_message(last_msg),
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
    return [public_message(m) for m in (msgs if after else list(reversed(msgs)))]


@api.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, payload: MessageIn, current=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "members": current["id"]})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if payload.chat_id != chat_id:
        raise HTTPException(400, "Conversation does not match")
    if payload.type == "text" and not (payload.text or "").strip():
        raise HTTPException(400, "Empty message")
    if payload.type == "voice":
        raise HTTPException(400, "Voice recording is not enabled for this release")
    if payload.media:
        raise HTTPException(400, "Upload files through the attachments endpoint")
    attachment = None
    if payload.type in ("file", "image"):
        attachment = await db.attachments.find_one({"id": payload.attachment_id, "chat_id": chat_id, "owner_id": current["id"]})
        if not attachment:
            raise HTTPException(400, "Upload a file to this conversation first")
    if payload.type == "space_invite":
        space = await db.spaces.find_one({"id": payload.space_id})
        if not space or not set(chat["members"]).issubset(space["members"]):
            raise HTTPException(403, "Space membership is required for all recipients")
    if payload.client_message_id:
        previous = await db.messages.find_one({"chat_id": chat_id, "sender_id": current["id"], "client_message_id": payload.client_message_id}, {"_id": 0})
        if previous:
            if previous.get("text") != payload.text or previous["type"] != payload.type or previous.get("attachment_id") != payload.attachment_id or previous.get("space_id") != payload.space_id:
                raise HTTPException(409, "Message ID already used")
            return public_message(previous)
    # Legacy media limit while old messages remain readable.
    if payload.media and len(payload.media) > 14 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Media is too large (max ~10MB)")
    msg = {
        "id": str(uuid.uuid4()),
        "chat_id": chat_id,
        **({"client_message_id": payload.client_message_id} if payload.client_message_id else {}),
        "sender_id": current["id"],
        "sender_name": current["name"],
        "type": payload.type,
        "text": payload.text,
        "media": payload.media,
        "attachment_id": payload.attachment_id,
        "file_name": attachment["name"] if attachment else None,
        "file_size": attachment["size"] if attachment else None,
        "duration_ms": payload.duration_ms,
        "space_id": payload.space_id,
        "space_name": payload.space_name,
        "created_at": now_iso(),
    }
    if settings.PUSH_ENABLED:
        from auth_service import now
        msg.update({"push_state": "pending", "push_due": now(), "push_attempts": 0})
    try:
        await db.messages.insert_one(msg)
    except DuplicateKeyError:
        previous = await db.messages.find_one({"chat_id": chat_id, "sender_id": current["id"], "client_message_id": payload.client_message_id}, {"_id": 0})
        if not previous or previous.get("text") != payload.text or previous["type"] != payload.type or previous.get("attachment_id") != payload.attachment_id or previous.get("space_id") != payload.space_id:
            raise HTTPException(409, "Message ID already used")
        return public_message(previous)
    await db.chats.update_one({"id": chat_id}, {"$set": {"updated_at": msg["created_at"]}})
    return public_message(msg)


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


# ---------- Calls (signaled via WS) ----------
def _call_view(c: dict, other: Optional[dict] = None) -> dict:
    return {
        "id": c["id"],
        "members": c.get("members", []),
        "initiator_id": c.get("initiator_id"),
        "status": c.get("status"),
        "duration_sec": c.get("duration_sec", 0),
        "started_at": c.get("started_at"),
        "ended_at": c.get("ended_at"),
        "created_at": c.get("created_at"),
        "other": serialize_user(other) if other else None,
    }


async def user_active_call(user_id: str) -> Optional[dict]:
    return await db.calls.find_one(
        {"members": user_id, "status": {"$in": ["ringing", "active"]}}, {"_id": 0}
    )


@api.get("/calls")
async def list_calls(current=Depends(get_current_user)):
    calls = await db.calls.find({"members": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for c in calls:
        other_id = next((m for m in c["members"] if m != current["id"]), None)
        other = await db.users.find_one({"id": other_id}, {"_id": 0, "password_hash": 0}) if other_id else None
        out.append(_call_view(c, other))
    return out


@api.post("/calls")
async def create_call(payload: CallCreateIn, current=Depends(get_current_user)):
    if not settings.ENABLE_CALLS:
        raise HTTPException(503, "Calls are not enabled for this release")
    await auth.require_contact(current["id"], payload.other_user_id)
    if payload.other_user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot call yourself")
    other = await db.users.find_one({"id": payload.other_user_id}, {"_id": 0})
    if not other:
        raise HTTPException(status_code=404, detail="User not found")
    if await user_active_call(current["id"]):
        raise HTTPException(status_code=409, detail="You're already in a call")
    if await user_active_call(payload.other_user_id):
        raise HTTPException(status_code=409, detail="User is busy")
    call = {
        "id": str(uuid.uuid4()),
        "members": [current["id"], payload.other_user_id],
        "initiator_id": current["id"],
        "status": "ringing",
        "duration_sec": 0,
        "started_at": None,
        "ended_at": None,
        "created_at": now_iso(),
    }
    await db.calls.insert_one(call)
    await call_hub.send_to(payload.other_user_id, {
        "type": "incoming_call",
        "call": {**call},
        "from": {"id": current["id"], "name": current["name"]},
    })
    return _call_view(call, other)


@api.post("/calls/{call_id}/accept")
async def accept_call(call_id: str, current=Depends(get_current_user)):
    call = await db.calls.find_one({"id": call_id, "members": current["id"]}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call.get("initiator_id") == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot accept your own call")
    if call.get("status") != "ringing":
        raise HTTPException(status_code=409, detail="Call is not ringing")
    started = now_iso()
    await db.calls.update_one(
        {"id": call_id}, {"$set": {"status": "active", "started_at": started, "updated_at": started}}
    )
    call["status"] = "active"
    call["started_at"] = started
    await call_hub.send_to(call["initiator_id"], {
        "type": "call_accepted", "call_id": call_id, "status": "active",
    })
    return _call_view(call)


@api.post("/calls/{call_id}/decline")
async def decline_call(call_id: str, current=Depends(get_current_user)):
    call = await db.calls.find_one({"id": call_id, "members": current["id"]}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call.get("initiator_id") == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot decline your own call")
    ended = now_iso()
    await db.calls.update_one(
        {"id": call_id}, {"$set": {"status": "missed", "ended_at": ended, "duration_sec": 0, "updated_at": ended}}
    )
    call["status"] = "missed"
    call["ended_at"] = ended
    await call_hub.send_to(call["initiator_id"], {"type": "call_declined", "call_id": call_id})
    return _call_view(call)


@api.post("/calls/{call_id}/cancel")
async def cancel_call(call_id: str, current=Depends(get_current_user)):
    call = await db.calls.find_one({"id": call_id, "members": current["id"]}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call.get("initiator_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Only the caller can cancel")
    ended = now_iso()
    await db.calls.update_one(
        {"id": call_id}, {"$set": {"status": "missed", "ended_at": ended, "duration_sec": 0, "updated_at": ended}}
    )
    call["status"] = "missed"
    call["ended_at"] = ended
    await call_hub.send_to(call["members"][-1], {"type": "call_missed", "call_id": call_id})
    return _call_view(call)


@api.post("/calls/{call_id}/end")
async def end_call(call_id: str, current=Depends(get_current_user)):
    call = await db.calls.find_one({"id": call_id, "members": current["id"]}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call.get("status") != "active":
        raise HTTPException(status_code=409, detail="Call is not active")
    ended = now_iso()
    duration = 0
    if call.get("started_at"):
        try:
            started = datetime.fromisoformat(call["started_at"])
            duration = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
        except Exception:
            duration = 0
    await db.calls.update_one(
        {"id": call_id}, {"$set": {"status": "completed", "ended_at": ended, "duration_sec": duration, "updated_at": ended}}
    )
    call["status"] = "completed"
    call["ended_at"] = ended
    call["duration_sec"] = duration
    await call_hub.send_to(call["members"][-1], {"type": "call_ended", "call_id": call_id})
    return _call_view(call)


class CallTokenOut(BaseModel):
    url: str
    room: str
    token: str


@api.post("/calls/{call_id}/token")
async def call_token(call_id: str, current=Depends(get_current_user)):
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(status_code=503, detail="LiveKit is not configured")
    call = await db.calls.find_one({"id": call_id, "members": current["id"]}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call.get("status") not in ("ringing", "active"):
        raise HTTPException(status_code=409, detail="Call is not active")
    room = f"call-{call_id}"
    token = (
        lkapi.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(current["id"])
        .with_name(current["name"])
        .with_grants(lkapi.VideoGrants(room_join=True, room=room))
        .to_jwt()
    )
    return CallTokenOut(url=LIVEKIT_URL, room=room, token=token)


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

# Curated audio library (royalty-free). Streamed direct from public CDN.
AUDIO_LIBRARY = [
    {
        "id": "rain-jazz",
        "title": "Rain & Jazz",
        "artist": "Ambient Loops",
        "duration_sec": 188,
        "cover_emoji": "🌧",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
        "id": "long-walk",
        "title": "Long Walk",
        "artist": "Ambient Loops",
        "duration_sec": 245,
        "cover_emoji": "🌿",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
    {
        "id": "warm-light",
        "title": "Warm Light",
        "artist": "Ambient Loops",
        "duration_sec": 213,
        "cover_emoji": "🕯",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    },
    {
        "id": "old-letters",
        "title": "Old Letters",
        "artist": "Ambient Loops",
        "duration_sec": 198,
        "cover_emoji": "✉️",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    },
]


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
                    await auth.session_user(identity["_session_id"], identity["id"])
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
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        if dead:
            async with self.lock:
                for ws in dead:
                    self.clients.get(user_id, set()).discard(ws)


call_hub = CallHub()


def _serialize_space(s: dict, users_by_id: dict | None = None) -> dict:
    members = [users_by_id.get(m) if users_by_id else None for m in s.get("members", [])] if users_by_id else None
    return {
        "id": s["id"],
        "name": s.get("name") or "Untitled space",
        "creator_id": s.get("creator_id"),
        "members": s.get("members", []),
        "member_users": [serialize_user(u) for u in members if u] if members else [],
        "presence": s.get("presence", {}),
        "active_members": list(s.get("presence", {}).keys()),
        "mode": s.get("mode", "idle"),
        "content": s.get("content"),
        "state": s.get("state") or {
            "is_playing": False,
            "position_sec": 0.0,
            "host_id": s.get("creator_id"),
            "updated_at": s.get("created_at"),
        },
        "created_at": s.get("created_at"),
        "updated_at": s.get("updated_at"),
    }


async def _enrich_users(ids: list[str]) -> dict:
    users = await db.users.find({"id": {"$in": list(set(ids))}}, {"_id": 0, "password_hash": 0}).to_list(500)
    return {u["id"]: u for u in users}


# ---------- Models ----------
class SpaceCreateIn(BaseModel):
    name: Optional[str] = None
    member_ids: List[str] = Field(default_factory=list)


class SpaceContentIn(BaseModel):
    type: Literal["youtube", "audio"]
    url: Optional[str] = None
    audio_id: Optional[str] = None
    upload_id: Optional[str] = None  # user-uploaded audio
    title: Optional[str] = None


class AudioUploadIn(BaseModel):
    title: str
    data_url: str  # base64 data URL
    duration_sec: Optional[float] = None


class SpaceStateIn(BaseModel):
    is_playing: bool
    position_sec: float


class SpaceMessageIn(BaseModel):
    text: str


class SpaceReactionIn(BaseModel):
    emoji: str


# ---------- Routes ----------
@api.get("/audio/library")
async def audio_library(current=Depends(get_current_user)):
    return AUDIO_LIBRARY


@api.get("/audio/uploads")
async def list_audio_uploads(current=Depends(get_current_user)):
    """User's uploaded audio files (metadata only, no base64 payload)."""
    uploads = await db.audio_uploads.find(
        {"uploader_id": current["id"]},
        {"_id": 0, "data_url": 0},
    ).sort("created_at", -1).to_list(200)
    return uploads


@api.get("/audio/uploads/{upload_id}")
async def get_audio_upload(upload_id: str, current=Depends(get_current_user)):
    """Fetch full audio upload (with base64) — used for playback."""
    u = await db.audio_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Upload not found")
    # only the uploader or members of a space currently using it may fetch
    if u["uploader_id"] != current["id"]:
        in_space = await db.spaces.find_one(
            {"members": current["id"], "content.upload_id": upload_id}, {"_id": 0}
        )
        if not in_space:
            raise HTTPException(status_code=403, detail="Not allowed to access this upload")
    return u


@api.post("/audio/uploads")
async def upload_audio(payload: AudioUploadIn, current=Depends(get_current_user)):
    if not payload.data_url.startswith("data:"):
        raise HTTPException(status_code=400, detail="Must be a data URL")
    # rough size guard: reject > 14MB base64 (~10MB binary) to stay under Mongo doc limit
    if len(payload.data_url) > 14 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio is too large (max ~10MB)")
    doc = {
        "id": str(uuid.uuid4()),
        "uploader_id": current["id"],
        "uploader_name": current["name"],
        "title": payload.title.strip() or "Untitled audio",
        "data_url": payload.data_url,
        "duration_sec": payload.duration_sec,
        "cover_emoji": "🎙",
        "created_at": now_iso(),
    }
    await db.audio_uploads.insert_one(doc)
    return {"id": doc["id"], "title": doc["title"], "duration_sec": doc["duration_sec"]}


@api.post("/spaces")
async def create_space(payload: SpaceCreateIn, current=Depends(get_current_user)):
    if len(payload.member_ids) > 20:
        raise HTTPException(400, "A Space supports up to 20 invited people")
    for member_id in payload.member_ids:
        if member_id != current["id"]:
            await auth.require_contact(current["id"], member_id)
    members = list({current["id"], *payload.member_ids})
    space = {
        "id": str(uuid.uuid4()),
        "name": (payload.name or "").strip() or None,
        "creator_id": current["id"],
        "members": members,
        "presence": {},
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
async def join_space(space_id: str, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    await db.spaces.update_one(
        {"id": space_id}, {"$set": {f"presence.{current['id']}": now_iso(), "updated_at": now_iso()}}
    )
    await hub.broadcast(space_id, {
        "type": "presence",
        "event": "join",
        "user_id": current["id"],
        "user_name": current["name"],
        "at": now_iso(),
    })
    s = await db.spaces.find_one({"id": space_id}, {"_id": 0})
    users_by_id = await _enrich_users(s.get("members", []))
    return _serialize_space(s, users_by_id)


@api.post("/spaces/{space_id}/leave")
async def leave_space(space_id: str, current=Depends(get_current_user)):
    s = await _ensure_member(space_id, current["id"])
    await db.spaces.update_one(
        {"id": space_id},
        {"$unset": {f"presence.{current['id']}": ""}, "$set": {"updated_at": now_iso()}},
    )
    await hub.broadcast(space_id, {
        "type": "presence",
        "event": "leave",
        "user_id": current["id"],
        "user_name": current["name"],
        "at": now_iso(),
    })
    # Save a session memory entry once everyone leaves
    s = await db.spaces.find_one({"id": space_id}, {"_id": 0})
    presence = s.get("presence", {})
    if not presence:
        # Generate session summary if there was content
        content = s.get("content")
        if content:
            session = {
                "id": str(uuid.uuid4()),
                "type": "session",
                "space_id": space_id,
                "space_name": s.get("name") or "Untitled space",
                "summary": _build_session_summary(s),
                "content": content,
                "members": s.get("members", []),
                "created_at": now_iso(),
            }
            await db.space_sessions.insert_one(session)
    return {"ok": True}


def _build_session_summary(s: dict) -> dict:
    content = s.get("content") or {}
    title = content.get("title") or content.get("video_id") or "Shared moment"
    return {
        "title": title,
        "mode": s.get("mode", "idle"),
        "ended_at": now_iso(),
    }


@api.post("/spaces/{space_id}/content")
async def set_space_content(space_id: str, payload: SpaceContentIn, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    if payload.type == "youtube":
        vid = _yt_id(payload.url or "")
        if not vid:
            raise HTTPException(status_code=400, detail="Could not parse YouTube URL")
        content = {
            "type": "youtube",
            "url": payload.url,
            "video_id": vid,
            "title": payload.title or f"YouTube · {vid}",
        }
        mode = "video"
    else:  # audio
        # Uploaded audio takes precedence if provided
        if payload.upload_id:
            up = await db.audio_uploads.find_one({"id": payload.upload_id}, {"_id": 0})
            if not up or up["uploader_id"] != current["id"]:
                raise HTTPException(status_code=404, detail="Audio upload not found")
            content = {
                "type": "audio",
                "source": "upload",
                "upload_id": up["id"],
                "url": up["data_url"],
                "title": up["title"],
                "artist": up.get("uploader_name") or "You",
                "cover_emoji": up.get("cover_emoji", "🎙"),
                "duration_sec": up.get("duration_sec"),
            }
        else:
            track = next((a for a in AUDIO_LIBRARY if a["id"] == payload.audio_id), None)
            if not track:
                raise HTTPException(status_code=400, detail="Audio track not found")
            content = {
                "type": "audio",
                "source": "library",
                "audio_id": track["id"],
                "url": track["url"],
                "title": track["title"],
                "artist": track["artist"],
                "cover_emoji": track["cover_emoji"],
                "duration_sec": track["duration_sec"],
            }
        mode = "audio"
    state = {
        "is_playing": True,
        "position_sec": 0.0,
        "host_id": current["id"],
        "updated_at": now_iso(),
    }
    await db.spaces.update_one(
        {"id": space_id},
        {"$set": {"content": content, "mode": mode, "state": state, "updated_at": now_iso()}},
    )
    await hub.broadcast(space_id, {
        "type": "content",
        "content": content,
        "mode": mode,
        "state": state,
        "by": current["id"],
        "by_name": current["name"],
    })
    return {"ok": True, "content": content, "state": state}


@api.post("/spaces/{space_id}/state")
async def set_space_state(space_id: str, payload: SpaceStateIn, current=Depends(get_current_user)):
    s = await _ensure_member(space_id, current["id"])
    # only the current host (or creator) may control playback
    host_id = (s.get("state") or {}).get("host_id") or s.get("creator_id")
    if host_id and host_id != current["id"]:
        raise HTTPException(status_code=403, detail="Only the host can control playback")
    state = {
        "is_playing": payload.is_playing,
        "position_sec": max(0.0, float(payload.position_sec)),
        "host_id": current["id"],
        "updated_at": now_iso(),
    }
    await db.spaces.update_one(
        {"id": space_id}, {"$set": {"state": state, "updated_at": now_iso()}}
    )
    await hub.broadcast(space_id, {
        "type": "state",
        "state": state,
        "by": current["id"],
        "by_name": current["name"],
    })
    return state


@api.get("/spaces/{space_id}/messages")
async def list_space_messages(space_id: str, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    msgs = await db.space_messages.find({"space_id": space_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return msgs


@api.post("/spaces/{space_id}/messages")
async def send_space_message(space_id: str, payload: SpaceMessageIn, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    msg = {
        "id": str(uuid.uuid4()),
        "space_id": space_id,
        "sender_id": current["id"],
        "sender_name": current["name"],
        "text": text,
        "created_at": now_iso(),
    }
    await db.space_messages.insert_one(msg)
    msg.pop("_id", None)
    await hub.broadcast(space_id, {"type": "message", "message": msg})
    return msg


@api.post("/spaces/{space_id}/reactions")
async def send_reaction(space_id: str, payload: SpaceReactionIn, current=Depends(get_current_user)):
    await _ensure_member(space_id, current["id"])
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
    return sessions


# ---------- WebSocket ----------
@app.websocket("/api/ws/spaces/{space_id}")
async def space_ws(websocket: WebSocket, space_id: str, ticket: str = Query(...)):
    user = await auth.consume_ticket(ticket, "space:" + space_id)
    if not user:
        await websocket.close(code=4401)
        return
    user_id = user["id"]
    space = await db.spaces.find_one({"id": space_id, "members": user_id})
    if not space:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    websocket.scope["kuku_user"] = user
    auth.sockets.setdefault(user["_session_id"], set()).add(websocket)
    await hub.join(space_id, websocket)

    # mark presence
    await db.spaces.update_one(
        {"id": space_id},
        {"$set": {f"presence.{user_id}": now_iso(), "updated_at": now_iso()}},
    )
    await hub.broadcast(space_id, {
        "type": "presence",
        "event": "join",
        "user_id": user_id,
        "user_name": user["name"],
        "at": now_iso(),
    })

    # send current state snapshot
    refreshed = await db.spaces.find_one({"id": space_id}, {"_id": 0})
    users_by_id = await _enrich_users(refreshed.get("members", []))
    await websocket.send_json({"type": "snapshot", "space": _serialize_space(refreshed, users_by_id)})

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await auth.session_user(user["_session_id"], user["id"])
                continue
            await auth.session_user(user["_session_id"], user["id"])
            try:
                msg = _json.loads(data)
            except Exception:
                continue
            t = msg.get("type")
            if t == "ping":
                await websocket.send_json({"type": "pong"})
            # All other state changes go through HTTP POST endpoints which
            # then broadcast via hub. Keep WS read loop alive only.
    except (WebSocketDisconnect, HTTPException):
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
    finally:
        auth.sockets.get(user["_session_id"], set()).discard(websocket)
        await hub.leave(space_id, websocket)
        await db.spaces.update_one(
            {"id": space_id},
            {"$unset": {f"presence.{user_id}": ""}, "$set": {"updated_at": now_iso()}},
        )
        await hub.broadcast(space_id, {
            "type": "presence",
            "event": "leave",
            "user_id": user_id,
            "user_name": user["name"],
            "at": now_iso(),
        })


@app.websocket("/api/ws/calls")
async def call_ws(websocket: WebSocket, ticket: str = Query(...)):
    user = await auth.consume_ticket(ticket, "calls")
    if not user:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    auth.sockets.setdefault(user["_session_id"], set()).add(websocket)
    user_id = user["id"]
    await call_hub.register(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = _json.loads(data)
            except Exception:
                continue
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        auth.sockets.get(user["_session_id"], set()).discard(websocket)
        await call_hub.unregister(user_id, websocket)


@app.get("/health/live")
async def live():
    return {"ok": True}

@app.get("/health/ready")
async def ready():
    try:
        await db.command("ping")
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
    allow_headers=["Authorization", "Content-Type", "X-Kuku-Platform"],
)
