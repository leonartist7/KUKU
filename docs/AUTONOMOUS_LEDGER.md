# KUKU autonomous implementation ledger
Updated: 2026-11-27T19:22:40.408Z

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
Current controller: root, L01 clickable messages and quiet startup. Lease expires 2026-11-27T21:22:40.408Z.
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
| 5 Calls | SECURE AUDIO FOUNDATION + TWO-SIDED QUALITY DEPLOYED; OFF | Provider and audible two-device checks required; native/video incomplete |
| 6 Android/release | TEST APK + RECOVERY REHEARSAL + REPORT-ONLY PROVIDER INVENTORY VERIFIED; PRODUCTION GATED | Physical install/push/signing, live backup/media recovery and full erasure still open |


## Current authoritative checkpoint
This section supersedes historical pending statements below.
- D10 completes the user's ten-round debugging request. See docs/DEBUGGING_ROUNDS_2026-11-25.md for the round-by-round repairs, evidence and limits. No main/production, DNS/protection, billing, live retention or schedule change occurred.
- Tested source `70ed5ec457c5b23937dce7c163ccb4ecb7259b64` was merged through [PR #15](https://github.com/leonartist7/KUKU/pull/15) as review runtime `acb29b8bf999ee8950cd41fb31943ff2f893d49b`. Both point to tree `dbfcd28c8d7f29e0173168870abba84a97c3e45a`. The performance artifact records checkout `0dbd64313f59dd78ca65a5aa99de665d0b11c90f` with that same tree and PR head. Final documentation checkpoints do not change the running application code.
- Exact-source [run 45605352739](https://github.com/leonartist7/KUKU/actions/runs/45605352739) is SUCCESS. Backend job 139174691127 passes 163 isolated Mongo-backed cases; frontend job 139174690746 passes 167 unit/release cases, TypeScript, web export and complete onboarding/WAV/call-setup, Spaces, chat-tools and controlled-performance journeys. This adds 45 regression cases over the previous 150/135 baseline.
- Android job 139176519049 is SUCCESS, including standalone bundling, arm64/SDK36/Hermes and public test-signing provenance. [Artifact 15019095965](https://github.com/leonartist7/KUKU/actions/runs/45605352739/artifacts/15019095965) is 39,095,899 bytes; ZIP SHA256 `3b34fb3e92477b4730dfd292cb489afa956cd2d435accfb9f333f0096eed835c`. This is build/mock evidence, not physical installation, microphone routing, native push/calls or production-signing acceptance.
- Attachment privacy repair rejects attachment IDs on text/Space messages and accepts sharing proof only from active owner-authored media. Slow uploads recheck session, verification, membership and blocking after streaming/provider writes; newly generated R2 grants are withheld after access loss. Existing already-issued R2 grants retain their 60-second expiry. Synthetic revoked-write cleanup passes; provider deletion failures retain the existing orphan-recovery limitation.
- WAV parsing now checks exact container/chunk/padding/frame bounds. Preference writes/removal and failed-save rollback are serialized and focus/account scoped, including the independently reviewed stale-initial-read race. Chat coalesces overlapping reconciliation and offers deliberate latest-revision review before retrying removal. Private voice/file resources and delayed confirmations are bound to session/focus/attachment lifetime, with late web/native cleanup. Call cleanup continues after individual SDK failures, fences late playback to its element and clears stale setup diagnostics. Malformed successful API bodies fail retryably while session/error status is preserved.
- Render `dep-dc3cgku7bikc73cq6nkg` is LIVE on runtime `acb29b8`, finished 2026-11-25T11:38:00.553134Z. Direct health endpoints returned 200/ok; direct auth/me and calls/status returned 401/no-store with approved beta CORS. A bounded post-rollout error query returned zero app errors; this is not continuous monitoring or a latency percentile. One instance/worker, manual deploy, free plan and unset provider health-check path remain unchanged.
- API deployed first. Vercel `dpl_BqQ68z9nL58ScP7yPZv5UdMHgDVv` is READY on the matching runtime at https://kuku-cmksii40j-lionovart.vercel.app . The existing [beta alias](https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login) points to it; alias UID/access exception are preserved. Login, notifications and call-settings returned 200 with KUKU HTML and favicon v8 links; private proxy routes returned 401/no-store. Main remains unchanged; PR #1 remains draft.
- Browser artifact 15018230508 contains 51 synthetic screenshots plus performance/audit reports, ZIP SHA256 `c29da501980046ba9028e3452c32902c287f2d0048cf72e7697fbe11b2b33b3a`. Relevant 320/390px WAV/setup views and the failed-setup refresh view were visually inspected. The durable controlled report is docs/performance/2026-11-25-debugging-controlled.json: 44 rendered chat rows, five initial thumbnails, at most one thumbnail request per same scope, five Google font faces plus one icon font. These are fixture guardrails, not physical memory/CWV/latency claims.
- The runtime dependency inventory still reports 22 advisories (17 moderate, five high). Manifests/lockfile were not changed. Counts and advisory/fix metadata are persisted in docs/performance/2026-11-25-dependency-audit-summary.json. Reachability and compatible remediation remain unfinished; do not claim vulnerability-free status or run a forced framework downgrade/upgrade blindly.
- Redacted startup diagnostics at 2026-11-25T11:37:55.352783991Z still report calls disabled, missing provider URL/credentials and no provider connectivity test. Calls/native push stay off. LiveKit setup, physical two-phone audio/Android acceptance, native incoming calls/signing, E2EE and existing backup/erasure/always-on gates remain unverified. No real family messages/invitations, personal-content fixtures, live provider calls, retention approvals or data migration were used.
- Next bounded independent maintenance is compatible remediation/verification of the dependency inventory. Separately, missing server LiveKit configuration must precede a reviewed controlled two-phone audio test; no general call enablement follows from builds/mocks alone. All D10 path owners returned, independent review found no remaining blocker, and the controller lease is closed.

## N07/C08 historical checkpoint (superseded by D10)
Historical evidence below describes the previous runtime, not the current deployment.
- Beta: https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login . Notifications and Call setup are under You. Main remains unchanged; PR #1 against main remains draft.
- C08 tested source `886c1b37e5244c17d3af38eff4f7939e5e64841d` was merged through [PR #14](https://github.com/leonartist7/KUKU/pull/14) as review runtime `d26103a6d706d3dfbc1e946484f66cc7e342981f`. Both commits have exact tree `5c3e54ef5353d887a8efa57b0beefe4c93c1af6e`.
- Exact-source [run 45485420851](https://github.com/leonartist7/KUKU/actions/runs/45485420851) PASS: backend job 138769380869 has 150 isolated Mongo-backed tests; frontend job 138769381399 has 135/135 unit/release tests, TypeScript, web export and complete onboarding/WAV/call-setup, Spaces, chat-tools and controlled-performance browser journeys. The call setup browser journey uses fake media devices and checks 320/390/768px layouts; it is not two-phone audio evidence.
- Android job 138771531746 PASS, including arm64/SDK 36/Hermes/public-test-signing provenance. Artifact [14964383753](https://github.com/leonartist7/KUKU/actions/runs/45485420851/artifacts/14964383753) is 39,090,071 bytes; ZIP SHA256 `0805ee10bad14a54faf209c572a78c4b4915fd6e899f62dcc8913ca80324670b`. It does not establish physical install, microphone routing, push, production signing or native calling acceptance.
- C08 rejects insecure or malformed LiveKit endpoints on both server and client, including embedded credentials, non-root paths, query/fragment, numeric/hex/localhost host forms and empty ports. Verified-only `/api/calls/status` and one startup log return configuration booleans/reason codes only. Provider URLs, keys, secrets, tokens and user/call content are not serialized there. Invalid removal configuration preserves durable pending revocation instead of claiming completion.
- Audio uses the pinned LiveKit client's mono 24 kbps speech preset, DTX/RED and requested echo cancellation/noise suppression/automatic gain control. Call UI distinguishes local and expected remote signal quality, remote mute, subscription failure and autoplay. Lost quality suspends media-ready; reconnect/disconnect/disposal clear stale feedback/audio. App-owned errors and controlled permission/HTTP guidance replace raw SDK error text. Independent review blockers for endpoint-policy parity and error leakage were fixed and retested.
- You → Calls now shows honest setup status and a deliberate microphone-access check that immediately releases every acquired track, including a late permission grant after leaving the screen. It neither records/sends audio nor places a call. Readiness and diagnostics cannot claim audible connectivity.
- Render deploy `dep-dc2vkp2vcj2c73aini70` is LIVE on `d26103a6d706d3dfbc1e946484f66cc7e342981f`, finished 2026-11-24T20:59:24.210435Z. Direct `/health/live` and `/health/ready` returned 200/ok. `/api/auth/me` and the new `/api/calls/status` returned unauthenticated 401/no-store; the approved beta CORS origin was preserved. These are bounded release probes, not a keepalive or latency percentile claim.
- The actual startup readiness log at 2026-11-24T20:59:18.130310916Z reports `calls_enabled=false`, `provider_configured=false`, `secure_transport=false`, with reasons `calls_disabled`, `provider_url_missing`, `provider_credentials_missing`. LiveKit URL/API key/API secret are not configured. No secret values were inspected. No provider connection or real call was attempted.
- API deployed first. Only after it was LIVE did implementation preview build from the accepted runtime. Vercel `dpl_Fgng4tQBTtjPZvbxRtSEgi5YiMGB` is READY at https://kuku-a0mvnka12-lionovart.vercel.app . The existing beta alias points to it; `/login` and `/call-settings` returned 200 with new favicon assets; the beta proxy `/api/calls/status` returned 401/no-store. Alias UID/access exception are preserved. No production promotion, DNS/protection or billing change occurred.
- N07 notification source `6e7b4ab9ba25b83e2fef8dce53dbd88e09995810` was accepted through [PR #13](https://github.com/leonartist7/KUKU/pull/13), merge `1834c601bf06527701d6271c35bdabd9a5d3b72e`. [Run 45483142402](https://github.com/leonartist7/KUKU/actions/runs/45483142402) passes 145 backend and 123 frontend tests, TypeScript/export/browser checks and Android. Its test APK artifact 14962219592 is 39,077,311 bytes; ZIP SHA256 `2c39fb993c32055b62bde40464427b0ddf702dc81ecd89f07a2d710f14e06509`.
- N07 adds local per-account WAV import/replacement/removal, actual RIFF/chunk validation, 1 MiB/five-second bounds, normalized metadata-free PCM re-encoding, seven audible presets plus Silent and Maximum volume. Quiet sounds are boosted with headroom and pending playback is cancelled on focus/session teardown. New vector-derived SVG/ICO/PNG favicon, larger notification icon and white-alpha badge are wired for web and the Android plugin; public service-worker cache version is 8. Notification diagnostics now wait for restored-account proof. Imported sounds are foreground web only; Android/Chrome controls background/lock-screen sound and volume.
- Native push/calls remain off. Installed Android calling is not implemented; first physical audio acceptance uses Android Chrome. Standard encrypted transport is required, but E2EE is not configured. The single API worker, manual Render deploy, free plan and unset provider health-check path remain unchanged. No real family messages, invitations, live audio, personal-content fixture reads, provider probes, migrations or retention approvals were initiated.
- Next operational input is server-side LiveKit project configuration through Render, followed by a reviewed controlled two-phone audio test. Do not enable general-beta calls merely because mocks/builds pass. Native FCM/signing, physical phones, live backup/media recovery, shared-history erasure policy and always-on hosting remain external gates. See docs/NOTIFICATION_SOUNDS.md and docs/CALL_READINESS.md.

## P06/P05 historical checkpoint (superseded)
- P06 accepted source `a20bdf7354c8c93eea9ee98de2ea2de3eabeb5bb`. [PR #12](https://github.com/leonartist7/KUKU/pull/12) was squash-merged into the review release branch as runtime tree-equivalent commit `bd1f9490bdd30779128975051e2f7363cc4a9c96`; both commits point to tree `33cb1928d4c4b312c29270c2dbd4e5aeda9d6de2`. Main is unchanged.
- The provider-only object inventory is an explicit offline operator command, not an API route or lifecycle task. It accepts only `attachments/` and `space-audio/`, requires explicit database settings and required metadata collections, and treats any exact metadata key as present regardless of a missing or malformed provider field. Invalid entries, provider/database errors, repeated cursors and page/object budgets make a pass incomplete.
- Reports contain HMAC digests, coarse age buckets and bounded counts only; raw keys, URLs, ETags, cursors and error messages remain out of the report. A comparison requires the same provider, HMAC key, schema, minimum age and prefixes plus two complete observations at least 24 hours apart. Confirmation does not attribute ownership or authorize deletion, quota work, retention jobs or a physical-erasure claim.
- Exact-head [release run 42087043112](https://github.com/leonartist7/KUKU/actions/runs/42087043112) PASS: backend job 127457520428 has 145 isolated Mongo-backed tests; frontend job 127457516824 has 116/116 unit/release tests, TypeScript, web export, onboarding, Spaces, chat-tools and controlled-performance journeys. The first onboarding attempt timed out waiting for the unchanged synthetic scroll-anchor button; the exact-head failed-job rerun passed it and every remaining gate without a source change.
- Android job 127459639282 passed standalone arm64/SDK 36/Hermes/public-test-signing provenance. Artifact [13444183381](https://github.com/leonartist7/KUKU/actions/runs/42087043112/artifacts/13444183381) is 39,063,557 bytes with ZIP SHA256 `68265d91c53642b5245b9c15a717a28993166dffa9b4ff3e5b49483ef060ed29`. This is not physical Android, microphone/background/push or production-signing acceptance.
- Exact-source Vercel implementation deployment `dpl_62nM8jYfrE6YwFEN4SZmbcnZ9b76` is READY at `https://kuku-ohe0g90sz-lionovart.vercel.app`; authenticated provider fetch of `/login` returned expected KUKU HTML with HTTP 200. The feature-only deployment failed closed because that branch has no backend URL, while the implementation deployment used the review configuration.
- Render deploy `dep-dbmd750m7kps73fnr740` is LIVE on accepted release source `bd1f9490bdd30779128975051e2f7363cc4a9c96`. The replacement instance completed application startup at 2026-11-05T19:07:04.187072419Z before the previous instance shut down at 19:07:09.086433475Z. The service remains one API worker, manual deploy, free plan and without a configured Render health-check path.
- The existing beta `/login` returned expected KUKU HTML with HTTP 200 after rollout. The frontend source and beta alias did not change. No live provider inventory was run; no provider object, live database row, quota, retention job, account, billing, DNS, access protection or personal message/invitation changed.
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
An enabled continuation task was created on 4 November 2026: every four hours for 42 passes (seven days), Europe/Paris, starting around 19:23 local time. It was disabled after P06 reached external gates; the November 24 work was explicitly requested and did not re-enable or create a schedule. It resumes this branch and ledger, performs one bounded implementation/verification checkpoint and does not create further schedules. Availability of a future execution environment is checked at run time; an enabled task is not evidence that a later pass has run.

## Active controller lease
Controller: root/L01.
Lease acquired: 2026-11-27T19:22:40.408Z
Lease expires: 2026-11-27T21:22:40.408Z
State: ACTIVE; message links/actions and calm startup. One controller integrates and deploys.


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
1. Live startup confirms missing `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. The next step requires the user's LiveKit project settings saved server-side in Render, with calls still off. Recheck redacted readiness after setup, then prepare a separately reviewed controlled two-phone test; do not send/answer real calls as synthetic fixtures.
2. Real audio acceptance must cover two phones/different networks, permission denial, speaker/headphones/Bluetooth, mute, Wi-Fi↔cellular, reconnect, either person ending, tab/account ownership and a 20–30-minute session without leaked capture. Calls remain web-only until the native SDK/incoming-call path is implemented and physically checked. E2EE needs a separate key-management design.
3. Native FCM/production signing and real background notification delivery, live database/media recovery, physical erasure/shared-history policy, provider-inventory credentials/cost/report storage and always-on hosting remain external gates. Keep retention and native push disabled and preserve one API worker.
4. No further independent scope expansion or schedules are needed while these external inputs are unchanged.

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
1. Fetch actual branch heads and current provider/CI state; honor any fresh unexpired controller lease. D10's accepted runtime and all exact evidence are in the current checkpoint above.
2. Next independent maintenance: evaluate the recorded dependency advisories, choose SDK-compatible patched versions/overrides from official sources, and verify web/Android compatibility before publishing. No blind force upgrade, new paid service or framework rewrite.
3. Calls remain disabled with missing LiveKit server configuration. After setup, prepare controlled real two-phone audio acceptance; builds/mocks and setup booleans do not establish audible media. Native/video, FCM/signing, physical notification/Space checks, live backup/media recovery and erasure policy retain their gates.
4. Follow RELEASE_RUNBOOK for any compatible API-first beta update. Keep one worker. Do not redeploy the API for documentation alone, merge main, alter DNS/protection/billing, run live erasure or create more schedules.

## P02 private-media isolation implementation history
The client keeps only bounded thumbnails in memory after a server-proven session. Cache identity includes epoch, account, focus scope, attachment, size and format; full previews are flight-only. Session-boundary listeners clear memory synchronously, late matched responses are rejected, unrelated flights continue, and failed requests remain retryable. Files listens to durable chat changes and reloads after a coalesced revocation. Attachment deletion increments the message revision, marks sync repair state and publishes privacy-removal events to members; the existing repair path prevents a transient publication failure from stranding recipients. Synthetic unit/integration/browser fixtures cover account isolation, relogin, navigation, TTL/entry/byte bounds, deletion replay and request counts. No persistent preview storage or object URLs were added.
## B01 synthetic restore rehearsal implementation history
A cloud-only workflow now uses separate authenticated MongoDB 8 source/target services. The target restore identity is restricted to a generated fixture database. Actual app fixture accounts/messages/Spaces are archived with mongodump and restored using namespace remapping and stopOnError; document/index/validator manifests, media integrity negative controls, newer closure reconciliation, session revocation and restored ASGI authorization/idempotency checks must pass before evidence is accepted. No live database URI or provider credential is supplied. The fixture filesystem does not prove a Blob/R2 restore, FCV/PIT consistency, live recovery or full erasure. Runtime application code remains unchanged.

## P01 implementation history
The controlled harness retains HTTP caching and records checkout/tree provenance, static raw/gzip/Brotli-quality4 inventory, three fresh/repeat sign-in loads, cached-shell account-proof safety,100-message rendering and80-image lazy previews/navigation. Synthetic fixtures use no real providers/accounts. Font imports were narrowed only after baseline capture; all selected faces load. A chat virtualization attempt failed existing anchoring acceptance and was reverted. The authoritative checkpoint/report above records accepted results and limitations.

## P01 icon-assets implementation history
All 29 app/component imports use Ionicons. Replacing the broad barrel with the locked 15.1.1 documented default subpath preserves its exact component, font, glyph map and types. A reduced-motion fixture mock was updated to the direct default export after the first110-test run reported one mock error; all 110 then passed. Export/font-load guards prevent unused icon families returning unnoticed. A separate read-only review found no blocking compatibility issue. The authoritative checkpoint and committed report above distinguish export/browser/native/package evidence from real-device performance.
