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

Pending exact-source cloud TypeScript/export, browser journeys, backend suite and
Android test build. Root records the accepted SHA, run and deployment below after
those checks finish. Until then, the existing beta remains on its prior verified runtime.

## Limits and next gates

These checks do not establish real-user latency, physical Android notification volume,
Bluetooth/microphone routing, audible two-phone calls or multi-device Space drift.
Calls/native push remain off pending provider setup and actual device acceptance.
Live backup/media recovery, full erasure/shared-history policy and always-on hosting
remain open. Dependency remediation is still the next independent maintenance package;
no forced Expo migration is included. Main/production, access protection, DNS, billing,
live data/retention and schedules are unchanged.
