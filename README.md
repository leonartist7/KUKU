# KUKU

Private, invitation-based chat and file sharing built with Expo, FastAPI, MongoDB and private R2 storage.

This branch is release preparation, not a production-ready release. See [release execution and deployment runbook](docs/RELEASE_EXECUTION.md) for verified checks, setup steps and remaining gates.

## Development

Backend: Python 3.11, MongoDB, `pip install -r backend/requirements-dev.txt`. Copy `backend/.env.example` to a local `.env` and supply a random signing secret. From `backend`, run `uvicorn server:app --reload`. Run `python -m pytest -q` for isolated tests; set `MONGO_TEST_URL` to run against a disposable real MongoDB database.

Frontend: Node 22+, `npm ci` in `frontend`, then `npm start`. Configure `EXPO_PUBLIC_BACKEND_URL` for the device-accessible backend. Run `npm run typecheck`, `npm run test:release` and `npm run build:web` before distributing. Production web export requires an explicit HTTPS API origin.

No demo users are created by default. Bootstrap the first account invitation with `python bootstrap.py owner@example.com` from the trusted backend console. Never commit `.env`, service credentials or Android signing keys.
