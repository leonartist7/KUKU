"""Email verification and recovery using short-lived, single-use codes."""
import os
import secrets
from datetime import timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from starlette.concurrency import run_in_threadpool
from pymongo import ReturnDocument
from auth_service import digest, now, hash_password
import settings

class EmailIn(BaseModel):
    email: EmailStr
class CodeIn(EmailIn):
    code: str = Field(min_length=8, max_length=128)
class ResetIn(CodeIn):
    password: str = Field(min_length=12, max_length=256)

async def send_code(email, code, kind):
    key, sender = os.getenv("RESEND_API_KEY"), os.getenv("EMAIL_FROM")
    if not key or not sender:
        raise HTTPException(503, "Account email is not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post("https://api.resend.com/emails",
            headers={"Authorization": "Bearer " + key},
            json={"from": sender, "to": [email], "subject": "KUKU " + kind + " code",
                  "text": "Your KUKU " + kind + " code is:\n\n" + code +
                  "\n\nIt expires in 15 minutes and can only be used once. If you did not request this, ignore this email."})
        if r.status_code >= 300:
            raise HTTPException(503, "Account email is temporarily unavailable")

def recovery_router(db_getter, auth):
    router = APIRouter()
    async def issue(email, kind):
        # Require configuration even for unknown accounts: same public behavior.
        if not os.getenv("RESEND_API_KEY") or not os.getenv("EMAIL_FROM"):
            raise HTTPException(503, "Account email is not configured")
        user = await db_getter().users.find_one({"email": email})
        if user and not user.get("disabled"):
            code = secrets.token_urlsafe(24)
            await db_getter().account_codes.replace_one({"_id": kind + ":" + user["id"]},
                {"_id": kind + ":" + user["id"], "user_id": user["id"], "hash": digest(code),
                 "expires_at": now() + timedelta(minutes=15)}, upsert=True)
            await send_code(email, code, kind)
        return {"ok": True, "message": "If this account exists, a code has been sent."}

    async def consume(payload, kind):
        email = str(payload.email).lower()
        await auth.limit("code:" + digest(email), 5, 900)
        user = await db_getter().users.find_one({"email": email})
        doc = await db_getter().account_codes.find_one_and_delete({
            "_id": kind + ":" + (user["id"] if user else ""),
            "hash": digest(payload.code), "expires_at": {"$gt": now()}})
        if not doc:
            raise HTTPException(400, "Invalid or expired code")
        return user

    @router.post("/auth/forgot-password")
    async def forgot(payload: EmailIn, request: Request):
        auth.check_origin(request)
        email = str(payload.email).lower()
        await auth.limit("recover-ip:" + request.client.host, 10, 3600)
        await auth.limit("recover:" + digest(email), 3, 3600)
        return await issue(email, "password reset")

    @router.post("/auth/reset-password")
    async def reset(payload: ResetIn, request: Request):
        auth.check_origin(request)
        user = await consume(payload, "password reset")
        hashed = await run_in_threadpool(hash_password, payload.password)
        await db_getter().users.update_one({"id": user["id"]}, {"$set": {"password_hash": hashed, "email_verified": True}})
        sessions = await db_getter().sessions.find({"user_id": user["id"], "revoked": False}).to_list(1000)
        for session in sessions:
            await auth.revoke(session["_id"])
        return {"ok": True}

    @router.post("/auth/verification")
    async def verification(user=Depends(auth.current)):
        await auth.limit("verify:" + user["id"], 3, 3600)
        return await issue(user["email"], "email verification")

    @router.post("/auth/verify")
    async def verify(payload: CodeIn, user=Depends(auth.current)):
        if str(payload.email).lower() != user["email"]:
            raise HTTPException(400, "Use your account email")
        await consume(payload, "email verification")
        await db_getter().users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
        return {"ok": True}
    return router
