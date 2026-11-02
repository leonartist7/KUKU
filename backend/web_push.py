"""Browser push subscriptions, bound to a verified account and revocable session."""
import base64
import hashlib
import json
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool
from auth_service import now


def configured():
    return bool(os.getenv("WEB_PUSH_PUBLIC_KEY") and os.getenv("WEB_PUSH_PRIVATE_KEY"))


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)

    @field_validator("p256dh", "auth")
    @classmethod
    def valid_key(cls, value, info):
        try:
            raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            if len(raw) != (65 if info.field_name == "p256dh" else 16):
                raise ValueError()
            if info.field_name == "p256dh" and raw[0] != 4:
                raise ValueError()
        except Exception:
            raise ValueError("Invalid browser subscription key") from None
        return value


class Subscription(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: Keys

    @field_validator("endpoint")
    @classmethod
    def safe_endpoint(cls, value):
        url = urlsplit(value)
        # Browser subscriptions are untrusted input. Never turn push into arbitrary server requests.
        allowed = {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
        if (url.scheme != "https" or url.hostname not in allowed or url.username or url.password
                or url.port not in (None, 443) or url.fragment or not url.path.startswith("/")):
            raise ValueError("Use Chrome, Firefox or Safari for browser notifications")
        return value


def web_push_router(db_getter, auth):
    router = APIRouter()

    @router.get("/notifications/config")
    async def config(user=Depends(auth.verified)):
        return {"available": configured(), "public_key": os.getenv("WEB_PUSH_PUBLIC_KEY") if configured() else None}

    @router.post("/web-push/subscriptions")
    async def subscribe(payload: Subscription, request: Request, user=Depends(auth.verified)):
        auth.check_origin(request)
        if not configured():
            raise HTTPException(503, "Notifications are getting ready. Please try again shortly.")
        await auth.limit("web-push:" + user["id"], 30, 3600)
        key = hashlib.sha256(payload.endpoint.encode()).hexdigest()
        await db_getter().web_devices.replace_one({"_id": key}, {"_id": key,
            "subscription": payload.model_dump(), "user_id": user["id"],
            "session_id": user["_session_id"], "updated_at": now()}, upsert=True)
        return {"ok": True}

    @router.delete("/web-push/subscriptions")
    async def unsubscribe(user=Depends(auth.current)):
        await db_getter().web_devices.delete_many({"session_id": user["_session_id"]})
        return {"ok": True}
    return router


def send_sync(subscription, payload):
    from pywebpush import webpush, WebPushException
    try:
        webpush(subscription_info=subscription, data=json.dumps(payload),
            vapid_private_key=os.environ["WEB_PUSH_PRIVATE_KEY"],
            vapid_claims={"sub": "mailto:kuku@lionovart.com"}, ttl=3600, timeout=10,
            headers={"Urgency": "high"})
        return True
    except WebPushException as error:
        if error.response is not None and error.response.status_code in (404, 410):
            return False
        raise RuntimeError("Browser notification delivery needs retry") from None


async def send_browser(db, device, message):
    payload = {"title": "KUKU", "body": "You have a new message.",
        "chatId": message["chat_id"], "messageId": message["id"], "userId": device["user_id"]}
    if not await run_in_threadpool(send_sync, device["subscription"], payload):
        await db.web_devices.delete_one({"_id": device["_id"], "session_id": device["session_id"]})
