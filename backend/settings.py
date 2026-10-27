"""Validated deployment settings; importing never creates users or infrastructure."""
import os

def flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}

APP_ENV = os.getenv("APP_ENV", "development")
PRODUCTION = APP_ENV == "production"
SEED_DEMO_DATA = flag("SEED_DEMO_DATA")
REGISTRATION_MODE = os.getenv("REGISTRATION_MODE", "invite")
JWT_SECRET = os.getenv("JWT_SECRET", "")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.getenv("DB_NAME", "kuku")
WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:8081").rstrip("/")
CORS_ORIGINS = [s.strip() for s in os.getenv("CORS_ORIGINS", WEB_ORIGIN).split(",") if s.strip()]
ENABLE_CALLS = flag("ENABLE_CALLS")

if len(JWT_SECRET) < 32 or JWT_SECRET == "supersecret-dev-token":
    raise RuntimeError("JWT_SECRET must contain at least 32 random characters")
if REGISTRATION_MODE not in {"invite", "open", "closed"}:
    raise RuntimeError("REGISTRATION_MODE must be invite, open or closed")
if PRODUCTION:
    if SEED_DEMO_DATA:
        raise RuntimeError("Demo seeding is forbidden in production")
    if not os.getenv("MONGO_URL") or not os.getenv("DB_NAME"):
        raise RuntimeError("Production requires explicit MONGO_URL and DB_NAME")
    if not CORS_ORIGINS or any(not s.startswith("https://") or "*" in s for s in CORS_ORIGINS):
        raise RuntimeError("Production requires explicit HTTPS CORS_ORIGINS")
    if not WEB_ORIGIN.startswith("https://"):
        raise RuntimeError("Production requires an HTTPS WEB_ORIGIN")

PUSH_ENABLED = flag("PUSH_ENABLED")
if PUSH_ENABLED and not os.getenv("EXPO_ACCESS_TOKEN"):
    raise RuntimeError("Enable Expo enhanced push security and set EXPO_ACCESS_TOKEN before enabling push")
