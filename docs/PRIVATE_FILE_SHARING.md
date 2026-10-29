# Private file sharing activation

## Current delivery

- The KUKU branch alias has a deployment-protection exception. It opens without a Vercel account; the rest of the project retains its protection settings. KUKU authentication, email verification, invitation-only signup and conversation authorization remain in force.
- The API supports private Vercel Blob storage and retains private R2 compatibility. Original file bytes are streamed through the authenticated API, with a 25 MiB per-file limit. Provider credentials never enter the Expo bundle, app responses or download URLs.
- Files and the file/photo composer show whether sharing is configured, available space, and a friendly setup/connection state. The composer scrolls on short screens. Failed uploads retain the selected file for retry. Web downloads use a same-tab attachment navigation so a slow authorization request cannot lose the browser activation needed by popups. The browser test verifies the downloaded bytes and that the conversation remains open.

## Required owner account step

The connected Vercel API rejected `POST /storage/stores/blob` with HTTP 403 (permission to create the store denied). No store was created. This workspace has neither Vercel CLI credentials nor a VERCEL_TOKEN, so there is no authenticated CLI fallback.

1. In the Vercel dashboard, open project **KUKU** → **Storage** → create **Blob**.
2. Name it **kuku-private-files**, choose **Private** access and **Frankfurt (fra1)**, and connect it to KUKU's **Preview** environment.
3. The Render API needs the store's read-write token because it runs outside Vercel. Prefer transferring it via the connected integrations. If a manual transfer is necessary, paste it directly into Render's environment editor as **BLOB_READ_WRITE_TOKEN**; do not put it in chat, source, screenshots, logs or EXPO_PUBLIC variables.

The backend's non-secret settings are `FILE_STORAGE_PROVIDER=vercel` and `PUBLIC_API_ORIGIN=https://kuku-api-staging.onrender.com`. Adding the token triggers a Render rollout. Keep the store private; do not use a public store as a shortcut. Store creation does not require a paid-plan upgrade. Check the account's actual usage/plan before increasing limits.

## Authorization and downloads

Upload verifies the account and conversation membership, applies blocking rules and rate limits, validates the filename, and enforces file, user and shared-space quotas. The Vercel SDK always requests private access and disallows overwrites. Object names are random UUIDs.

An authenticated member requests a download. Unshared uploads are downloadable only by their owner. Vercel-backed files receive a one-use, 60-second capability URL from KUKU. The API stores only the token hash. Before streaming, it rechecks the issuing session, verified account, current conversation membership, shared message and attachment existence. Revoked sessions, removed memberships, expired links and deleted files fail closed. Treat the temporary URL as a secret until it expires, just like a signed R2 URL.

Files are served as downloads with `application/octet-stream`, `nosniff`, `no-store` and no-referrer headers. Provider credentials and raw private-store URLs are never returned. Each attachment records its provider, preserving existing R2 attachments when switching new uploads to Blob. Existing R2 downloads retain their signed-URL behavior.

## Capacity and operations

The app reserves quota atomically before storage writes. Each account can hold 500 MiB, with a 750 MiB shared application cap for new managed uploads. Provider failures release the reservation; completed deletions release it once. This does not replace provider-level billing/usage controls or account-wide allowances.

The original bytes are preserved. This release does not add inline photo previews, progress/cancel controls, background mobile transfers, or a photo gallery; those are subsequent attachment-experience work. KUKU is not end-to-end encrypted.

## Acceptance evidence and remaining gate

Backend integration tests exercise two synthetic members and an outsider, real request bytes and streamed responses, unshared-file denial, ticket expiry/reuse, logout, deletion, membership removal, SDK private-access settings, failed writes, missing configuration and concurrent quotas. CI runs these against MongoDB 7. Provider calls are isolated test doubles; they do not prove a live Blob store.

After owner-side store creation and secure credential connection, finish a live two-account upload → message → recipient download → checksum → owner deletion check, plus direct unauthenticated private-store denial. Use isolated synthetic test accounts in staging, remove their files, chats, sessions and profiles afterward, and avoid sending test emails. Physical Android/iOS acceptance remains separate.
