# KUKU beta release and recovery

## Source and acceptance
Implementation branch: codex/kuku-experience-20261104. Existing beta release branch:
codex/kuku-release-20261027. Keep main untouched until a separate production decision.
Read docs/AUTONOMOUS_LEDGER.md and fresh remote branch heads before each change.

Web release gates: current backend tests, frontend unit tests, TypeScript, web export,
synthetic onboarding/chat/files/voice/emote walkthrough and synthetic Spaces walkthrough.
Android compilation is an additional gate for the APK; it does not replace physical-device tests.
Passing mocked media tests is not evidence of LiveKit connectivity, Android background delivery,
actual speaker/Bluetooth routing or two-device playback drift.

## Publish a compatible beta
1. Resolve the exact accepted implementation SHA and verify the release branch has not moved.
2. Integrate that accepted commit into the existing review release branch with a fast-forward lease,
   or a reviewed PR merge. Never force-overwrite concurrent work.
3. The release branch skips automatic Vercel builds; implementation previews remain automatic.
   Keep the previous beta alias in place until the new API is ready.
4. The existing Render service is kuku-api-staging, srv-dbhmdac9v7es73bb0pe0 in
   workspace tea-d3iii4k9c44c73ar37pg. Auto-deploy is off; trigger once after integration.
5. Inspect the resulting deploy ID, source commit and terminal live status. An accepted trigger
   or a successful build alone is insufficient.
6. Check /health/live and /health/ready, unauthenticated private endpoints (401/no-store),
   and bounded recent runtime errors. Do not use real family messages as fixtures.
7. Only then move the existing beta frontend alias to the matching READY build in project
   prj_TvSeNwEnmHMqJNWLMaFDAmer3rwN, team team_X1uT5IYWuEZNZ8o54SCyioEu.
8. Preserve the alias-specific access exception and KUKU invitation/account authentication.
   Do not broaden project protection or publish main/production as a side effect.
9. Record exact source/deploy IDs and the verified URL in the ledger and current draft PR.

Existing public beta:
https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login

New preview branches have separate preview-only API origin/proxy configuration.
Browser authentication and direct uploads require an approved origin. Prefer the already-approved
beta alias for a verified family rollout rather than opening new origins indiscriminately.

## Hosting configuration
The JSON proxy is configured for fra1 (Frankfurt) to match the Render API region.
Static assets remain globally delivered. Measure actual latency after the change.
Render still needs its live HTTP health-check path set to /health/ready; repository
render.yaml already specifies it, but a declaration does not prove live application.
Current connected service tools do not expose this settings edit.

The free Render plan can sleep. The recorded first readiness request took 61,428ms,
then 84/97ms warm. These are direct HTTP observations, not p95 or Web Vitals.
An always-on instance remains a separate billing decision; do not create duplicate services,
change a subscription or implement artificial keepalive traffic.

## Recovery constraints
Capture the prior frontend and backend deployment before rollout.
The pre-improvement pair was frontend163f28b (dpl_4te6wLcV2CfVgKmHXC7fVQsc6Py9)
and backendde2fb83 (dep-dbkk8us9v7es73ej9thg). This is historical evidence, not a recommendation
to restore those versions after new data schemas have been written.

Prefer a small forward repair. A rollback does not undo messages, uploads,
account closure or database changes. Binary private Space-audio records may be
unreadable by the old inline-audio implementation. Confirm compatibility before rolling an
API back across this boundary; never claim the old deployment restores all data.

Keep one API worker while hubs and wakeups are in process. Shared fan-out and durable
cross-worker sequencing are prerequisites for horizontal scaling.

## Data and account operations
Account closure is password-confirmed, disables sessions/alerts and queues cleanup.
It is not completed physical erasure. See docs/PRIVACY_RELEASE.md.
Do not test erasure on live accounts or delete orphaned provider objects without verified
ownership, leases, idempotency and retention rules. Confirm backups and an actual restore
procedure before destructive migration; synthetic CI databases do not prove Atlas restore.

## Calls and Android
Keep calls off until verified provider setup and physical two-device acceptance.
The Android preview uses a separate .preview identity and public TEST signing, with calls
and native push disabled. It embeds Hermes and must work without Metro. See
docs/ANDROID_PREVIEW.md. Production signing, FCM credentials, updates and device checks
remain separate release gates.
