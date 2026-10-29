"""Revocable sessions and expiring invitations for KUKU."""
import asyncio
import hashlib
import secrets
import time
import uuid
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

import settings
from profile_photos import MAX_BASE64, normalize_photo

def now():
    return datetime.now(timezone.utc)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def profile(user, private=False):
    fields = ("id", "name", "avatar", "bio", "created_at")
    result = {key: user.get(key) for key in fields}
    if private:
        result["email"] = user["email"]
        result["email_verified"] = bool(user.get("email_verified"))
        result["onboarding_complete"] = user.get("onboarding_complete", True)
    return result

def hash_password(password):
    # New hashes use SHA256 before bcrypt to support long UTF-8 passphrases.
    value = hashlib.sha256(password.encode()).hexdigest().encode()
    return "sha256:" + bcrypt.hashpw(value, bcrypt.gensalt()).decode()

def verify_password(password, value):
    try:
        if value.startswith("sha256:"):
            return bcrypt.checkpw(hashlib.sha256(password.encode()).hexdigest().encode(), value[7:].encode())
        return bcrypt.checkpw(password.encode(), value.encode())
    except ValueError:
        return False

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    name: str = Field(min_length=1, max_length=80)
    invite_token: str | None = Field(default=None, max_length=256)

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Please enter your name")
        return value.strip()

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)

class ProfileIn(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(min_length=1, max_length=80)
    bio: str = Field(default="", max_length=160)

    @field_validator("name", "bio")
    @classmethod
    def clean_text(cls, value, info):
        value = value.strip()
        if info.field_name == "name" and not value:
            raise ValueError("Please enter your name")
        return value

class RefreshIn(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=256)

class PhotoIn(BaseModel):
    model_config = {"extra": "forbid"}
    image_base64: str | None = Field(default=None, max_length=MAX_BASE64)

class InviteIn(BaseModel):
    model_config = {"extra": "forbid"}
    email: EmailStr | None = None

class TicketIn(BaseModel):
    scope: str = Field(pattern=r"^(calls|messages|space:[a-zA-Z0-9-]+)$")

class AuthService:
    def __init__(self, db):
        self.db = db
        self.router = APIRouter()
        self.sockets = {}
        self.rate = {}
        self.router.add_api_route("/auth/register", self.register, methods=["POST"])
        self.router.add_api_route("/auth/login", self.login, methods=["POST"])
        self.router.add_api_route("/auth/refresh", self.refresh, methods=["POST"])
        # Depend dynamically on this service, keeping test DB injection simple.
        async def me(user=Depends(self.current)):
            return profile(user, True)
        async def save_profile(payload: ProfileIn, request: Request, user=Depends(self.verified)):
            self.check_origin(request)
            await self.limit("profile:" + user["id"], 30, 3600)
            saved = await self.db.users.find_one_and_update(
                {"id": user["id"]},
                {"$set": {"name": payload.name, "bio": payload.bio, "onboarding_complete": True}},
                return_document=ReturnDocument.AFTER,
            )
            return profile(saved, True)
        async def save_photo(payload: PhotoIn, request: Request, user=Depends(self.verified)):
            self.check_origin(request)
            await self.limit("photo:" + user["id"], 20, 3600)
            avatar = await run_in_threadpool(normalize_photo, payload.image_base64)
            saved = await self.db.users.find_one_and_update({"id": user["id"]},
                {"$set": {"avatar": avatar}}, return_document=ReturnDocument.AFTER)
            return profile(saved, True)
        async def logout(request: Request, response: Response, user=Depends(self.current)):
            await self.revoke(user["_session_id"])
            response.delete_cookie("kuku_refresh", path="/api/auth")
            return {"ok": True}
        async def invite(payload: InviteIn, request: Request, user=Depends(self.verified)):
            self.check_origin(request)
            await self.limit("invite:" + user["id"], 10, 3600)
            token = secrets.token_urlsafe(32)
            await self.db.invites.insert_one({
                "_id": digest(token), "email": str(payload.email).lower() if payload.email else None,
                "creator_id": user["id"], "expires_at": now() + timedelta(days=7),
                "redeemed_by": None,
            })
            return {"invite_token": token, "invite_url": settings.WEB_ORIGIN.rstrip("/") + "/login#invite=" + token, "expires_in": 604800}
        async def ticket(payload: TicketIn, user=Depends(self.verified)):
            await self.limit("ticket:" + user["id"], 60, 60)
            if payload.scope.startswith("space:"):
                space_id = payload.scope[6:]
                if not await self.db.spaces.find_one({"id": space_id, "members": user["id"]}):
                    raise HTTPException(404, "Space not found")
            token = secrets.token_urlsafe(32)
            await self.db.ws_tickets.insert_one({
                "_id": digest(token), "scope": payload.scope, "session_id": user["_session_id"],
                "user_id": user["id"], "expires_at": now() + timedelta(seconds=30),
            })
            return {"ticket": token}
        self.router.add_api_route("/auth/me", me)
        self.router.add_api_route("/auth/profile", save_profile, methods=["POST"])
        self.router.add_api_route("/auth/photo", save_photo, methods=["POST"])
        self.router.add_api_route("/auth/logout", logout, methods=["POST"])
        self.router.add_api_route("/invites", invite, methods=["POST"])
        self.router.add_api_route("/auth/ws-ticket", ticket, methods=["POST"])

    async def indexes(self):
        await self.db.users.create_index("email", unique=True)
        await self.db.sessions.create_index("expires_at", expireAfterSeconds=0)
        await self.db.sessions.create_index("user_id")
        await self.db.invites.create_index("expires_at", expireAfterSeconds=0)
        await self.db.ws_tickets.create_index("expires_at", expireAfterSeconds=0)

    async def limit(self, key, maximum=10, window=60):
        # Single-worker deployment. Bound memory and fail closed at capacity.
        clock = time.monotonic()
        if len(self.rate) > 10000:
            self.rate = {k: v for k, v in self.rate.items() if v[1] > clock}
            if len(self.rate) > 10000:
                raise HTTPException(429, "Try again shortly")
        count, deadline = self.rate.get(key, (0, clock + window))
        if deadline <= clock:
            count, deadline = 0, clock + window
        self.rate[key] = (count + 1, deadline)
        if count >= maximum:
            raise HTTPException(429, "Too many attempts. Try again later.", headers={"Retry-After": str(window)})

    def web(self, request):
        return request.headers.get("x-kuku-platform") == "web"

    def check_origin(self, request):
        if request.cookies.get("kuku_refresh") or self.web(request):
            if request.headers.get("origin") not in settings.CORS_ORIGINS:
                raise HTTPException(403, "Origin not allowed")

    async def issue(self, user, request, response, session_id=None):
        session_id = session_id or str(uuid.uuid4())
        refresh = secrets.token_urlsafe(48)
        await self.db.sessions.insert_one({
            "_id": session_id, "user_id": user["id"], "refresh_hash": digest(refresh),
            "created_at": now(), "expires_at": now() + timedelta(days=30), "revoked": False,
        })
        return self.tokens(user, session_id, refresh, request, response)

    def tokens(self, user, sid, refresh, request, response):
        token = jwt.encode({"sub": user["id"], "sid": sid, "type": "access",
            "iss": "kuku", "aud": "kuku", "exp": now() + timedelta(minutes=15)}, settings.JWT_SECRET, algorithm="HS256")
        result = {"token": token, "user": profile(user, True)}
        response.headers["Cache-Control"] = "no-store"
        if self.web(request):
            response.set_cookie("kuku_refresh", refresh, max_age=30*86400, httponly=True,
                secure=settings.PRODUCTION, samesite="lax", path="/api/auth")
        else:
            result["refresh_token"] = refresh
        return result

    async def current(self, request: Request):
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(401, "Not authenticated")
        try:
            payload = jwt.decode(header[7:], settings.JWT_SECRET, algorithms=["HS256"],
                audience="kuku", issuer="kuku", options={"require": ["exp", "sub", "sid"]})
            if payload.get("type") != "access":
                raise ValueError()
            return await self.session_user(payload["sid"], payload["sub"])
        except (jwt.InvalidTokenError, KeyError, ValueError):
            raise HTTPException(401, "Session expired. Sign in again.")

    async def verified(self, request: Request):
        user = await self.current(request)
        if not user.get("email_verified"):
            raise HTTPException(403, "Verify your email before using KUKU")
        return user

    async def session_user(self, sid, uid):
        session = await self.db.sessions.find_one({"_id": sid, "user_id": uid, "revoked": False, "expires_at": {"$gt": now()}})
        user = await self.db.users.find_one({"id": uid})
        if not session or not user or user.get("disabled"):
            raise HTTPException(401, "Session expired. Sign in again.")
        user["_session_id"] = sid
        return user

    async def login(self, payload: LoginIn, request: Request, response: Response):
        self.check_origin(request)
        email = str(payload.email).lower()
        await self.limit("login-ip:" + (request.client.host if request.client else "unknown"))
        await self.limit("login-email:" + digest(email))
        user = await self.db.users.find_one({"email": email})
        valid = await run_in_threadpool(verify_password, payload.password, user["password_hash"]) if user else False
        if not valid or user.get("disabled"):
            raise HTTPException(401, "Invalid email or password")
        return await self.issue(user, request, response)

    async def register(self, payload: RegisterIn, request: Request, response: Response):
        self.check_origin(request)
        await self.limit("register:" + (request.client.host if request.client else "unknown"), 5, 3600)
        if settings.REGISTRATION_MODE == "closed":
            raise HTTPException(403, "Registration is closed")
        email = str(payload.email).lower()
        uid = str(uuid.uuid4())
        password_hash = await run_in_threadpool(hash_password, payload.password)
        invitation = None
        if settings.REGISTRATION_MODE == "invite":
            invitation = await self.db.invites.find_one_and_update({
                "_id": digest(payload.invite_token or ""), "$or": [{"email": email}, {"email": None}],
                "expires_at": {"$gt": now()}, "redeemed_by": None,
            }, {"$set": {"redeemed_by": uid}}, return_document=ReturnDocument.AFTER)
            if not invitation:
                raise HTTPException(403, "This invitation is expired, already used, or belongs to another email")
        user = {"id": uid, "email": email, "name": payload.name, "password_hash": password_hash,
            "avatar": None, "bio": "", "created_at": now().isoformat(), "email_verified": False,
            "onboarding_complete": False}
        if invitation:
            user["invited_by"] = invitation.get("creator_id")
        try:
            await self.db.users.insert_one(user)
        except DuplicateKeyError:
            if invitation:
                await self.db.invites.update_one({"_id": invitation["_id"], "redeemed_by": uid}, {"$set": {"redeemed_by": None}})
            raise HTTPException(409, "Unable to create this account")
        # Invitation relationship is durable on user; no second write required for contact access.
        return await self.issue(user, request, response)

    async def refresh(self, payload: RefreshIn, request: Request, response: Response):
        self.check_origin(request)
        await self.limit("refresh:" + (request.client.host if request.client else "unknown"), 120, 60)
        old = request.cookies.get("kuku_refresh") if self.web(request) else payload.refresh_token
        if not old:
            raise HTTPException(401, "Sign in again")
        replacement = secrets.token_urlsafe(48)
        session = await self.db.sessions.find_one_and_update({
            "refresh_hash": digest(old), "revoked": False, "expires_at": {"$gt": now()},
        }, {"$set": {"refresh_hash": digest(replacement)}, "$addToSet": {"used_hashes": digest(old)}},
            return_document=ReturnDocument.AFTER)
        if not session:
            reused = await self.db.sessions.find_one({"used_hashes": digest(old), "revoked": False})
            if reused:
                await self.revoke(reused["_id"])
            raise HTTPException(401, "Sign in again")
        user = await self.session_user(session["_id"], session["user_id"])
        return self.tokens(user, session["_id"], replacement, request, response)

    async def revoke(self, sid):
        await self.db.sessions.update_one({"_id": sid}, {"$set": {"revoked": True}})
        await self.db.devices.delete_many({"session_id": sid})
        for socket in list(self.sockets.pop(sid, set())):
            try:
                await socket.close(code=4401)
            except RuntimeError:
                pass

    async def consume_ticket(self, token, scope):
        entry = await self.db.ws_tickets.find_one_and_delete({"_id": digest(token), "scope": scope, "expires_at": {"$gt": now()}})
        if not entry:
            return None
        try:
            return await self.session_user(entry["session_id"], entry["user_id"])
        except HTTPException:
            return None

    async def contacts(self, user_id):
        # Invite relationships and existing memberships preserve existing legitimate contacts.
        users = await self.db.users.find({"$or": [{"invited_by": user_id}, {"id": user_id}]}).to_list(500)
        me = next((u for u in users if u["id"] == user_id), {})
        ids = {u["id"] for u in users if u["id"] != user_id}
        if me.get("invited_by"):
            ids.add(me["invited_by"])
        for chat in await self.db.chats.find({"members": user_id}).to_list(500):
            ids.update(m for m in chat["members"] if m != user_id)
        from safety import blocked
        return {uid for uid in ids if not await blocked(self.db, user_id, uid)}

    async def require_contact(self, current_id, other_id):
        if other_id not in await self.contacts(current_id):
            raise HTTPException(403, "Invite this person before starting a conversation")
