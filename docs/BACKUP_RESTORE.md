# KUKU backup and restore readiness
Reviewed: 4 November 2026 • source checkpoint: 20d4cd79

## Observed status

Only Atlas control-plane metadata was inspected. No application records, connection credentials,
backup contents or live messages were queried.

| Item | Observed result |
|---|---|
| Atlas project | Project 0 — 6ae29e38ee78792725a0912a |
| Cluster | kuku |
| Tier | FREE; inspect_cluster reports instanceSize=N/A |
| MongoDB | 8.0.36 |
| Location | AWS EU_CENTRAL_1 |
| Control-plane state | IDLE; not paused |
| Backup API visibility | Cluster inspection returns no backup/pitEnabled fields; connected tools expose no snapshot or restore-job listing |
| Application linkage | Name matches KUKU; deployment MONGO_URL/DB_NAME was not retrieved or compared |
| Backup/restore evidence | No archive, snapshot inventory, completed restore or measured recovery time verified |

Official Atlas documentation says managed backups are unavailable for Free/M0 clusters. Logical
mongodump/mongorestore backups are an alternative. This conclusion follows the observed FREE tier
and current provider documentation; it is not an observed backupEnabled=false field.

External/manual backups may exist, but their existence, encryption, retention and recoverability
remain unverified. No backup, restore, cluster upgrade or billing change was performed.

## Recovery scope

A useful KUKU recovery needs all of these:

1. Database documents, collection options and indexes.
2. Private image/file/voice/Space-audio object bytes, plus the metadata linking them.
3. Deployable source and protected configuration/signing material managed separately.
4. Current account-closure/erasure records so an old backup cannot reactivate a closed account.

A database dump does not copy Vercel Blob/R2 objects. Derived previews can be regenerated.
An export from Account & data is not an operator backup: it intentionally excludes other users,
credentials, original media and some operational records.

## First rehearsal: synthetic data, isolated cloud target

Run this before any live-data exercise. It can use an existing authorized cloud CI runner with
temporary MongoDB services; it requires no local database/toolchain installation.

**Isolation contract:** the job has no production connection string, Blob token, email/push key or
LiveKit credentials. Use two dedicated fixture services, or an equivalently isolated source/target.
The target credential must be restricted to the rehearsal namespace. Verify the target is empty,
its host is the approved fixture host, and its database begins kuku_restore_rehearsal_ before
running restore. Namespace renaming alone is not adequate isolation.

1. Record runner/image/Database Tools versions. Match MongoDB 8.0 and verified FCV compatibility;
   the live FCV was not exposed by the metadata tool.
2. Seed only synthetic users, chat/membership records, messages, idempotency keys, attachment/audio
   metadata, a Space and an account-closure tombstone. Put tiny known-byte media fixtures in an
   isolated test store/provider double.
3. Record canonical fixture counts, relationships, index definitions and media SHA-256 values.
4. Create a logical archive and restore it into the fresh target. These commands are templates
   for that isolated rehearsal, not commands run against Atlas:

```sh
mongodump --config=/run/secrets/fixture-source.yml \
  --db=kuku_restore_source_fixture \
  --archive=/private/kuku-fixture.archive.gz --gzip

mongorestore --config=/run/secrets/fixture-target.yml \
  --archive=/private/kuku-fixture.archive.gz --gzip \
  --nsInclude='kuku_restore_source_fixture.*' \
  --nsFrom='kuku_restore_source_fixture.*' \
  --nsTo='kuku_restore_rehearsal_RUN_ID.*' \
  --stopOnError
```

Replace RUN_ID with the job's unique identifier. Configuration files hold any URI/password,
have runner-only permissions, are never printed and are removed with the ephemeral job.
Do not add --drop, restore over an existing target, or restore admin/config databases.

5. Check restored counts, indexes, referential consistency and fixture media hashes. Start the
   API against only the target and isolated storage. Verify synthetic sign-in, membership denial,
   idempotent send, file authorization, Space state and disabled-account rejection.
6. Prove the restored app cannot emit real email/push/calls. Reconcile closure tombstones before
   allowing restored users access; reset ephemeral sessions/tickets/presence/call leases in the
   isolated target according to the recovery policy.
7. Record tool exit codes, timings, checksum-only evidence and failed checks. Do not upload raw
   personal backups, passwords or plaintext archives as ordinary GitHub artifacts.

This proves the tooling and application recovery path with fixtures. It does not prove recovery
of the live cluster or of real stored media.

## Synthetic rehearsal completed — 4 November 2026

The isolated cloud rehearsal passes at source a78c1d399c0b4157507c2d57f521da0a277e2dea.
[Verification run](https://github.com/leonartist7/KUKU/actions/runs/41887901603);
[checksum-only evidence](https://github.com/leonartist7/KUKU/actions/runs/41887901603/artifacts/13352487284).

- Separate authenticated MongoDB services, both version 8.0.34; Database Tools 100.20.0.
  This is not an exact-version/FCV test of the observed live Atlas 8.0.36 cluster.
- A target identity restricted to its generated database is denied an attempted write to another
  fixture namespace. Restore refuses a nonempty target and uses no --drop.
- Actual app-created synthetic users, a chat, message and Space survive archive restoration.
  Canonical documents/counts, indexes and collection validators match.
- A separate fixture filesystem validates media hashes and rejects missing/corrupt bytes.
  This is a provider double, not Blob/R2 object recovery or a durable media backup.
- A closure recorded after the archive wins over the restored older active account.
  Old sessions are revoked. The actual restored ASGI app passes fresh sign-in,
  membership denial, idempotent-send retry, Space access and closed-account rejection.
- No intercepted asynchronous HTTPX provider request occurred. Other network clients are not instrumented; no live provider credentials are supplied. Raw archives, media, credentials and account records
  were not uploaded; the retained evidence contains versions, counts, checksums and timings only.

Observed fixture timings: dump 117 ms, restore 351 ms, overall 2874 ms.
These tiny, quiescent fixture measurements are not live RPO/RTO or online consistency guarantees.
The test does not start the app lifespan/server process, test real signed media streaming,
exercise active-call/presence recovery or prove nonempty device/ticket cleanup.

Workflow: .github/workflows/restore-rehearsal.yml. Script: backend/scripts/restore_rehearsal.py.
It runs only with explicit synthetic cloud guards and literal loopback endpoints; do not adapt it
by adding live URIs or secrets. MongoDB8 rejected the initial runner kernel, so this job uses
Ubuntu22.04/kernel6.8 and the observed available Mongo image pinned by digest. Revisit compatibility
before changing the runner/image; do not bypass MongoDB's kernel safety check.

[MongoDB kernel compatibility](https://www.mongodb.com/docs/v8.0/release-notes/8.0/).
**Live restore gate below remains NOT VERIFIED.**

## Live backup and restore gate

Before claiming recoverability, identify the actual application database and an existing private,
encrypted backup destination with a documented owner, key access and retention. No such destination
was verified in this review.

For Free/M0, --oplog and --dumpDbUsersAndRoles are unsupported; restore also excludes --oplogReplay,
--restoreDbUsersAndRoles and --preserveUUID. An online logical dump while writes continue is not a
single-point-in-time backup. A consistent live archive therefore needs a coordinated write pause
or a separately chosen supported backup strategy. No write pause is enabled by this document.

A subsequent authorized live exercise must:

- Verify an encrypted archive, its checksum, capture time, database identity and consistency method.
- Restore only into a separately authorized isolated target, never the current kuku cluster.
- Restore/test corresponding media objects without exposing or overwriting the live object namespace.
- Reconcile newer closure/erasure tombstones and ensure real notifications/calls remain disconnected.
- Measure recovery time and actual data-loss window, then record pass/fail evidence and cleanup.

Suggested planning targets are RPO 24 h and RTO 60 min; they are not adopted service guarantees or
measured results. Backup cadence, retention, storage cost and any Atlas tier upgrade remain
decisions to make after the safe rehearsal. No paid resource is authorized by this runbook.

## Release gate

**Status: NOT VERIFIED.** Do not mark backup/restore complete from cluster IDLE state, a code
rollback, a successful mongodump exit alone or a synthetic fixture test. Required final evidence:
a verified restorable archive, matching private media recovery, closure reconciliation, isolated
app acceptance, measured timing and a documented recovery owner.

## Official references

- [Atlas backup availability and restore considerations](https://www.mongodb.com/docs/atlas/backup-restore-cluster/)
- [Free cluster command-line limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [mongodump behavior on Free clusters](https://www.mongodb.com/docs/database-tools/mongodump/mongodump-behavior/)
- [mongodump and consistency](https://www.mongodb.com/docs/database-tools/mongodump/)
- [mongorestore config files, namespace remapping and stopOnError](https://www.mongodb.com/docs/database-tools/mongorestore/)
- [Atlas snapshot restore: future paid-tier path, not a Free-cluster capability](https://www.mongodb.com/docs/atlas/backup/cloud-backup/restore-from-snapshot/)
