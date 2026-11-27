"""Membership-scoped chat tools and recoverable shared pins. No message bodies in events."""
import asyncio
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from pymongo.errors import ExecutionTimeout

import settings
from auth_service import now
from safety import allow_direct

logger = logging.getLogger("kuku.chat_actions")
REACTION_EMOJI = ("❤️", "😂", "🥰", "👍", "😮", "😢")
MAX_REACTIONS = 20
MAX_PINS = 20
# Normal changes queue40 IDs; privacy removal may add the20 existing pins.
MAX_PIN_PENDING = 60
MAX_REVISION = 2_147_483_647
SEND_FIELDS = ("chat_id", "type", "text", "attachment_id", "space_id",
               "space_name", "emote_id", "reply_to_id", "duration_ms")


def request_fingerprint(value):
    data = value.model_dump() if hasattr(value, "model_dump") else value
    canonical = json.dumps({key: data.get(key) for key in SEND_FIELDS},
                           sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    # Keep no second plaintext copy of a message after an edit/removal.
    return hmac.new(settings.JWT_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def same_send(message, payload):
    original = message.get("_request_fingerprint") or request_fingerprint(message)
    return hmac.compare_digest(original, request_fingerprint(payload))


def revision(message):
    return message.get("revision", 0)


def revision_filter(message):
    return {"id": message["id"], "chat_id": message["chat_id"],
            "revision": message.get("revision", {"$exists": False})}


def public_message(message, chat=None):
    if not message:
        return None
    if message.get("deleted_at"):
        view = {key: message.get(key) for key in (
            "id", "chat_id", "sender_id", "sender_name", "created_at", "client_message_id", "deleted_at")}
        view.update({"type": "text", "text": None, "emote_id": None,
                     "revision": revision(message), "reactions": [], "pinned": False})
        return view
    view = {key: value for key, value in message.items()
            if not key.startswith(("_", "push_", "sync_"))}
    view["revision"] = revision(message)
    grouped = {}
    for uid, emoji in (message.get("_reactions") or {}).items():
        if chat is not None and uid not in chat.get("members", []):
            continue
        if emoji in REACTION_EMOJI and sum(map(len, grouped.values())) < MAX_REACTIONS:
            grouped.setdefault(emoji, []).append(uid)
    view["reactions"] = [{"emoji": emoji, "user_ids": sorted(grouped[emoji])}
                         for emoji in REACTION_EMOJI if emoji in grouped]
    pinned = message["id"] in chat.get("pinned_message_ids", []) if chat is not None else bool(message.get("_pinned"))
    view["pinned"] = pinned
    if pinned:
        details = (chat.get("_pin_details") or {}).get(message["id"], {}) if chat else {}
        view["pinned_at"] = details.get("at") or message.get("pinned_at")
        view["pinned_by"] = details.get("by") or message.get("pinned_by")
    else:
        view.pop("pinned_at", None)
        view.pop("pinned_by", None)
    return view


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EditIn(StrictBody):
    text: str = Field(min_length=1, max_length=10000)
    expected_revision: int = Field(ge=0, le=MAX_REVISION, strict=True)


class RemoveIn(StrictBody):
    expected_revision: int = Field(ge=0, le=MAX_REVISION, strict=True)


class ReactionIn(StrictBody):
    emoji: Optional[str] = Field(default=None, max_length=8)
    expected_revision: Optional[int] = Field(default=None, ge=0, le=MAX_REVISION, strict=True)


class PinIn(StrictBody):
    pinned: bool = Field(strict=True)


MessageId = Annotated[str, Field(min_length=1, max_length=100)]


class ResolveIn(StrictBody):
    message_ids: list[MessageId] = Field(max_length=100)


class ChatActions:
    def __init__(self, get_db, auth, events):
        self.get_db, self.auth, self.events = get_db, auth, events
        self.router = APIRouter()
        events.repair_hooks.append(self.repair_pins)
        for path, endpoint, method in (
            ("/chats/{chat_id}/messages/resolve", self.resolve, "POST"),
            ("/chats/{chat_id}/messages/{message_id}", self.get, "GET"),
            ("/chats/{chat_id}/search", self.search, "GET"),
            ("/chats/{chat_id}/pins", self.pins, "GET"),
            ("/chats/{chat_id}/messages/{message_id}/edit", self.edit, "POST"),
            ("/chats/{chat_id}/messages/{message_id}/remove", self.remove, "POST"),
            ("/chats/{chat_id}/messages/{message_id}/reaction", self.react, "POST"),
            ("/chats/{chat_id}/messages/{message_id}/pin", self.pin, "POST"),
        ):
            self.router.add_api_route(path, endpoint, methods=[method])

    async def indexes(self):
        await self.get_db().chats.create_index("id", unique=True)
        await self.get_db().chats.create_index("_pin_sync_pending", sparse=True)

    async def _chat(self, chat_id, user, contact=False):
        chat = await self.get_db().chats.find_one({"id": chat_id, "members": user["id"]})
        if not chat:
            raise HTTPException(404, "Conversation not found")
        if contact:
            for uid in chat["members"]:
                if uid != user["id"]:
                    await allow_direct(self.get_db(), user["id"], uid)
        return chat

    async def _message(self, chat_id, message_id, user, contact=False):
        chat = await self._chat(chat_id, user, contact)
        message = await self.get_db().messages.find_one({"chat_id": chat_id, "id": message_id})
        if not message:
            raise HTTPException(404, "Message not found")
        return chat, message

    async def _active(self, user):
        active = await self.auth.session_user(user["_session_id"], user["id"])
        if not active.get("email_verified"):
            raise HTTPException(403, "Verify your email")
        return active

    def _expected(self, message, expected):
        if expected is not None and expected != revision(message):
            raise HTTPException(409, "This message changed. Refresh it and try again.")

    async def _publish(self, chat, message):
        try:
            await self.events.publish_message(chat, message)
        except Exception:
            logger.warning("A stored message update is waiting for realtime synchronization")

    async def _current(self, chat_id, message_id, user):
        await self._active(user)
        chat, message = await self._message(chat_id, message_id, user)
        return public_message(message, chat)

    async def get(self, chat_id: str, message_id: str, request: Request):
        user = await self.auth.verified(request)
        return await self._current(chat_id, message_id, user)

    async def resolve(self, chat_id: str, payload: ResolveIn, request: Request):
        user = await self.auth.verified(request)
        chat = await self._chat(chat_id, user)
        await self.auth.limit("message-resolve:" + user["id"], 120, 60)
        ids = list(dict.fromkeys(payload.message_ids))
        rows = await self.get_db().messages.find({"chat_id": chat_id, "id": {"$in": ids}}).limit(100).to_list(100)
        await self._active(user)
        chat = await self._chat(chat_id, user)
        return [public_message(message, chat) for message in rows]

    async def search(self, chat_id: str, request: Request, q: str = Query(min_length=2, max_length=80),
                     before: Optional[str] = Query(default=None, max_length=100),
                     limit: int = Query(default=20, ge=1, le=50)):
        user = await self.auth.verified(request)
        await self._chat(chat_id, user)
        await self.auth.limit("message-search:" + user["id"], 60, 60)
        q = q.strip()
        if len(q) < 2:
            raise HTTPException(400, "Search with at least two characters")
        literal = {"$regex": re.escape(q), "$options": "i"}
        query = {"chat_id": chat_id, "deleted_at": {"$exists": False},
                 "$or": [{"text": literal}, {"file_name": literal}]}
        if before:
            anchor = await self.get_db().messages.find_one({"chat_id": chat_id, "id": before})
            if not anchor:
                raise HTTPException(400, "Invalid search cursor")
            query["$and"] = [{"$or": [
                {"created_at": {"$lt": anchor["created_at"]}},
                {"created_at": anchor["created_at"], "id": {"$lt": anchor["id"]}}]}]
        try:
            rows = await asyncio.wait_for(self.get_db().messages.find(query, max_time_ms=1500).sort(
                [("created_at", -1), ("id", -1)]).limit(limit).to_list(limit), timeout=3)
        except (ExecutionTimeout, TimeoutError):
            raise HTTPException(503, "Search took too long. Try a more specific phrase.") from None
        await self._active(user)
        chat = await self._chat(chat_id, user)
        return [public_message(message, chat) for message in rows]

    async def pins(self, chat_id: str, request: Request):
        user = await self.auth.verified(request)
        chat = await self._chat(chat_id, user)
        ids = chat.get("pinned_message_ids", [])[:MAX_PINS]
        rows = await self.get_db().messages.find({
            "id": {"$in": ids}, "chat_id": chat_id, "deleted_at": {"$exists": False}}).limit(MAX_PINS).to_list(MAX_PINS)
        by_id = {message["id"]: message for message in rows}
        await self._active(user)
        chat = await self._chat(chat_id, user)
        return [public_message(by_id[mid], chat) for mid in reversed(ids)
                if mid in by_id and mid in chat.get("pinned_message_ids", [])]

    async def edit(self, chat_id: str, message_id: str, payload: EditIn, request: Request):
        user = await self.auth.verified(request)
        chat, message = await self._message(chat_id, message_id, user, contact=True)
        if message["sender_id"] != user["id"]:
            raise HTTPException(403, "You can edit only your own messages")
        if message.get("deleted_at") or message["type"] != "text":
            raise HTTPException(409, "Only an existing text message can be edited")
        self._expected(message, payload.expected_revision)
        try:
            created = message["created_at"]
            created = datetime.fromisoformat(created) if isinstance(created, str) else created
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if not now() - timedelta(minutes=15) <= created <= now() + timedelta(minutes=1):
                raise ValueError()
        except (KeyError, ValueError, TypeError, AttributeError):
            raise HTTPException(409, "Text messages can be edited for 15 minutes after sending") from None
        if not payload.text.strip():
            raise HTTPException(400, "Write a message first")
        if payload.text == message.get("text"):
            return await self._current(chat_id, message_id, user)
        await self.auth.limit("message-edit:" + user["id"], 30, 60)
        await self._active(user)
        await self._chat(chat_id, user, contact=True)
        changed = await self.get_db().messages.find_one_and_update(
            {**revision_filter(message), "sender_id": user["id"], "deleted_at": {"$exists": False}},
            {"$set": {"text": payload.text, "edited_at": now().isoformat(), "sync_pending": True,
                      "_request_fingerprint": message.get("_request_fingerprint") or request_fingerprint(message)},
             "$inc": {"revision": 1}}, return_document=ReturnDocument.AFTER)
        if not changed:
            raise HTTPException(409, "This message changed. Refresh it and try again.")
        await self._publish(chat, changed)
        return await self._current(chat_id, message_id, user)

    async def remove(self, chat_id: str, message_id: str, payload: RemoveIn, request: Request):
        user = await self.auth.verified(request)
        chat, message = await self._message(chat_id, message_id, user)
        if message["sender_id"] != user["id"]:
            raise HTTPException(403, "You can remove only your own messages")
        if message.get("deleted_at"):
            return await self._current(chat_id, message_id, user)
        if message["type"] not in ("text", "emote"):
            raise HTTPException(409, "Use file controls to manage shared attachments")
        self._expected(message, payload.expected_revision)
        await self.auth.limit("message-remove:" + user["id"], 60, 60)
        await self._active(user)
        await self._chat(chat_id, user)
        changed = await self.get_db().messages.find_one_and_update(
            {**revision_filter(message), "sender_id": user["id"], "deleted_at": {"$exists": False}},
            {"$set": {"deleted_at": now().isoformat(), "sync_pending": True, "push_state": "cancelled",
                      "_privacy_removal_revision": revision(message) + 1,
                      "_request_fingerprint": message.get("_request_fingerprint") or request_fingerprint(message)},
             "$unset": {"text": "", "emote_id": "", "reply_to_id": "", "_reactions": "",
                        "pinned_at": "", "pinned_by": "", "_pinned": ""},
             "$inc": {"revision": 1}}, return_document=ReturnDocument.AFTER)
        if not changed:
            raise HTTPException(409, "This message changed. Refresh it and try again.")
        await self._queue_unpin_deleted(chat_id, message_id)
        await self._publish(chat, changed)
        return await self._current(chat_id, message_id, user)

    async def react(self, chat_id: str, message_id: str, payload: ReactionIn, request: Request):
        user = await self.auth.verified(request)
        if payload.emoji is not None and payload.emoji not in REACTION_EMOJI:
            raise HTTPException(400, "Choose a reaction from the KUKU collection")
        await self.auth.limit("message-reaction:" + user["id"], 60, 60)
        for _ in range(4):
            chat, message = await self._message(chat_id, message_id, user, contact=payload.emoji is not None)
            self._expected(message, payload.expected_revision)
            if message.get("deleted_at"):
                if payload.emoji is None:
                    return public_message(message, chat)
                raise HTTPException(409, "This message was removed")
            reactions = {uid: emoji for uid, emoji in (message.get("_reactions") or {}).items()
                         if uid in chat["members"] and emoji in REACTION_EMOJI}
            if reactions.get(user["id"]) == payload.emoji:
                return public_message(message, chat)
            if payload.emoji is not None and user["id"] not in reactions and len(reactions) >= MAX_REACTIONS:
                raise HTTPException(409, "This message has reached its reaction limit")
            await self._active(user)
            await self._chat(chat_id, user, contact=payload.emoji is not None)
            update = {"$inc": {"revision": 1}, "$set": {"sync_pending": True}}
            if payload.emoji is None:
                reactions.pop(user["id"], None)
                update["$set"]["_privacy_removal_revision"] = revision(message) + 1
            else:
                reactions[user["id"]] = payload.emoji
            update["$set"]["_reactions"] = reactions
            changed = await self.get_db().messages.find_one_and_update(
                {**revision_filter(message), "deleted_at": {"$exists": False}}, update,
                return_document=ReturnDocument.AFTER)
            if changed:
                await self._publish(chat, changed)
                return await self._current(chat_id, message_id, user)
            if payload.expected_revision is not None:
                break
        raise HTTPException(409, "This message changed. Refresh it and try again.")

    async def _queue_unpin_deleted(self, chat_id, message_id):
        await self.get_db().chats.update_one({"id": chat_id, "pinned_message_ids": message_id},
            {"$pull": {"pinned_message_ids": message_id},
             "$unset": {"_pin_details." + message_id: ""},
             "$addToSet": {"_pin_pending": message_id},
             "$set": {"_pin_sync_pending": True}, "$inc": {"_pin_revision": 1}})

    async def _prune_deleted_pins(self, chat):
        ids = chat.get("pinned_message_ids", [])[:MAX_PINS]
        if not ids:
            return
        rows = await self.get_db().messages.find({
            "chat_id": chat["id"], "id": {"$in": ids}, "deleted_at": {"$exists": False}},
            {"id": 1}).limit(MAX_PINS).to_list(MAX_PINS)
        valid = {row["id"] for row in rows}
        for mid in ids:
            if mid not in valid:
                await self._queue_unpin_deleted(chat["id"], mid)

    async def pin(self, chat_id: str, message_id: str, payload: PinIn, request: Request):
        user = await self.auth.verified(request)
        chat, message = await self._message(chat_id, message_id, user, contact=payload.pinned)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", message_id):
            raise HTTPException(400, "This older message cannot be pinned")
        if payload.pinned and message.get("deleted_at"):
            raise HTTPException(409, "Removed messages cannot be pinned")
        await self.auth.limit("message-pin:" + user["id"], 60, 60)
        await self._prune_deleted_pins(chat)
        chat = await self._chat(chat_id, user, contact=payload.pinned)
        if (message_id in chat.get("pinned_message_ids", [])) != payload.pinned:
            query = {"id": chat_id, "members": user["id"], "$and": [{"$or": [
                {"_pin_pending": message_id}, {"_pin_pending.39": {"$exists": False}}]}]}
            update = {"$addToSet": {"_pin_pending": message_id}, "$set": {"_pin_sync_pending": True},
                      "$inc": {"_pin_revision": 1}}
            if payload.pinned:
                query["pinned_message_ids"] = {"$ne": message_id}
                query["$and"].append({"pinned_message_ids.19": {"$exists": False}})
                update["$addToSet"]["pinned_message_ids"] = message_id
                update["$set"]["_pin_details." + message_id] = {"at": now().isoformat(), "by": user["id"]}
            else:
                query["pinned_message_ids"] = message_id
                update["$pull"] = {"pinned_message_ids": message_id}
                update["$unset"] = {"_pin_details." + message_id: ""}
            await self._active(user)
            changed = await self.get_db().chats.find_one_and_update(query, update,
                return_document=ReturnDocument.AFTER)
            if not changed:
                latest = await self._chat(chat_id, user)
                if (message_id in latest.get("pinned_message_ids", [])) != payload.pinned:
                    raise HTTPException(409, "A conversation can pin up to 20 messages. Try again after synchronization.")
        await self._repair_pin(chat_id, message_id)
        return await self._current(chat_id, message_id, user)

    async def _repair_pin(self, chat_id, message_id):
        db = self.get_db()
        for _ in range(4):
            chat = await db.chats.find_one({"id": chat_id})
            if not chat or message_id not in chat.get("_pin_pending", []):
                return
            pin_version = chat.get("_pin_revision", 0)
            pinned = message_id in chat.get("pinned_message_ids", [])
            message = await db.messages.find_one({"chat_id": chat_id, "id": message_id})
            if pinned and (not message or message.get("deleted_at")):
                await self._queue_unpin_deleted(chat_id, message_id)
                continue
            if message and not message.get("deleted_at") and message.get("_pin_revision", 0) < pin_version:
                if bool(message.get("_pinned")) != pinned:
                    change = {"_pinned": pinned, "_pin_revision": pin_version, "sync_pending": True}
                    if pinned:
                        details = (chat.get("_pin_details") or {}).get(message_id, {})
                        change.update({"pinned_at": details.get("at"), "pinned_by": details.get("by")})
                    else:
                        change["_privacy_removal_revision"] = revision(message) + 1
                    updated = await db.messages.find_one_and_update(
                        {**revision_filter(message), "deleted_at": {"$exists": False}},
                        {"$set": change, "$inc": {"revision": 1}}, return_document=ReturnDocument.AFTER)
                    if not updated:
                        continue
                    await self._publish(chat, updated)
                else:
                    await db.messages.update_one(revision_filter(message), {"$set": {"_pin_revision": pin_version}})
            await db.chats.update_one({"id": chat_id, "_pin_revision": pin_version},
                                      {"$pull": {"_pin_pending": message_id}})
            await db.chats.update_one({"id": chat_id, "_pin_pending": {"$size": 0}},
                                      {"$unset": {"_pin_sync_pending": ""}})
            return

    async def repair_pins(self):
        chats = await self.get_db().chats.find({"_pin_sync_pending": True}).limit(25).to_list(25)
        for chat in chats:
            for mid in chat.get("_pin_pending", [])[:MAX_PIN_PENDING]:
                await self._repair_pin(chat["id"], mid)
