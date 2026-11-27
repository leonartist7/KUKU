# Chat improvements — 3 November 2026

## A little feeling

The smile button beside the chat input opens a 12-emote Fluent collection: heart, hug, laugh, love, kiss, thinking, celebration, smile, sleepy, wow, fire and confetti. Choose an emote, preview it and use Send or Cancel. Sent emotes use the existing account-bound durable queue and server allowlist; messages store an approved emote ID, never a remote URL or animation payload. Reusing an existing message ID with another emote is rejected.

Artwork is self-hosted, with Microsoft copyright and the full MIT notice at /emotes/LICENSE.txt and under You → Credits. Source revision and input/output checksums, frame durations, actual dimensions and byte counts are recorded in frontend/public/emotes/manifest.json. Only selected sources are fetched in cloud CI; no full repository clone is needed.

The twelve animations total 3,182,324 bytes (approximately 3.04 MiB), excluding posters and notices. Per-animation sizes are bounded to 300 KiB; the whole directory must stay below 4 MiB. Animated WebP files use finite looping. The picker grid uses still images; only selected previews and visible messages animate. Reduced motion and hidden tabs use static PNG posters, failed animations fall back to PNG and then Unicode, and messages can be tapped to replay. Current native paths deliberately use posters; native animation and a signed APK remain separate release work.

## Share deliberately

Choosing a photo or file within a chat now opens an attachment draft with Send and Cancel. Nothing uploads on selection or cancellation. Oversized selections are rejected, upload errors keep the selected draft, and queue failures reuse an already uploaded attachment rather than uploading it again. Drafts are held in memory on the current chat screen; they do not survive reload/navigation. Once queued, the existing durable outbox handles sending.

Uploads and message reads are bound to the current account. Returning from a picker or receiving a late response for another conversation/account cannot replace the active chat's state.

## Read without losing your place

Incoming messages no longer force a reader to the bottom while they are browsing history. A New messages button jumps down on demand. The conversation follows new content when already near the bottom and after the current user's own sends. Browser polling pauses while the tab is hidden and resumes when visible.

## Verification

The full release workflow checks server validation, recipient membership, verified-account access, idempotency, catalog/asset integrity, frontend types and the web build. The browser journey exercises photo draft Send/Cancel, emote Send/Cancel, actual WebP animation frames, reduced-motion posters, receiving-account rendering, credits and reading-position preservation at mobile sizes. Synthetic fixtures do not send messages to real members.
