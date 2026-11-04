"""Bounded personal-data snapshots and deliberate account closure.

Closure immediately disables authentication and records an operator cleanup request.
It does not claim that provider objects, shared history or backups have been erased.
"""
import asyncio
from datetime import timedelta
from typing import Literal, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from starlette.concurrency import run_in_threadpool

import settings
from auth_service import now, profile, verify_password

EXPORT_SECTIONS = ("profile", "messages", "attachments", "audio_uploads", "spaces", "space_messages", "calls")
Section = Literal["profile", "messages", "attachments", "audio_uploads", "spaces", "space_messages", "calls"]
EXPORT_FIELDS = {
    "messages": ("id", "chat_id", "type", "text", "emote_id", "attachment_id", "file_name", "file_size", "duration_ms", "space_id", "space_name", "created_at"),
    "attachments": ("id", "chat_id", "name", "size", "kind", "media_type", "created_at"),
    "audio_uploads": ("id", "title", "duration_sec", "cover_emoji", "size", "media_type", "created_at"),
    "spaces": ("id", "name", "mode", "created_at", "updated_at"),
    "space_messages": ("id", "space_id", "type", "text", "created_at"),
    "calls": ("id", "status", "duration_sec", "started_at", "ended_at", "created_at"),
}
OWNER_FIELD = {
    "messages": "sender_id", "attachments": "owner_id", "audio_uploads": "uploader_id",
    "spaces": "members", "space_messages": "sender_id", "calls": "members",
}


class CloseAccountIn(BaseModel):
    model_config = {"extra": "forbid"}
    password: str = Field(min_length=1, max_length=256)
    confirmation: Literal["DELETE"]


def export_cursor(uid, section, after):
    return jwt.encode({
        "sub": uid, "section": section, "after": after, "type": "account_export",
        "iss": "kuku", "aud": "account-export", "exp": now() + timedelta(hours=1),
    }, settings.JWT_SECRET, algorithm="HS256")


def read_cursor(token, uid, section):
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"],
            audience="account-export", issuer="kuku",
            options={"require": ["exp", "sub", "section", "after", "type"]})
        after = payload["after"]
        if payload["type"] != "account_export" or payload["sub"] != uid or payload["section"] != section:
            raise ValueError()
        if not isinstance(after, str) or not after or len(after) > 128:
            raise ValueError()
        return after
    except (jwt.InvalidTokenError, KeyError, ValueError, TypeError):
        raise HTTPException(400, "This export page expired or is invalid. Start a new export.") from None


async def account_privacy_indexes(db):
    for section, owner in OWNER_FIELD.items():
        await db[section].create_index([(owner, 1), ("id", 1)])


def account_privacy_router(get_db, auth):
    router = APIRouter()

    @router.get("/account/export")
    async def export_page(
        section: Section = "profile",
        cursor: Optional[str] = Query(None, max_length=2048),
        limit: int = Query(100, ge=1, le=100),
        user=Depends(auth.verified),
    ):
        await auth.limit("account-export:" + user["id"], 240, 3600)
        after = read_cursor(cursor, user["id"], section) if cursor else None
        response = {
            "schema_version": 1, "section": section, "exported_at": now().isoformat(),
            "items": [], "next_cursor": None,
        }
        if section == "profile":
            if cursor:
                raise HTTPException(400, "Profile export has only one page.")
            active = await auth.session_user(user["_session_id"], user["id"])
            response["items"] = [profile(active, True)]
            return response
        # Every section is owner- or membership-scoped before applying pagination.
        query = {OWNER_FIELD[section]: user["id"]}
        if after:
            query["id"] = {"$gt": after}
        fields = EXPORT_FIELDS[section]
        projection = {field: 1 for field in fields}
        projection["_id"] = 0
        rows = await get_db()[section].find(query, projection).sort("id", 1).limit(limit + 1).to_list(limit + 1)
        visible = rows[:limit]
        response["items"] = [{key: row[key] for key in fields if key in row} for row in visible]
        if len(rows) > limit:
            response["next_cursor"] = export_cursor(user["id"], section, visible[-1]["id"])
        # Revalidate after reads: a concurrent closure/logout must not complete an export.
        await auth.session_user(user["_session_id"], user["id"])
        return response

    @router.post("/account/close")
    async def close_account(payload: CloseAccountIn, request: Request, response: Response, user=Depends(auth.verified)):
        auth.check_origin(request)
        await auth.limit("account-close:" + user["id"], 5, 3600)
        valid = await run_in_threadpool(verify_password, payload.password, user["password_hash"])
        if not valid:
            raise HTTPException(400, "Your password does not match. Your account is still open.")
        await auth.session_user(user["_session_id"], user["id"])
        db = get_db()
        # Record the request first; the same id makes retries/operational cleanup idempotent.
        requested = now()
        await db.account_deletions.update_one({"_id": user["id"]}, {"$setOnInsert": {
            "user_id": user["id"], "requested_at": requested, "status": "closure_pending",
            "policy_version": 1, "physical_erasure_completed": False,
        }}, upsert=True)
        # Disabling is the authorization boundary even if later session cleanup is interrupted.
        closed = await db.users.find_one_and_update(
            {"id": user["id"], "disabled": {"$ne": True}},
            {"$set": {"disabled": True, "closed_at": requested,
                "name": "Former member", "bio": "", "avatar": None,
                "deletion_status": "awaiting_operator_cleanup"}},
            return_document=ReturnDocument.AFTER,
        )
        if not closed:
            raise HTTPException(409, "This account is already closed.")
        await db.account_deletions.update_one({"_id": user["id"]}, {"$set": {"status": "awaiting_operator_cleanup"}})
        await db.sessions.update_many({"user_id": user["id"]}, {"$set": {"revoked": True}})
        await db.devices.delete_many({"user_id": user["id"]})
        await db.web_devices.delete_many({"user_id": user["id"]})
        await db.ws_tickets.delete_many({"user_id": user["id"]})
        await db.file_tickets.delete_many({"user_id": user["id"]})
        await db.invites.update_many({"creator_id": user["id"], "redeemed_by": None},
            {"$set": {"expires_at": requested}})
        # All persisted sessions are invalid already; close tracked sockets without an unbounded scan.
        sessions = await db.sessions.find({"user_id": user["id"]}, {"_id": 1}).limit(1000).to_list(1000)
        async def close_socket(socket):
            try:
                await asyncio.wait_for(socket.close(code=4401), timeout=2)
            except Exception:
                # Persisted session invalidation already denies further authorized access.
                pass
        closing = []
        for session in sessions:
            sockets = list(auth.sockets.pop(session["_id"], set()))
            closing.extend(close_socket(socket) for socket in sockets)
        if closing:
            try:
                await asyncio.wait_for(asyncio.gather(*closing), timeout=5)
            except asyncio.TimeoutError:
                pass
        response.delete_cookie("kuku_refresh", path="/api/auth")
        return {
            "status": "closed", "data_deletion": "awaiting_operator_cleanup",
            "physical_erasure_completed": False,
            "message": "Your account is closed and its sessions and alerts are disabled. Data deletion is recorded for operator processing; shared history, stored files and backups have not been fully erased.",
        }

    return router

