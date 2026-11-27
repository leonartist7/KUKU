# KUKU: fifty usefulness and debugging simulations

This checkpoint executes 50 numbered synthetic scenarios, not fifty physical sessions
or fifty separate production bugs. Each scenario maps to executable regression evidence.
No personal messages, files, invitations, notifications or live call media were used.

| Scenarios | User need | Detailed results |
|---|---|---|
| C01–C10 | Useful chat actions, links and search | [Chat](F50_CHAT.md) |
| M01–M10 | Safe photo, voice, file and sound handling | [Media](F50_MEDIA.md) |
| S01–S10 | Coherent shared audio and honest call setup | [Spaces/calls](F50_SPACES_CALLS.md) |
| B01–B10 | Retry-safe safety actions and account revocation | [Backend](F50_BACKEND.md) |
| R01–R10 | Durable messages, cancellation and recovery | [Queue/recovery](F50_RECOVERY.md) |

The repairs stop cancelled queued messages from escaping an old snapshot; isolate
failing queue listeners; require review before retrying a conflicted edit/removal;
stop repeated search pages and preserve newest revisions; fence photo downloads,
delete confirmations and modal state to their originating session/viewer; fence late
Space playback, honor a host pause and continue cleanup after individual failures;
keep provider errors private; report incomplete call setup honestly; and recheck the
active verified session before safety mutations/private results. Existing API shapes,
single-worker deployment, call/native-push flags and retention policy are preserved.

## Local acceptance before cloud integration

- Full frontend unit/release suite: **214 passed, zero failed**.
- New cases: **34 frontend and 10 backend**. Some of the 50 scenarios deliberately
  re-exercise existing safeguards rather than invent a new test or code change.
- Media and SpaceAudio differential simulations fail on their original source and
  pass on the repaired source, except the existing stale-private-audio guard which
  already passed. No original application file was temporarily swapped.
- Backend syntax compilation and CRLF-aware diff check pass. Full isolated
  Mongo-backed execution remains required in cloud CI before acceptance.
- No full local app dependency installation; a standalone pinned TypeScript compiler
  was used. No framework/lockfile change. Existing dependency advisories remain open.

## Integration status

- Tested source `de47d222828276f594c19b2916e533b23ba60670`, merged through
  [PR #17](https://github.com/leonartist7/KUKU/pull/17) as compatible runtime
  `629604da6e8749d962bd7632bb8ccd6b9fc93069`. Both share exact tree
  `28cc97c441417f19bfd6bd201fdf370eacdcecee`.
- [Cloud run 46081363109](https://github.com/leonartist7/KUKU/actions/runs/46081363109):
  frontend job140780846838 passes **214 tests**, TypeScript, web export and complete
  onboarding/WAV/call-setup, Spaces, chat-tools and controlled-performance browser
  journeys. Backend job140780846584 is **SUCCESS**, including the new safety suite.
  The runtime-tree [release run46081789229](https://github.com/leonartist7/KUKU/actions/runs/46081789229)
  also succeeds; backend job140782205346 explicitly reports **173 passed**, and
  frontend job140782205069 passes. Android is correctly skipped on the release branch.
  Runtime-tree Beta HTTP probes46081789195 and synthetic restore rehearsal46081789206
  also pass. Across backend/frontend this is **387 cases**,44 more than the prior release.
- Android standalone test build: **SUCCESS**, job140781893341; BUILD SUCCESSFUL in11m38s. Arm64/SDK36/Hermes,
  standalone bundling and public debug TEST signature/provenance checks pass.
  [Artifact15237069572](https://github.com/leonartist7/KUKU/actions/runs/46081363109/artifacts/15237069572),
  39,141,143 bytes, ZIP SHA256 `b3c5398106bbd8d68b84d97b97c68f136a38183456d89af8a9db9c8d6f5556a4`.
  This is compilation/provenance/mock evidence, not physical installation, OS
  notification, microphone, real calling or production-signing acceptance.
- [Browser artifact15236504190](https://github.com/leonartist7/KUKU/actions/runs/46081363109/artifacts/15236504190):
  2,484,428 bytes,56 screenshots/reports, ZIP SHA256
  `a2c83294dc0bfa8da097fcf0c0505795b8848824306fe66a92a6149ff53d5cff`.
  The390px conflict/review view was visually inspected. This is fixture evidence.
- Durable controlled report: `docs/performance/2026-11-28-fifty-controlled.json`.
  Checkout47da1b43a2f42e2856734b973ab151320edebd68 records the exact shared tree and
  source SHA.39 chat rows mounted,5 initial thumbnails, maximum1 thumbnail request
  per same scope,2 full-preview requests on reopen. Five Google font faces and one
  Ionicons font remain. JavaScript raw3,255,838 / gzip804,644 bytes; no performance
  speedup or real-user percentile is claimed from these three synthetic samples.
- Render deploy `dep-dc50vomi0phs73bvh4c0` is **LIVE** on runtime629604d, finished
  2026-11-27T23:20:07.332454Z. Health/live and ready returned200/ok; private auth/me
  and calls/status returned401/no-store with existing beta CORS. Bounded post-rollout
  app-error query returned zero; this is not continuous monitoring. One worker,
  manual deploy, free plan and provider health-check configuration are unchanged.
- Only after the API was live was the implementation ref advanced. Vercel
  `dpl_3xnfPb9rihJUuqpRDCEFKVgrYDnG` is **READY** on runtime629604d at
  https://kuku-kudvpcc0d-lionovart.vercel.app . The
  [existing beta](https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login)
  points to it. Alias UID/access exception were preserved. Deployed login, notifications and call-settings returned200 KUKU HTML using entry
  `05092814d028899f7dc8313451d149b8`; favicon v8 returned200, and private proxy
  auth/me and calls/status returned401/no-store.
- Source/domain differential evidence additionally confirms four queue failures
  before repair and all ten queue scenarios after repair. Independent review found
  no blocker and checked exactly50 unique numbered scenario rows.
- Rollback: prior frontend448dc4dcf54e6ed721851f45789835fdbbb1265d on
  dpl_2efvy9D7C3SqE5mHV8emkyFdwg8r with prior APIacb29b8bf999ee8950cd41fb31943ff2f893d49b
  /dep-dc3cgku7bikc73cq6nkg. No schema/contract migration occurred; this API remains
  compatible with the prior frontend. Prefer retaining the repaired API when reverting only the frontend. Restore through the existing review-only
  procedure; do not promote production or alter protection.

## Limits and next gates

These checks do not establish real-user latency, physical Android notification volume,
Bluetooth/microphone routing, audible two-phone calls or multi-device Space drift.
Calls/native push remain off pending provider setup and actual device acceptance.
Live backup/media recovery, full erasure/shared-history policy and always-on hosting
remain open. Dependency remediation is still the next independent maintenance package;
the fresh audit still reports22 advisories (17 moderate/five high). No forced Expo migration is included. Main/production, access protection, DNS, billing,
live data/retention and schedules are unchanged.
