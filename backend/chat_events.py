"""Durable account-scoped chat invalidations and a single-worker realtime transport.

Events contain identifiers only. Message bodies always come from membership-checked
chat APIs. One worker is required until the wakeup hub is replaced by shared fan-out.
"""
import asyncio
import weakref
from contextlib import suppress
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth_service import now


MAX_CURSOR = 9_007_199_254_740_991
PAGE_SIZE = 100


class ChatEvents:
    def __init__(self, get_db, auth):
        self.get_db = get_db
        self.auth = auth
        self.router = APIRouter()
        self._publish_locks = weakref.WeakKeyDictionary()
        self._waiters = {}
        self.repair_hooks = []

        async def sync(
            after: Optional[int] = Query(None, ge=0, le=MAX_CURSOR),
            current=Depends(auth.verified),
        ):
            return await self.read(current["id"], after)

        self.router.add_api_route("/messages/sync", sync, methods=["GET"])

    def _lock(self):
        # Runtime has one loop; isolated test/app lifespans may create new loops.
        loop = asyncio.get_running_loop()
        if loop not in self._publish_locks:
            self._publish_locks[loop] = asyncio.Lock()
        return self._publish_locks[loop]

    async def indexes(self):
        db = self.get_db()
        await db.chat_events.create_index([("user_id", 1), ("seq", 1)])
        await db.chat_events.create_index("expires_at", expireAfterSeconds=0)
        await db.messages.create_index([("sync_pending", 1), ("created_at", 1)])

    async def latest(self):
        # The lock prevents exposing a sequence before its events are inserted.
        async with self._lock():
            row = await self.get_db().event_counters.find_one({"_id": "messages"})
            return int(row.get("seq", 0)) if row else 0

    async def publish_message(self, chat, message):
        db = self.get_db()
        notified = set()
        revision = message.get("revision", 0)
        change = "created" if revision == 0 else "updated"
        privacy_removal = bool(message.get("deleted_at")) or message.get("_privacy_removal_revision") == revision
        async with self._lock():
            for uid in set(chat.get("members", [])):
                event_id = uid + ":" + message["id"] + (":revision:" + str(revision) if revision else "")
                if await db.chat_events.find_one({"_id": event_id}):
                    continue
                counter = await db.event_counters.find_one_and_update(
                    {"_id": "messages"}, {"$inc": {"seq": 1}},
                    upsert=True, return_document=ReturnDocument.AFTER,
                )
                created = now()
                try:
                    await db.chat_events.insert_one({
                        "_id": event_id, "user_id": uid, "seq": counter["seq"],
                        "chat_id": chat["id"], "message_id": message["id"],
                        "sender_id": message["sender_id"], "created_at": created,
                        "revision": revision, "change": change, "privacy_removal": privacy_removal,
                        "expires_at": created + timedelta(days=7),
                    })
                except DuplicateKeyError:
                    # A retried send repairs missing recipients without duplicate events.
                    continue
                notified.add(uid)
            await db.messages.update_one({"id": message["id"], "chat_id": chat["id"], "$or": [
                {"revision": revision}, *([{"revision": {"$exists": False}}] if revision == 0 else [])]},
                {"$unset": {"sync_pending": ""}})
        for uid in notified:
            for event in tuple(self._waiters.get(uid, ())):
                event.set()

    async def repair_pending(self):
        # The marker is committed with the message. A caller disappearing after a
        # partial publication cannot permanently strand the recipient's refresh.
        db = self.get_db()
        for repair in self.repair_hooks:
            await repair()
        pending = await db.messages.find({"sync_pending": True}).sort("created_at", 1).limit(PAGE_SIZE).to_list(PAGE_SIZE)
        for message in pending:
            chat = await db.chats.find_one({"id": message["chat_id"]})
            if chat:
                await self.publish_message(chat, message)
            else:
                revision = message.get("revision", 0)
                await db.messages.update_one({"id": message["id"], "$or": [
                    {"revision": revision}, *([{"revision": {"$exists": False}}] if revision == 0 else [])]},
                    {"$unset": {"sync_pending": ""}})

    async def read(self, uid, after=None, through=None):
        if after is None:
            return {"events": [], "cursor": await self.latest(), "reset": True}
        latest = await self.latest()
        if after > latest:
            return {"events": [], "cursor": latest, "reset": True}
        db = self.get_db()
        sequence = {"$gt": after}
        if through is not None:
            sequence["$lte"] = through
        rows = await db.chat_events.find({
            "user_id": uid, "seq": sequence, "expires_at": {"$gt": now()},
        }).sort("seq", 1).limit(PAGE_SIZE).to_list(PAGE_SIZE)
        chat_ids = list({row["chat_id"] for row in rows})
        chats = await db.chats.find(
            {"id": {"$in": chat_ids}, "members": uid}, {"id": 1, "members": 1},
        ).to_list(PAGE_SIZE) if chat_ids else []
        peers = list({member for chat in chats for member in chat["members"] if member != uid})
        blocks = await db.blocks.find({"$or": [
            {"owner_id": uid, "target_id": {"$in": peers}},
            {"target_id": uid, "owner_id": {"$in": peers}},
        ]}).to_list(2 * PAGE_SIZE) if peers else []
        blocked = {row["target_id"] if row["owner_id"] == uid else row["owner_id"] for row in blocks}
        allowed = {chat["id"] for chat in chats if not blocked.intersection(set(chat["members"]) - {uid})}
        memberships = {chat["id"] for chat in chats}
        events = [{
            "type": "chat_changed", "chat_id": row["chat_id"],
            "message_id": row["message_id"], "sender_id": row["sender_id"],
            "change": row.get("change", "created"), "revision": row.get("revision", 0),
            "cursor": row["seq"], "live": False,
        } for row in rows if row["chat_id"] in allowed or (row.get("privacy_removal") and row["chat_id"] in memberships)]
        return {
            "events": events, "cursor": int(rows[-1]["seq"]) if rows else after,
            "reset": False, "more": len(rows) == PAGE_SIZE,
        }

    async def _session(self, user):
        current = await self.auth.session_user(user["_session_id"], user["id"])
        if not current.get("email_verified"):
            raise HTTPException(403, "Verify your email")
        return current

    async def _send(self, websocket, value):
        await asyncio.wait_for(websocket.send_json(value), timeout=10)

    async def socket(
        self, websocket: WebSocket,
        ticket: str = Query(..., min_length=1, max_length=256),
        after: Optional[int] = Query(None, ge=0, le=MAX_CURSOR),
    ):
        user = await self.auth.consume_ticket(ticket, "messages")
        if not user or not user.get("email_verified"):
            await websocket.close(code=4401)
            return
        uid = user["id"]
        if len(self._waiters.get(uid, ())) >= 8:
            await websocket.close(code=4408)
            return
        waiter = asyncio.Event()
        # Reserve synchronously before the first handshake await.
        self._waiters.setdefault(uid, set()).add(waiter)
        receiver = None
        wakeup = None
        try:
            await asyncio.wait_for(websocket.accept(), timeout=5)
            self.auth.sockets.setdefault(user["_session_id"], set()).add(websocket)
            high = await self.latest()
            invalid = after is not None and after > high
            cursor = high if after is None or invalid else after
            # Always reconcile a snapshot: replay retention may have expired.
            await self._send(websocket, {"type": "ready", "cursor": cursor, "reset": True})
            # Replay is explicitly silent; fresh events are marked live only afterward.
            while cursor < high:
                await self._session(user)
                page = await self.read(uid, cursor, through=high)
                for event in page["events"]:
                    await self._send(websocket, event)
                if page["cursor"] == cursor:
                    break
                cursor = page["cursor"]
                if not page.get("more"):
                    break
            cursor = high
            await self._send(websocket, {"type": "replay_complete", "cursor": cursor})
            receiver = asyncio.create_task(websocket.receive_text())
            while True:
                waiter.clear()
                await self._session(user)
                page = await self.read(uid, cursor)
                for event in page["events"]:
                    await self._send(websocket, {**event, "live": True})
                if page["cursor"] != cursor:
                    cursor = page["cursor"]
                    await self._send(websocket, {"type": "cursor", "cursor": cursor})
                if page.get("more"):
                    continue
                wakeup = asyncio.create_task(waiter.wait())
                done, _ = await asyncio.wait({receiver, wakeup}, timeout=15, return_when=asyncio.FIRST_COMPLETED)
                if receiver in done:
                    text = receiver.result()
                    if len(text) > 256:
                        await websocket.close(code=4400)
                        return
                    await self._send(websocket, {"type": "pong"})
                    receiver = asyncio.create_task(websocket.receive_text())
                if not done:
                    await self._send(websocket, {"type": "pong"})
                wakeup.cancel()
                with suppress(asyncio.CancelledError):
                    await wakeup
                wakeup = None
        except TimeoutError:
            with suppress(RuntimeError, WebSocketDisconnect, TimeoutError):
                await asyncio.wait_for(websocket.close(code=4408), timeout=2)
        except HTTPException:
            with suppress(RuntimeError, WebSocketDisconnect):
                await websocket.close(code=4401)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            for task in (receiver, wakeup):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                        await task
            sockets = self.auth.sockets.get(user["_session_id"])
            if sockets is not None:
                sockets.discard(websocket)
                if not sockets:
                    self.auth.sockets.pop(user["_session_id"], None)
            waiters = self._waiters.get(uid)
            if waiters is not None:
                waiters.discard(waiter)
                if not waiters:
                    self._waiters.pop(uid, None)

