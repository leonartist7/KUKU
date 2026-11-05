# KUKU autonomous implementation ledger
Updated: 2026-11-05T18:27:03Z

## Authority and source
The user authorized implementation of the master plan in phases, coordinated subagents
and recurring continuation work. This ledger is the shared checkpoint, not a completion claim.

- Repository: leonartist7/KUKU.
- Implementation branch: codex/kuku-experience-20261104.
- Base: codex/kuku-release-20261027 at 163f28bb96ee9ea0c988b6f67ccc5da5d5c73914.
- Existing beta PR: #1 against main. Preserve main and existing access protection.
- Master plan: docs/MASTER_PLAN.md.
- Existing backend: kuku-api-staging, Render srv-dbhmdac9v7es73bb0pe0, workspace tea-d3iii4k9c44c73ar37pg.
- Existing frontend: Vercel project prj_TvSeNwEnmHMqJNWLMaFDAmer3rwN, team team_X1uT5IYWuEZNZ8o54SCyioEu.

## Execution contract
1. Read this ledger, applicable instructions, fresh remote HEAD, PRs and current checks.
2. Do one complete useful work package at a time; preserve unrelated work and recheck HEAD before writes.
3. Coordinate path ownership before parallel agents. A single controller commits/deploys.
4. Use existing dependencies or cloud CI/builds. Do not install large local caches/toolchains.
5. Run meaningful checks for changed behavior; distinguish synthetic, browser and physical-device evidence.
6. Keep calls gated until provider configuration and real two-device media checks pass.
7. Deploy verified compatible beta changes to the existing review environment; avoid duplicate deployments.
8. Do not merge main, alter DNS/protection, buy resources, charge accounts, send personal messages or invitations,
   migrate/delete live data, or expose credentials as part of routine continuation.
9. Missing provider/native credentials or physical-device gates must be recorded honestly. Continue independent work.
10. Update this ledger with exact commit/check/deployment evidence, limitations and the next unfinished item.
11. No recursive schedules or competing autonomous controllers. Stop expansion when the master plan is implemented
    and remaining items require credentials, billing decisions or physical acceptance.

## Coordination
Current controller: root P06 report-only provider inventory, 5 November 2026.
Work was performed through connected GitHub/provider APIs and cloud CI; never assume a prior local worktree exists.
Future scheduled passes must fetch the remote implementation branch and use their actual writable environment.

Initial package owners (all returned; no agent has an outstanding write):
- backend_rooms_calls: server.py, Space/call backend modules/tests.
- design_foundations: theme/tokens/ThemeContext, WelcomeUI, tab shell/inbox/files/You.
- spaces_frontend: Space routes/client/players/timing tests.
- calls_frontend: CallContext/call routes/client/media state/tests.
- chat_reliability: API/AuthContext/chat screen/realtime provider/sounds/tests.
- root: chat_events.py/tests, root layout, CI, docs, release integration.

## Phase state
| Phase | State | Required evidence |
|---|---|---|
| 1 Reliability | FOUNDATIONS DEPLOYED | Account-bound restore/reconnect pass; cold-device and always-on gates open |
| 2 Design and interaction | FOUNDATIONS DEPLOYED | Responsive browser/theme checks pass; physical accessibility review open |
| 3 Chat/performance | CHAT TOOLS + BOUNDED CHAT LIST + PRIVATE MEDIA CACHE DEPLOYED | Controlled anchoring/render/cache evidence recorded; physical/CWV memory budgets remain open |
| 4 Spaces | BETA DEPLOYED; DEVICE SYNC OPEN | Roles/private audio/reconnect checks pass; real drift walkthrough open |
| 5 Calls | AUDIO FOUNDATION IMPLEMENTED; OFF | Provider and audible two-device checks required; native/video incomplete |
| 6 Android/release | TEST APK + STATEFUL RECOVERY REHEARSAL VERIFIED; PRODUCTION GATED | Physical install/push/signing, live backup/media recovery and full erasure still open |


## Current authoritative checkpoint
This section supersedes historical pending statements below.
- Beta: https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login
- Accepted runtime source `d8004c44f0104b46d4067e49e242004216516c73`. [PR #11](https://github.com/leonartist7/KUKU/pull/11) was squash-merged into the review release branch after exact-head checks on source `429cef1cab251c91963a7760fc245c3a6ca2ff22`; main is unchanged.
- Render deploy `dep-dbm9j6u417fc73boo3jg` is LIVE on the accepted runtime. The replacement instance completed application startup at 2026-11-05T14:59:55.300428093Z before the old instance shut down at 15:00:05.807543007Z; Render announced the service live at 15:00:06.572118844Z. The service remains one API worker, manual deploy, free plan and no configured provider health-check path.
- Closed-account retention now has a separate restart-safe stage for metadata-backed unreferenced attachments and Space audio. It requires an independently disabled account, completed operational cleanup, policy version 2 and an operator approval at least five minutes old. Shared message attachments plus current and historical Space audio are preserved. Source reservations and final message/Space checks fail closed on late references.
- Object jobs reclaim expired leases, record provider completion before quota work, release user/global quota with per-counter idempotency tokens and keep compact tombstones without provider keys or error text. Invalid provider/key/size metadata, reactivated users, revoked approval and counter underflow block or retry without claiming completion. Indexed scans have separate row/object budgets and the optional worker is isolated from realtime room maintenance.
- `STORAGE_RETENTION_ENABLED=false` remains the default and was not enabled in Render. No real account received a cleanup approval and no live provider object or quota counter was changed. `physical_erasure_completed` remains false. Provider-only objects stranded before metadata insertion, authored shared history and backup erasure remain outside this stage.
- Account closure now has an expiring compare-and-set operational cleanup lease that runs immediately, at startup and every 15 seconds from the bounded lifecycle worker. Cleanup requires an independently confirmed disabled user; active or missing users are blocked without destructive work.
- Restart-safe cleanup revokes sessions and ephemeral grants, removes recovery codes, expires unused invitations, ends ringing/active calls and participant leases under the per-call token lock, removes per-device Space presence with compare-and-set retries, and repairs Space lifecycle. Shared history, provider objects, the disabled user/tombstone and backups remain retained. Retention policy version 2 records `physical_erasure_pending`; it does not claim provider or backup erasure.
- Exact-head [release run 42047850803](https://github.com/leonartist7/KUKU/actions/runs/42047850803) PASS on candidate `429cef1cab251c91963a7760fc245c3a6ca2ff22`: backend job 127315610634 has 131 isolated Mongo-backed tests; frontend job 127315610481 has 116/116 unit/release tests, TypeScript, web export, onboarding, Spaces, chat-tools and controlled-performance journeys; Android job 127317676821 completed `BUILD SUCCESSFUL` in 8m39s.
- Android artifact [13427325083](https://github.com/leonartist7/KUKU/actions/runs/42047850803/artifacts/13427325083) is 39,063,557 bytes with ZIP SHA256 `22bf7b98be2548538b61b8150cc71fde47c93229dd917e5c8f02599d56428aa4`. Package `com.leonartist7.kuku.preview`, target SDK 36, arm64-v8a, embedded Hermes bytecode and PUBLIC DEBUG TEST signature pass. This is not physical Android, microphone/background/push or production-signing acceptance.
- The frontend source did not change. Exact-source Vercel implementation deployment `dpl_5anXLdqRX1cEgfjGyraAcGuqs4zn` is READY at `https://kuku-x5us4bbp9-lionovart.vercel.app`; an authenticated provider fetch of its `/login` and the release beta `/login` returned HTTP 200 with expected KUKU HTML at 2026-11-05T15:00Z. The feature-only branch deployment failed closed because that branch has no `EXPO_PUBLIC_BACKEND_URL`; the verified implementation deployment carries the review configuration. No alias/protection change was needed.
- Stateful recovery evidence from run 41981806891 remains applicable. Live database/media backup, exact live FCV/PIT consistency, physical erasure, configured LiveKit/FCM, production signing and representative-device acceptance remain external gates.
- Calls and native push remain off. KUKU is not end-to-end encrypted. Main, billing, DNS, access protection and live data remain unchanged. No family messages/invitations or personal-content test reads were used.
## B01 verified synthetic recovery — 4 November 2026
- Tested source: a78c1d399c0b4157507c2d57f521da0a277e2dea, draft PR #4. Restore run 41887901603/job 126777197318 passes on separate authenticated MongoDB8.0.34 services, Database Tools100.20.0 and runner kernel6.8.0-1070-azure. This does not establish exact live Atlas8.0.36/FCV compatibility.
- Target identity is denied a write to another fixture namespace. Quiescent source archive restores only to an empty generated target, preserving canonical document/count/index/validator manifests.
- Restored ASGI paths pass fresh sign-in, old-session rejection, membership denial, idempotent message retry, Space access and newer-closure rejection. Fixture media integrity accepts the copied bytes and rejects corruption/missing bytes. It is not real Blob/R2 recovery.
- Actual checked-out source is pinned to the recorded PR head. Peer review narrowed cleanup claims to exercised sessions/closure: nonempty device/ticket cleanup and active nested Space/call state are NOT demonstrated. Network counter covers async HTTPX only, not all network clients; no live provider credentials are supplied.
- Fixture dump117ms/restore351ms/overall2874ms are not live RPO/RTO or online consistency guarantees. Archive bytes and media were never published.
- Evidence artifact 13352487284: https://github.com/leonartist7/KUKU/actions/runs/41887901603/artifacts/13352487284 . The checksum-only report is also persisted at docs/recovery/2026-11-04-synthetic-restore.json, so the evidence survives artifact expiry.
- Initial cloud attempts failed from MongoDB8/kernel incompatibility and an unavailable exact-version Docker tag. The compatible Ubuntu22.04 runner and observed image digest are pinned; no MongoDB safety check was bypassed.
- Release suite on the tested source a78c1d3 (run 41887901752) passes119 backend tests,110 frontend unit tests, TypeScript, web export and all three browser journeys. Android is intentionally skipped on this test-only branch; existing APK evidence remains unchanged.
- Application runtime and existing beta are unchanged; no API/frontend redeploy is required for this test-only package. Main, release branch, billing, access settings and live data were not changed.

## Known external gates
- Render service is currently free and healthCheckPath is unset in live configuration.
  Repo render.yaml already names /health/ready. Connected Render tools do not expose service-settings updates.
  Prepare a reviewable change; do not imply the live setting changed or upgrade billing automatically.
- LiveKit provider configuration and real media connectivity have not been verified.
- Android/FCM signing configuration and real recipient-device checks remain unverified.
- KUKU is not end-to-end encrypted.
- Current in-memory signaling/wakeup hubs require one API worker.
- No performance target is measured solely by passing unit tests.

## Work packages
Follow the IDs and dependencies in docs/MASTER_PLAN.md. Initial work spans R01/R03/D01/D03/M01/M02/S01/S02/S03/C01/C02.
Do not mark a full phase complete when a release gate is still outstanding.

## Continuation schedule
An enabled continuation task was created on 4 November 2026: every four hours for 42 passes (seven days), Europe/Paris, starting around 19:23 local time. It resumes this branch and ledger, performs one bounded implementation/verification checkpoint and does not create further schedules. Availability of a future execution environment is checked at run time; an enabled task is not evidence that a later pass has run.

## Active controller lease
Controller: root P06 report-only provider inventory.
Lease recorded at: 2026-11-05T18:27:03Z
Lease expires at: 2026-11-05T19:57:03Z
State: ACTIVE; two-pass inventory evidence only, with deletion and quota mutation prohibited.


## Verified implementation checkpoint
- Source 71b67c2a1e378a88e6982b2193f96ae49639e118: TypeScript, 65 frontend unit tests, web export and complete synthetic onboarding/chat/files/voice/emote/browser walkthrough pass. Backend suite: 88 tests pass against isolated MongoDB7.
- Run 41854212983: Spaces walkthrough reached private audio playback, host handoff, retry/reconnect, list and responsive screenshots; final creation assertion failed only from a duplicate retained-screen text locator. Fixed active-room scope is included in the next commit; whole walkthrough is not yet marked passed.
- Public baseline recorded in docs/performance/2026-11-04-before.json: readiness first sample61428ms, then84/97ms; login HTML6676ms, then167/167ms. These are direct HTTP samples, not Core Web Vitals.
- Vercel preview branch configuration now points to the existing API and explicitly disables calls. READY71b67c2 deployment dpl_8AcUqqAVe8vBQPEkqF88QkQBWWk8 is not the live beta alias; backend remains previous release until acceptance.
- Workspace transport briefly disconnected. Published source is safe on GitHub; pending owned files were preserved as Git blobs. Executor recovered; no dependency/toolchain installs were used locally.
- Incoming fourth checkpoint adds reduced-motion across sheets/viewers, colocates JSON proxy in Frankfurt with the API, verifies decoded photo drafts, and starts a standalone arm64 Android preview job after web/backend pass. APK signing is a PUBLIC TEST key with a separate .preview app ID; production signing/push/calls and physical-device checks remain open.
- M03/M04 chat tools are in coordinated isolated implementation; not merged or accepted yet.

## Web acceptance and native build checkpoint
- b0ece3e6119bcad3ea046d0dcb214fa43ea7e27f: backend and frontend jobs PASS in run 41857864668. This includes88 backend tests,74 frontend tests, canonical TypeScript, web export, complete onboarding/chat/files/voice/emote and Spaces browser walkthroughs, plus responsive screenshots.
- Vercel dpl_EUXNC6pLKSLBhkND3QeVUpv3dAg1 is READY in fra1. Existing public beta is still unchanged pending coordinated API-first rollout.
- Android job reached successful Expo native prebuild; the test helper then rejected Groovy single-quoted applicationId. This is fixed semantically with seven helper regression tests; no APK or device success is claimed yet. Failure diagnostics now preserve generated public configuration.
- The release branch disables automatic Vercel frontend deployment. This intentionally preserves the current alias until the matching Render API is LIVE and verified; the implementation branch still builds previews. Assign the existing beta alias manually after backend readiness. Do not accidentally deploy frontend ahead of API.
- M03/M04 source packages and tests are preserved as Git blobs, not integrated yet. Initial cached-shell restoration is being hardened with an explicit non-authoritative account constraint and server-proof gate.


## Chat tools and startup integration checkpoint
- Source 20d4cd79d1453c934b1a9f4b0e32fd99482d3c9f passes backend and frontend jobs in run 41861144619; Android native compilation is still in progress.
- Incoming package adds replies by message ID, bounded reactions, owner text edits with conflict review, text/emote tombstones, conversation search and shared pins. Durable revision hints refresh older loaded messages and remain silent for updates. Original send retries use keyed immutable fingerprints.
- Cached verified/onboarded profiles paint a shell before restore completes. Cached identity remains display-only: an expected-account API constraint rejects a different cookie account before adopting its token, and calls/realtime/outbox/notification setup wait for server proof. Validated sessions survive background refresh failures. Local agent evidence: 15 restoration/race cases and its 92-test frontend suite pass; integrated cloud TypeScript/browser evidence is still required.
- Push attempts now carry fenced leases. Deleted messages cannot be requeued or overwrite cancelled/replacement attempts. Nine isolated race cases pass locally; integrated backend verification is pending. Already submitted external notifications cannot be recalled.
- A separate synthetic chat-tools browser journey covers reply cancellation/send, reactions, edit conflicts, search/pin scope, older-message invalidations, removal/quote redaction, account/navigation races and 320/390/768px layouts.
- docs/BACKUP_RESTORE.md records Atlas control-plane observations and a safe synthetic rehearsal. There is no verified live backup/restore, media-byte recovery or physical erasure claim.
- Integrator verified unchanged server/chat_events/CallContext base blobs before overlay and spliced only the Message type additions into the newer API runtime. Original local worktrees may be stale; remote refs and the latest accepted commit remain authoritative.

## Next bounded work
1. Authenticated export, closure, operational cleanup and metadata-backed closed-account orphan retention are accepted. The next independently executable B01 package is a non-destructive, two-pass provider inventory/quarantine report for objects stranded before metadata insertion. It must remain report-only until owner attribution, retention policy and an explicit operator approval path are reviewable.
2. Keep authored shared-history policy, live database/media backup, live RPO/RTO, provider delivery, physical erasure, production signing and real-device checks as explicit external gates. Do not use personal content as fixtures.
3. Keep calls disabled. C03/A01 require configured LiveKit/FCM, production signing and representative physical phones; C04 video waits for the real audio gate.
4. Preserve one API worker until shared fan-out exists. R02 always-on compute and live health-check configuration require a provider/billing decision.

- Emote previews now have a visible loading poster and correct PNG/WebP failure recovery, including six component-handler tests. Browser screenshots wait for the selected preview to decode.
- Missing or removed reply originals preserve text and memo drafts; voice replies revalidate their captured target before queueing. A separate 404-original browser regression is included.

## Integrated cloud evidence and narrow recovery fixes
- Run 41863462822 on 642177430d915eb01551d5a54b2f9f663e88b940: all 119 backend tests against isolated MongoDB 7 pass; TypeScript, all 110 frontend unit tests and web export pass. Spaces browser journey passes.
- Two browser failures are addressed in this checkpoint: the old recipient fixture changed the server account while retaining another cached profile (correctly rejected by the new identity guard); it now explicitly sets up the recipient's matching saved profile. The missing-original assertion now accepts the actual retry suffix while still requiring retained text and zero send requests. Cancel reply and valid send clear stale guidance; the browser explicitly checks error dismissal and retained draft.
- The first standalone Android build (source 20d4cd79, run 41861144619) completed successfully in the cloud: arm64 preview identity/signature/non-debuggable/Hermes checks pass. Test artifact 13341935322, approximately 42 MB, expires 11 November. This is a test-signed preview, not physical-device or native-push acceptance. A newer APK will follow after the combined web gates pass.
- Workflow status summaries can lag behind completed logs/artifacts. Do not assume queued metadata means a job has not run: inspect step logs, terminal results and artifact provenance. Do not trigger duplicate runs to work around stale summaries.
- Local executor disconnected again. All source packages are committed remotely; review/deploy work continues through connected APIs and cloud builds.

## Verified beta rollout
- Accepted runtime source: d3366883fb0b2f8ae67236f4e17014447d923bb0. Run 41864811206 passes 119 backend tests, TypeScript, 110 frontend unit tests, web export and all three complete browser journeys. Browser artifact 13342290598 includes responsive chat-tools screenshots.
- Release review branch was fast-forwarded with an expected-SHA lease; main is unchanged. PR #2 was automatically marked merged into the review release branch.
- Render deploy dep-dbllk5m1egvs73autn6g is LIVE on that exact source, with application startup complete at 16:16:44Z. No paid plan or service-settings change was made.
- Credential-free cloud probe job 126701303450 in run 41866319345 passes: /health/live and /health/ready 200/ok; private account/chats 401/no-store; approved beta origin; public sign-in 200 and existing proxy 401/no-store. This is a bounded release check, not a keepalive schedule.
- Existing beta alias was reassigned to READY dpl_H7HjvPoZUGah3LYAVDDBMABSumvC (d3366883, fra1). Alias UID stayed the same; project protection and app authentication were preserved. A fresh post-switch probe is still required before the rollout is called fully verified.
- Draft PR #3 adds the cloud HTTP check because the local executor is unavailable. Its branch skips unnecessary Vercel preview builds; runtime remains the accepted source. Never publish a failed operations-branch preview as the beta.
- Latest Android preview for the accepted runtime is still compiling in run 41864811206; the earlier 20d4cd79 test-signed build passed. Do not claim physical Android or native notification acceptance.

## Next controller handoff
1. Fetch fresh implementation/release refs, PR #1, master plan and this ledger; preserve newer work and acquire a lease. Accepted runtime source is `d8004c44f0104b46d4067e49e242004216516c73`; PR #11 records the accepted P05 package; PR #1 against main remains draft.
2. P05 metadata-backed closed-account orphan retention is accepted and deployed with its live worker disabled. The earliest dependency-ready package is a report-only two-pass provider inventory/quarantine design for objects stranded before metadata insertion. Keep live deletion disabled and use synthetic provider inventory fixtures until owner attribution, retention policy and operator approval are explicit.
3. Live backup/media recovery, exact live FCV/PIT consistency, physical erasure, real provider/device acceptance, production signing and billing choices remain external gates.
4. Dependency changes must follow DEPENDENCY_REVIEW, cloud lockfile regeneration and Expo/web/native checks. Preserve CommonJS decoder compatibility.
5. N01/C03/A01 need real phones/provider/signing setup; calls stay false. C04 video depends on actual audio acceptance. R02 always-on hosting/live readiness settings need a billing/configuration decision.
6. Follow RELEASE_RUNBOOK for beta rollouts. The manual beta alias is authoritative; deploy API first when the frontend requires it. Do not redeploy for documentation only or create duplicate builds/keepalive schedules. Preserve main, protection, billing and live data.

## P02 private-media isolation implementation history
The client keeps only bounded thumbnails in memory after a server-proven session. Cache identity includes epoch, account, focus scope, attachment, size and format; full previews are flight-only. Session-boundary listeners clear memory synchronously, late matched responses are rejected, unrelated flights continue, and failed requests remain retryable. Files listens to durable chat changes and reloads after a coalesced revocation. Attachment deletion increments the message revision, marks sync repair state and publishes privacy-removal events to members; the existing repair path prevents a transient publication failure from stranding recipients. Synthetic unit/integration/browser fixtures cover account isolation, relogin, navigation, TTL/entry/byte bounds, deletion replay and request counts. No persistent preview storage or object URLs were added.
## B01 synthetic restore rehearsal implementation history
A cloud-only workflow now uses separate authenticated MongoDB 8 source/target services. The target restore identity is restricted to a generated fixture database. Actual app fixture accounts/messages/Spaces are archived with mongodump and restored using namespace remapping and stopOnError; document/index/validator manifests, media integrity negative controls, newer closure reconciliation, session revocation and restored ASGI authorization/idempotency checks must pass before evidence is accepted. No live database URI or provider credential is supplied. The fixture filesystem does not prove a Blob/R2 restore, FCV/PIT consistency, live recovery or full erasure. Runtime application code remains unchanged.

## P01 implementation history
The controlled harness retains HTTP caching and records checkout/tree provenance, static raw/gzip/Brotli-quality4 inventory, three fresh/repeat sign-in loads, cached-shell account-proof safety,100-message rendering and80-image lazy previews/navigation. Synthetic fixtures use no real providers/accounts. Font imports were narrowed only after baseline capture; all selected faces load. A chat virtualization attempt failed existing anchoring acceptance and was reverted. The authoritative checkpoint/report above records accepted results and limitations.

## P01 icon-assets implementation history
All 29 app/component imports use Ionicons. Replacing the broad barrel with the locked 15.1.1 documented default subpath preserves its exact component, font, glyph map and types. A reduced-motion fixture mock was updated to the direct default export after the first110-test run reported one mock error; all 110 then passed. Export/font-load guards prevent unused icon families returning unnoticed. A separate read-only review found no blocking compatibility issue. The authoritative checkpoint and committed report above distinguish export/browser/native/package evidence from real-device performance.
