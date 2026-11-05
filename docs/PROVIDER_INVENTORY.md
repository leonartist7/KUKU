# Provider-only object inventory

This operator tool reports private storage objects that have no matching KUKU metadata. It is
read-only. It never attributes an owner, deletes an object, changes quota, creates a retention job,
or marks physical erasure complete. Do not wire it into API startup or the lifecycle worker.

## Safety boundary

- Only the fixed `attachments/` and `space-audio/` prefixes are accepted.
- Provider keys, URLs, ETags, cursors and error messages stay out of the report. Keyed HMAC digests
  permit comparison without making provider names recoverable from a stolen report.
- Objects younger than 24 hours cannot become candidates.
- A failed, partial, over-budget or non-progressing scan cannot confirm anything.
- A malformed provider entry makes the scan incomplete; it is never skipped under a completeness
  claim. Any exact key in the corresponding KUKU metadata collection counts as present regardless
  of a missing, stale or malformed provider field.
- Confirmation requires two complete scans with the same provider, prefixes and HMAC key at least
  24 hours apart. It proves only that an unchanged provider object was absent from metadata twice.
  It does not prove ownership or authorize deletion.
- Vercel Blob listing is an advanced provider operation and provider listings are not immutable
  snapshots. Decide the allowed listing cost before any live run and keep the two-pass quarantine.

## Manual report

Use the most restricted provider identity available for the target store, an explicitly configured
read-only database identity, and a separate 32-byte or longer `PROVIDER_INVENTORY_HMAC_KEY`.
`MONGO_URL` and `DB_NAME` must both be explicit; the command refuses application defaults and
missing metadata collections. The HMAC key must remain stable for both passes and must not be
stored in the report or repository.

```bash
python backend/scripts/provider_inventory_report.py \
  --provider r2 \
  --source-sha "$VERIFIED_SOURCE_SHA" \
  --output /secure/operator/p06-r2-pass-1.json \
  --acknowledge REPORT_ONLY_NO_DELETE
```

At least 24 hours later, run the same bounded command with a new output path and add:

```bash
--previous /secure/operator/p06-r2-pass-1.json
```

Outputs are created as new mode-0600 files and refuse overwrite. Console output contains aggregate
counts only. Keep reports in operator-controlled encrypted storage. A live run still requires a
specific credential and cost decision; implementation and synthetic CI do not supply either.

The comparison's `confirmed` list is quarantine evidence only. Until an ownership policy, explicit
approval path and idempotent deletion design are separately reviewed, take no action on it.
