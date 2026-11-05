# Account data and closure — beta release notes

## Implemented behavior

The account screen is available at /account from You → Account & data.

### Personal data snapshot

GET /api/account/export accepts one of these sections:

| Section | Scope and contents |
|---|---|
| profile | Current person's own profile, email and onboarding state |
| messages | Messages authored by the current person; no other person's message bodies |
| attachments | Owned upload metadata; no private storage keys or provider URLs |
| audio_uploads | Owned Space audio metadata; no embedded audio bytes or provider URLs |
| spaces | Names and basic metadata for Spaces the current person belongs to; no member directory |
| space_messages | Room messages authored by the current person |
| calls | Call status, dates and duration for calls the current person belongs to; no other member profile |

Pages contain at most 100 records. Cursors are signed, expire after an hour and bind the account,
section and last item ID. Every page enforces active verified authentication and ownership or
membership before pagination. Responses do not export session/ticket credentials or password hashes.

The app follows pages and creates real JSON. Web downloads use a temporary object URL that is
revoked after the download starts. Android/iOS use the existing native text share sheet for exports
up to 200 KiB; larger exports instruct the person to use the browser download. No new sharing
dependency was installed.

The beta client stops at 5,000 records or 4 MiB of source JSON. Larger accounts need a separately
prepared complete export. Original photo/audio/file bytes must be downloaded through their
authorized conversation or Space; they are not included in the JSON. Device-local preferences are
not exported. Export pages are a best-effort live snapshot, not a database transaction: avoid
changing content during a large export if a consistent snapshot is needed.

### Account closure and deletion request

POST /api/account/close requires:

- Active verified authentication and an allowed origin for browser/cookie requests.
- The current password, verified on a worker thread.
- Exact confirmation text DELETE, plus an explicit account-screen action.
- No target account ID: the authenticated person's account is the only possible target.

On successful closure the API:

1. Creates an idempotent account_deletions entry in closure_pending state.
2. Atomically sets the user disabled and records closed_at/deletion_status.
3. Clears the public profile photo/bio and changes the public profile name to Former member.
4. Advances the deletion request to awaiting_operator_cleanup.
5. Revokes all persisted account sessions and removes push devices and file/WebSocket tickets.
6. Expires unused invitations created by the account.
7. Makes bounded best-effort attempts to close tracked sockets.
8. Removes the browser refresh cookie.

The operational portion is now restart-safe. Startup and the closure request both run a bounded,
expiring compare-and-set lease for accounts that are already confirmed disabled. It idempotently
revokes sessions, devices, notification registrations, short-lived tickets and recovery codes;
expires unused invitations; ends active call records and releases their participant leases; and
removes the closed person's Space presence before repairing host/session state. A crashed lease is
eligible for retry. Concurrent workers cannot both own the same cleanup attempt.

Requests whose user is active or missing are marked blocked without deleting anything. This is the
fail-closed boundary that prevents a stranded `closure_pending` record from disabling or cleaning
an active account. Other accounts' grants and presence are preserved by synthetic isolation tests.

Retention policy version 2 applies zero retention to ephemeral access grants after closure. Shared
messages, upload metadata/provider objects, the disabled user record and the closure tombstone are
retained for the still-gated operator erasure policy. Completion therefore records
`retention_state=physical_erasure_pending` and keeps `physical_erasure_completed=false`.

### Provider-object retention worker (implemented, gated off)

KUKU now has a second restart-safe stage for metadata-backed objects that are proven unreferenced
and owned by an independently confirmed disabled account. It is intentionally disabled by default
with `STORAGE_RETENTION_ENABLED=false`, and an account is ineligible until an operator records
`retention_object_cleanup_approved_at`. Deploying this code does not approve a real account or
delete any live object.

Approval must remain recorded for at least five minutes after operational session cleanup before
an account becomes eligible. Provider calls run in a separate optional maintenance task and are
awaited to termination so a timed-out worker thread cannot overlap a retry. Scans have supporting
indexes and a separate per-pass row budget so referenced libraries cannot delay ordinary lifecycle
maintenance.

The bounded worker scans attachments and private Space audio with resumable cursors. Immediately
before provider deletion it rechecks chat messages, current Spaces and historical Space sessions.
It reserves the source metadata while deleting, and message/Space writes perform a final source
check so a late reference is rejected or rolled back before it becomes visible. Any established
reference preserves the object. Each deletion has its own expiring lease and durable tombstone;
provider success is recorded before quota work so a restart can converge without repeating later
steps. User and global quota counters use the same job ID as an atomic per-document release fence,
and a mismatch stops for operator review instead of making a counter negative.

Operator status records counts, bytes and exception classes only. Provider keys and provider error
messages are not copied into account-deletion status. Completed object tombstones remove the key.
Shared media, authored history, the disabled user/tombstone and backups remain outside this stage,
and `physical_erasure_completed` remains false.

The disabled-account check is the primary access boundary, including if later cleanup is
interrupted. Session-bound APIs and downloads reject the closed identity. Call records and
participant leases are ended immediately, but provider removal remains `revocation_pending` when
a token was issued and still depends on configured LiveKit processing; this is not a claim that
third-party media stops synchronously at the exact database write.

The frontend clears the closed account's local token, cached profile, outbox and browser-push
identity through AuthContext.finishClosedAccount(uid). This path does not falsely attempt a
second server logout with an already-disabled session.

## Explicit limitations and remaining gates

This is **account closure plus a recorded deletion request**, not completed physical data erasure.
The interface and API both say so. The beta has no self-service account reopening.

The following remain until an operator completes a verified cleanup:

- The disabled user record can retain the email, password hash and operational identifiers.
- Previously shared messages, including their stored sender_name values, can remain in history.
- Private upload objects and their metadata can remain available to already-authorized participants.
- Backup copies may retain previous account data.
- A blocked request is retried only as operational cleanup after the user is independently confirmed
  disabled; the reconciler never disables an active user from the request record alone.

Other participants' accounts, messages and uploads are not deleted by the closure endpoint. This
package does not claim legal compliance, provider erasure, backup restoration or physical-device
acceptance.

## Operator cleanup implementation requirements

Do not run cleanup automatically against real accounts merely to test it. A future worker needs:

- A documented policy for authored shared history and historical names.
- Private object deletion through the exact stored storage provider, with retries and proof of
  deletion before releasing quota. Never delete another account's object or decrement quota twice.
- Provider-only objects stranded before metadata insertion and account-scoped durable events under
  the agreed retention policy.
- Verified provider-side call/media removal for issued tokens; the database revocation request is
  durable, but real LiveKit completion still needs configured-provider evidence.
- A minimal tombstone retained according to policy so backup restores cannot silently reactivate
  closed accounts or bring back erased content.
- Progress/error visibility for the operator, plus a way to confirm completion to the requester.
- A verified backup/restore exercise that reapplies closure/erasure records before reopening access.

Until those gates pass, keep physical_erasure_completed false. Do not convert queued/recorded
requests into a “data deleted” badge.

The implemented retention worker covers only database-metadata-backed closed-account orphans.
Provider-only bytes stranded before metadata insertion now have a separate manual, report-only
two-pass inventory design (docs/PROVIDER_INVENTORY.md). It emits keyed digests and bounded counts,
never raw provider identifiers. Two unchanged observations at least 24 hours apart are quarantine
evidence only: they do not identify an owner or authorize deletion. No live inventory was run and
the retention worker must never consume this report automatically.

## Verification

- frontend/tests/account-privacy.unit.cjs: eight local pure tests passed using existing dependencies.
  They cover account switching, bounded/cursor-safe collection, UTF-8 byte limits, real web JSON
  download and object-URL cleanup, actual native JSON sharing/cancellation, oversized shares and
  cancellation that stops pagination without a late download.
- backend/tests/test_account_privacy.py: six synthetic integration tests authored for export scope,
  pagination, secrets/provider URL exclusion, account/section/expiry cursor isolation, verified
  sessions, password/confirmation/origin checks, device/session revocation and honest pending
  erasure. Local collection was blocked by the pre-existing environment missing PIL; cloud CI
  with requirements-dev.txt must supply the execution result.
- A real browser/native account-screen walkthrough, LiveKit revocation timing and physical
  backup/erasure evidence are not established by those tests.
- backend/tests/test_storage_retention.py uses provider doubles to cover referenced-media
  preservation, current and historical Space references, other-account isolation, restart after
  provider deletion, exactly-once quota release, concurrent claims and active-account blocking.

No live user data was exported, closed or erased while implementing this package.

