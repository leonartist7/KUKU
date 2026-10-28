"""Durable push delivery state lives in each message, atomically with its content."""
import asyncio
import logging
import os
from datetime import timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from auth_service import now
import settings
from safety import blocked

log = logging.getLogger("kuku.push")
class DeviceIn(BaseModel):
    token: str = Field(pattern=r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$", max_length=256)

def device_router(db_getter, auth):
    router = APIRouter()
    @router.post("/devices")
    async def register(payload: DeviceIn, user=Depends(auth.verified)):
        if not settings.PUSH_ENABLED:
            raise HTTPException(503, "Notifications are not configured yet")
        await auth.limit("devices:" + user["id"], 20, 3600)
        await db_getter().devices.replace_one({"_id": payload.token},
            {"_id": payload.token, "user_id": user["id"], "session_id": user["_session_id"], "updated_at": now()}, upsert=True)
        return {"ok": True}
    @router.delete("/devices")
    async def unregister(user=Depends(auth.current)):
        await db_getter().devices.delete_many({"session_id": user["_session_id"]})
        return {"ok": True}
    return router

class ExpoGateway:
    async def request(self, endpoint, payload):
        headers = {"Authorization": "Bearer " + os.environ["EXPO_ACCESS_TOKEN"]}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post("https://exp.host/--/api/v2/push/" + endpoint, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
            if body.get("errors"):
                raise RuntimeError("Push provider rejected request")
            return body["data"]
    async def send(self, payload): return await self.request("send", payload)
    async def receipts(self, ids): return await self.request("getReceipts", {"ids": ids})

gateway = ExpoGateway()

async def deliver_one(db):
    message = await db.messages.find_one_and_update({
        "push_state": {"$in": ["pending", "retry", "sending"]},
        "push_due": {"$lte": now()}, "push_attempts": {"$lt": 6},
    }, {"$set": {"push_state": "sending", "push_due": now() + timedelta(minutes=2)}, "$inc": {"push_attempts": 1}},
        return_document=ReturnDocument.AFTER)
    if not message:
        return False
    try:
        chat = await db.chats.find_one({"id": message["chat_id"]})
        recipients = [uid for uid in (chat or {}).get("members", []) if uid != message["sender_id"]]
        devices = []
        for device in await db.devices.find({"user_id": {"$in": recipients}}).limit(100).to_list(100):
            session = await db.sessions.find_one({"_id": device["session_id"], "revoked": False, "expires_at": {"$gt": now()}})
            user = await db.users.find_one({"id": device["user_id"], "disabled": {"$ne": True}})
            if session and user and not await blocked(db, message["sender_id"], device["user_id"]):
                devices.append(device)
        if devices:
            notifications = [{"to": d["_id"], "title": "KUKU", "body": "You have a new message.",
                "sound": "default", "channelId": "messages", "collapseId": message["id"], "tag": message["id"],
                "data": {"chatId": message["chat_id"], "messageId": message["id"]}} for d in devices]
            tickets = await gateway.send(notifications)
            if len(tickets) != len(devices):
                raise RuntimeError("Invalid push ticket response")
            retry = False
            for device, ticket in zip(devices, tickets):
                if ticket.get("status") == "ok" and ticket.get("id"):
                    await db.push_receipts.replace_one({"_id": ticket["id"]},
                        {"_id": ticket["id"], "device_token": device["_id"], "session_id": device["session_id"],
                         "due": now() + timedelta(minutes=15), "expires_at": now() + timedelta(hours=24)}, upsert=True)
                elif ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                    await db.devices.delete_one({"_id": device["_id"], "session_id": device["session_id"]})
                else:
                    retry = True
            if retry:
                raise RuntimeError("Push ticket needs retry")
        await db.messages.update_one({"id": message["id"]}, {"$set": {"push_state": "sent"}})
    except Exception:
        state = "failed" if message["push_attempts"] >= 6 else "retry"
        await db.messages.update_one({"id": message["id"]}, {"$set": {"push_state": state,
            "push_due": now() + timedelta(seconds=min(3600, 10 * 2 ** message["push_attempts"]))}})
        log.warning("Push delivery deferred; state=%s", state)
    return True

async def check_receipts(db):
    entries = await db.push_receipts.find({"due": {"$lte": now()}}).limit(100).to_list(100)
    if not entries: return
    results = await gateway.receipts([e["_id"] for e in entries])
    for entry in entries:
        result = results.get(entry["_id"])
        if result:
            if result.get("details", {}).get("error") == "DeviceNotRegistered":
                await db.devices.delete_one({"_id": entry["device_token"], "session_id": entry["session_id"]})
            elif result.get("status") != "ok":
                log.warning("Push receipt reports delivery failure")
            await db.push_receipts.delete_one({"_id": entry["_id"]})
        else:
            await db.push_receipts.update_one({"_id": entry["_id"]}, {"$set": {"due": now() + timedelta(minutes=15)}})

async def run_worker(db):
    while True:
        try:
            # Recover messages whose last attempt was interrupted before marking failure.
            await db.messages.update_many({"push_state":"sending","push_due":{"$lte":now()},"push_attempts":{"$gte":6}},
                {"$set":{"push_state":"failed"}})
            for _ in range(20):
                if not await deliver_one(db): break
            await check_receipts(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("Push worker will retry after a service failure")
        await asyncio.sleep(5)
