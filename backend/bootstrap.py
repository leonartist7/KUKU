"""Run once from a trusted backend console to invite the first owner."""
import asyncio
import secrets
import sys
from datetime import timedelta
from dotenv import load_dotenv
load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import TypeAdapter, EmailStr
import settings
from auth_service import digest, now

async def main(email):
    email = str(TypeAdapter(EmailStr).validate_python(email)).lower()
    client = AsyncIOMotorClient(settings.MONGO_URL)
    db = client[settings.DB_NAME]
    # Atomic marker prevents concurrent or repeat bootstrap invitations.
    token = secrets.token_urlsafe(32)
    try:
        if await db.users.count_documents({}) > 0:
            raise SystemExit("Bootstrap refused: accounts already exist. Use an account invitation.")
        await db.invites.insert_one({"_id": "bootstrap-lock", "email": email})
        await db.invites.insert_one({"_id": digest(token), "email": email, "creator_id": None,
            "redeemed_by": None, "expires_at": now() + timedelta(hours=24)})
        print("First-account invitation (keep private; expires in 24 hours): " + token)
    finally:
        client.close()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python bootstrap.py owner@example.com")
    asyncio.run(main(sys.argv[1]))
