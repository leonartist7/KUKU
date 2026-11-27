# F50 media usefulness simulations — 28 November 2026

Ten scenarios use synthetic identities, metadata and deferred promises. No personal files,
messages, clipboard content, notifications or provider calls were used. Native confirmations
are mocked; this is not physical Android acceptance. Root records final cloud/deployment evidence.

| ID | User action or failure | Result and evidence |
|---|---|---|
| M01 | Start downloading an image, then leave, close the viewer or unmount before the signed URL returns. | FIXED. A viewer/account/session/attachment lease prevents late opening. New `image download resolved after blur, close or unmount never opens private media`. |
| M02 | The same account renews its session while an image download is pending. | FIXED. Session-boundary teardown fences completion even before React renders again. New `image download is fenced by a same-account session renewal without waiting for render`. |
| M03 | A reused image row changes attachment, or private access is invalidated while a download is pending. | FIXED. Old media cannot open after replacement, unavailable state or matching cache invalidation. New `old image downloads cannot open after attachment replacement or access invalidation`. |
| M04 | Open Android's image-delete confirmation, then leave, change account/attachment or lose permission before confirming. | FIXED. Confirmation captures the originating lease and revalidates it and current deletion permission before dispatch. New `native image confirmations cannot dispatch after navigation, session, attachment or permission loss` covers eight boundaries. |
| M05 | Tap Download original repeatedly while the ticket request is slow. | FIXED. One request/open per pending action; buttons expose disabled/busy state. New `rapid image download taps share one action and open the original once`. |
| M06 | An old image download fails after a different image replaces it. | FIXED. Late errors cannot overwrite the replacement viewer or expose raw provider errors. New `late image failures cannot overwrite a replacement image with stale error feedback`. |
| M07 | View an image, navigate away, then return. | FIXED. The modal hides immediately when focus/proven verification is lost and stays closed on return. New `image viewer closes on navigation and does not reopen itself when returning`. |
| M08 | Confirm image deletion twice while its request is pending. | FIXED. Only one delete is dispatched; exact attachment invalidation and modal closure remain. New `confirmed image deletion is deduplicated and invalidates its exact private attachment`. |
| M09 | Leave while private voice/file media is opening or playing. | PASS existing behavior. `private-memos.unit.cjs`: late bytes create no player; blur/revocation/session loss releases playback; late native downloads are deleted; stale file-delete confirmation and signed download are fenced. |
| M10 | Import a quiet WAV, change accounts, replace/remove it during pending writes, or cancel pending playback. | PASS existing behavior. `notification-sounds.unit.cjs`: normalization/headroom and silent/invalid/overlong bounds; per-account custom storage; late decode cancellation; serialized removal and preference rollback regressions. Existing image cache bounds/TTL/scope cases also pass. |

## Verification

- `NODE_PATH=/tmp/kuku-f50-tooling/node_modules node --test tests/private-images.unit.cjs tests/private-memos.unit.cjs tests/image-preview-cache.unit.cjs tests/notification-sounds.unit.cjs` from `frontend`: **36/36 PASS** (8 new).
- Differential check ran the eight new cases against the original `HEAD:frontend/src/PrivateImageCard.tsx` in a temporary copy: **0/8 PASS, 8 failures**. The repaired component passes all eight. No source swap or committed fixture bypass was used.
- Source changes: `frontend/src/PrivateImageCard.tsx`. New regressions: `frontend/tests/private-images.unit.cjs`.
- No dependencies, backend contracts, feature gates or storage policies changed. Image actions now require a focused, verified, server-proven account and an open viewer; ordinary thumbnail loading and private cache limits are preserved.
- Closing invalidates future completions; already-dispatched server mutations cannot be recalled. Backend authorization remains authoritative. Physical Android dialogs/downloads, OS notification sound/volume, and media routing remain unverified.
