# KUKU release execution

Source: leonartist7/KUKU, base main `5ac751295de7cc1725a43a46d120dbea6e76b2fd`.
Working branch: `codex/kuku-release-20261027`.
Master plan: https://chatgpt.com/space/page_b97c2155690881918f54e1ccbdeabc0f

## Status

This is a release preparation branch, not a production launch. Do not give testers a build until the gates below pass.

Implemented:
- Production configuration validation, explicit CORS, no default signing secret, demo data opt-in and forbidden in production.
- Invitation-bound registration, 12-character passwords, contact-only directory, private public profiles.
- Short access tokens; per-device refresh sessions, rotation/reuse detection and server logout revocation.
- Native refresh credentials in SecureStore; browser refresh credentials in HttpOnly cookies through a same-origin API proxy.
- One-use, scoped WebSocket tickets. Unrelated accounts cannot join a Space by guessing its ID.
- Stable message pagination and duplicate suppression using client message IDs.
- Real file bytes uploaded into private R2 objects, 25 MB upload limit, membership-gated 60-second download URLs.
- Invitation, mandatory email-verification and password-recovery screens. Codes are hashed, expire after 15 minutes, single use; resetting revokes existing sessions.
- A durable per-account outbox persists unsent messages across restarts, preserves retry IDs and clears on logout. Foreground polling resumes from the last message cursor.
- Opt-in native push notifications, durable jobs persisted atomically with messages, bounded retries, receipt checks and invalid-token cleanup. Credentials and physical-device proof are still required.
- 500 MB storage quota per account and owner-only shared-file deletion.
- Account-owned contact blocking and private reports, including queued-push suppression. Blocking stops direct contact in either direction; shared Spaces and existing history stay accessible.
- No authenticated API responses in service-worker caches.
- APK/internal distribution and Play Store bundle build profiles.
- Render/Vercel configuration, environment examples and CI regression checks.
- Calls and placeholder voice recording unavailable in this release; existing historical messages remain readable.

## Verification

Local backend: the regression suite covers synthetic accounts, verification, sessions, messages, attachments, quota/deletion and push delivery. See the latest PR checks for the current test count.
Local frontend infrastructure: 5 Node tests cover service-worker privacy, refresh-cookie proxy, persistent retries and outbox account isolation.
The prior release commit f57c8ff passed 21 backend tests against MongoDB 7 plus five frontend tests and the production build in GitHub CI. On 2026-10-28 the local Linux suite passes 24 backend tests, five frontend tests, TypeScript and the production web export with contact safety added.
TypeScript and the production web export passed for the first foundation commit d002260. The latest PR checks validate the subsequent verification, outbox and notification additions. Provider integration and physical-device checks remain required.
Historical test reports in this repository are not evidence for this branch.

## Infrastructure discovered

An existing Vercel project named `kuku` is available in the connected account.
Observed production alias: https://kuku-lac.vercel.app
The Vercel project root/build/output settings have been corrected to frontend / npm run build:web / dist. Its existing sign-in protection still covers non-custom domains. A real preview build correctly refuses to continue until EXPO_PUBLIC_BACKEND_URL is supplied.
Do not confuse an existing READY deployment with validation of this branch.
Verified Resend sending domains are available, including `lionovart.com`; no email has been sent by this execution.
Render, Atlas, R2 and Expo credentials/projects have not been verified or provisioned.

## Deployment sequence

1. Provision an always-on Render Python web service and MongoDB Atlas database in compatible regions. Choose and approve the paid service tier before provisioning paid resources. Use a fresh production database, not a demo database. Restrict Atlas network access to the backend's outbound addresses.
2. Create a PRIVATE R2 bucket. Do not enable r2.dev or a public custom domain. Issue a least-privilege bucket-scoped read/write token. Set the backend variables listed in `backend/.env.example`; generate a random JWT secret, never copy test values.
3. Configure a verified Resend sender and a sending-only API key. Set `EMAIL_FROM` and `RESEND_API_KEY`. Validate delivery to the operator before opening registration.
4. Deploy the reviewed branch using `render.yaml`. Keep one process/worker: rate limits and realtime socket fan-out currently live in process memory. The readiness endpoint checks database reachability; additionally test upload/download and email credentials.
5. Configure Vercel root directory `frontend`, the build/output settings in `frontend/vercel.json`, `BACKEND_URL` and `EXPO_PUBLIC_BACKEND_URL` with the backend HTTPS origin (no /api suffix). Backend `WEB_ORIGIN` and `CORS_ORIGINS` must exactly include the intended web origin. Add only specific preview origins when testing them.
6. Deploy a preview. Test web signup/signin/refresh/logout in two separate browser profiles, direct deep links, invitation redemption and a real file upload/download. Ensure 25 MB web uploads go directly to the API, not through a serverless proxy.
7. From the backend's trusted shell run `python bootstrap.py owner@example.com` ONCE to generate the first private, email-bound, 24-hour invitation. Register the owner; use You > Invite someone for subsequent users. The code must be delivered privately by the owner.
8. Authenticate EAS to the owner's Expo account, link/create the KUKU project, and add its real project ID to Expo config. Set the public backend URL for both build environments. Run `eas build --platform android --profile preview`. Keep the signing key securely backed up. The Android package ID proposed in this branch is `com.leonartist7.kuku`; confirm ownership before the first distributed APK.
9. Install the signed APK on TWO real Android devices and follow the acceptance checklist. If a recipient uses an iPhone, provide the web app initially; an APK cannot install on iOS.
10. Only after the release gates pass, promote the web deployment and make its production URL accessible without Vercel login. Keep application login and invite-only registration enabled. Share the APK URL manually.

## Remaining engineering gates

- Latest local TypeScript, frontend tests and production web export pass; check PR CI before merging.
- Exercise the saved outbox and reconnect catch-up on actual phones, including lost acknowledgements and app restarts. Chat currently polls every four seconds while focused; unread badges and a message realtime socket remain future improvements.
- Configure Expo/FCM credentials and prove notification delivery on physical devices, including background/terminated-app taps and logged-out recipients. Notification jobs/receipts are implemented but cannot prove device delivery without those credentials.
- Before a broader public rollout: account deletion/export and abandoned-upload cleanup. Contact blocking/reporting is implemented. Invite-only family testing still needs the provider and device gates above.
- Rate limits shared through a database or cache before adding more than one backend worker.
- Dependency security review and a migration rehearsal on a backup. Unique indexes can fail on duplicate legacy data; repair deliberately, never silently discard data.
- Verify no legacy demo users or embedded sensitive files exist in the production database. This branch doesn't destructively clean existing data.
- Third-account denial tests against the deployed API and object storage, not only mocks.
- Exercise WebSocket session expiry, disconnect/reconnect and membership removal with live sockets.
- Monitoring, backup schedule and a successful restoration rehearsal.
- No end-to-end encryption is implemented. Do not describe this app as E2EE.

## Two-device acceptance checklist

- [ ] Two distinct invited accounts, no demo credentials; unrelated third account denied.
- [ ] Signin, restart persistence, refresh rotation, password reset and signout.
- [ ] Send/receive text, repeat a timed-out send without duplication, load older messages.
- [ ] Background/foreground, airplane mode and reconnect; no lost messages.
- [ ] Upload/download image, PDF and binary document; compare downloaded bytes or SHA-256 to originals.
- [ ] 25 MB limit, empty file, interrupted upload and unavailable storage produce clear errors.
- [ ] Recipient can access shared files; unrelated user and unsigned URL cannot.
- [ ] Push on a physical device after its implementation; revoked devices receive no subsequent notifications.
- [ ] APK is a signed release/internal build, runs without Expo Go or a developer machine.
- [ ] Public web URL loads without Vercel login; private API data still requires KUKU login.
- [ ] Rollback and database/file restoration verified.

## Rollback

Record the backend deployment ID, web deployment ID, git SHA, APK version and database backup before launch.
Rollback web and API to a compatible pair. Do not roll back to the insecure legacy auth or auto-join Space behavior.
Keep migrations additive until a rollback rehearsal passes. Rotate/revoke affected credentials after an incident.

## Notification setup and offline behavior

Set an actual EAS project ID through EAS linking or EXPO_PUBLIC_EAS_PROJECT_ID. For Android, supply GOOGLE_SERVICES_JSON as an EAS file environment variable and configure the corresponding FCM v1 credentials in Expo. Enable enhanced push security in Expo and put EXPO_ACCESS_TOKEN only on the backend. Then enable PUSH_ENABLED on the backend and EXPO_PUBLIC_ENABLE_PUSH for the native build. In the installed app, choose You > Notifications > Enable. Web push is not implemented.

Push delivery is at least once; generic alerts use the message ID for notification collapse/replacement. A provider receipt is not proof that a phone displayed the notification. Retry exhaustion leaves a failed job for operational review. One worker is required until cross-process socket/rate-limit coordination is implemented.

Unsent message payloads are intentionally saved locally, separately for each account, and cleared on explicit signout. File bytes upload first; the queued message holds the private attachment ID. An interrupted upload must be retried by the user. Already accepted push notifications cannot be recalled on logout, so notification previews never contain message text or filenames.

## Hosting connection handoff (2026-10-28)

Render and MongoDB Atlas integrations were found but were not installed/connected at the time of this check. Install and connect both in ChatGPT to continue provisioning through their authenticated tools. The existing Vercel connection remains available. R2 bucket credentials and Expo/FCM signing/push configuration must still be supplied through the relevant service environment settings, never in source code or chat. No new hosting resource, production release or signed APK was created in this continuation.

## Reports and blocking

Open the conversation menu to block or report its contact. You > Privacy lists only your own blocked contacts and supports unblocking. Either participant can maintain an independent block; removing one block does not remove the other. Reports are stored in the private reports collection for the operator, with status pending; no automated moderation or response-time promise is made. There is no public reports endpoint. A report can reference only a message from an actual conversation visible to its reporter. Alerts already handed to a push provider cannot be recalled.
