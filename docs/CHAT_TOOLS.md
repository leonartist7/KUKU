# KUKU chat tools — phase 3

Status: deployed to the invited beta on 4 November 2026, runtime d3366883. Integrated cloud run 41864811206 passes 119 backend tests, 110 frontend unit tests, TypeScript, web export and the full synthetic chat-tools browser journey. Physical-device and provider-delivery gates remain separate.
This phase preserves the existing private-chat, Space and call transport foundations.

## Product behavior

- Reply to a message by reference. No quoted message body is copied into the server record or durable outbox.
- React with one of ❤️ 😂 🥰 👍 😮 😢. Each member has at most one reaction per message; choosing another replaces it, null clears it.
- Edit your own text within 15 minutes of sending. The current wording replaces the previous wording and edited_at marks the change. There is no user-facing edit-history archive.
- Remove your own text or emote at any age. The shared message becomes a tombstone; its text, emote, reply reference and reactions are removed from the current record. File/voice/image originals require their existing file controls.
- Search a conversation with a literal 2–80-character phrase. Searches cover current text and filenames, excluding removed messages.
- Share up to 20 pinned messages per conversation. Either member can pin/unpin; deleted messages never display in Pins.

## HTTP contracts

All routes require a verified, non-disabled user with a valid revocable session and current chat membership. Foreign/missing messages produce 404; owner-only action violations produce 403. Mutation request bodies reject unknown fields.

| Route | Request | Response |
|---|---|---|
| POST /chats/{cid}/messages | Existing send body plus optional reply_to_id | Current public message |
| GET /chats/{cid}/messages/{mid} | — | Current public message or tombstone |
| POST /chats/{cid}/messages/resolve | {message_ids:string[]} (max 100) | Current messages, foreign/missing IDs omitted |
| POST /chats/{cid}/messages/{mid}/edit | {text,expected_revision} | Current edited message |
| POST /chats/{cid}/messages/{mid}/remove | {expected_revision} | Current tombstone |
| POST /chats/{cid}/messages/{mid}/reaction | {emoji:string|null,expected_revision?:number} | Current message |
| POST /chats/{cid}/messages/{mid}/pin | {pinned:boolean} | Current message |
| GET /chats/{cid}/pins | — | Current pinned messages, newest pin first |
| GET /chats/{cid}/search | q, optional before message ID, limit(default 20/max 50) | Matches newest first |

Public additions: revision(default 0), reply_to_id, edited_at, deleted_at, reactions:[{emoji,user_ids}], pinned:boolean, and pinned_at/pinned_by while pinned. Tombstones expose identity/time/status only, use type=text, text=null, emote_id=null, reactions=[], pinned=false.

Edit/removal conflicts return 409. Refresh the current message rather than blindly replaying a stale edit. A repeated successful removal returns the existing tombstone. Reactions omit expected_revision by default so independent members can merge; optional strict revision checking remains available.

A new reply must target an existing, nonremoved message in the same conversation. An exact retry of an already stored reply still succeeds if the referenced original was subsequently removed.

## Blocking and privacy

Blocking denies new messages, edits, reactions and pins. Existing authorized history remains readable. Own-message removal, clearing an existing own reaction and unpinning remain available as cleanup.

Privacy-removal invalidations may pass to a blocked peer who remains a member. These events contain only message/chat/sender IDs and a revision. The client fetches the membership-checked current message, allowing stale text to become a tombstone without enabling new contact. Ordinary created/edit/reaction events remain filtered for blocked contacts.

A tombstone is not an assertion that all historical copies, backups or already delivered provider notifications disappeared. Pending message push work is marked cancelled; an already in-flight external notification cannot be recalled. KUKU remains not end-to-end encrypted.

## Durable retries and revisions

New sends store an internal keyed HMAC of immutable initial send content, including reply_to_id. Exact lost-ack retries after an edit/removal return the latest sanitized message, never restore the original body. Changed content under the same client_message_id returns 409.

Legacy text/emote records freeze their original fingerprint before their first edit/removal. The fingerprint retains no second plaintext message copy and never appears in APIs, events or exports. Its current key is JWT_SECRET; key rotation must account for pending retry fingerprints or introduce a stable dedicated migration key before rotating.

Every actual mutation atomically increments revision and sets sync_pending. No-op reactions/pins do not generate another public revision.

- Created-event identity stays user_id:message_id for revision 0.
- Updated-event identity includes message_id and revision.
- Hints contain change=created|updated and revision, never bodies.
- Publishing clears sync_pending only when the stored revision still matches its captured revision.
- The background repair processes the latest pending revision, so an earlier publisher cannot clear a later edit.
- The client GETs the single message for updated hints, suppresses new-message sounds for edits/reactions/pins, and reconciles loaded IDs through resolve after reconnect/reset.

## Shared pin consistency

The chat document holds the authoritative, atomically bounded pinned ID list. That same update records a pending repair marker and pin generation. Message presentation always uses the chat's current list.

A repair hook mirrors pin metadata into a message revision and publishes its invalidation. It clears the chat marker only if the pin generation still matches. Interrupted cross-document updates therefore remain recoverable. Normal operations queue at most 40 IDs; removing up to 20 already pinned messages can use a reserved cleanup margin, for a maximum 60 queued IDs. New normal changes stop when the normal queue is full.

Deleted/missing pins are filtered immediately and pruned before another pin consumes capacity. This uses durable repair markers rather than pretending a two-document write is a transaction.

## Search limits and indexes

Queries escape regex metacharacters, remain scoped to one authorized chat and use a stable created_at/id cursor. They set a 1500ms server execution limit and a 3-second client wait; timeout produces an actionable 503. This is literal substring search, not full-text relevance ranking.

Existing chat/time indexes remain. Added indexes: unique chats.id and sparse chats._pin_sync_pending for queued pin repair. Reassess substring-search cost from actual usage before adding Atlas Search or a text index.

## Integration and verification

The server constructs ChatActions(lambda:db,auth,chat_events), includes its router and awaits indexes at startup. ChatEvents exposes repair_hooks; the existing room lifecycle worker calls repair_pending, which runs pin repairs before message repairs.

tests/test_chat_actions.py is included in the backend pytest configuration. The package supplies regression coverage for replies and batch scope, owner/window/conflict edits, original-send replay after changes, emote/attachment removal boundaries, reaction races/allowlists, blocking cleanup, literal search/cursors, pin-cap races, interrupted pin repair and late-publication marker safety.

Run the integrated backend suite against MongoDB 7 and the frontend type/unit/browser checks. Browser acceptance must include older-message edits after reconnect, deleted reply targets, narrow composer/tools layouts, keyboard navigation and quiet updated hints. No test or visual result is claimed until that run passes.

## Technical references

- [MongoDB atomic updates and expected-value filters](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
- [PyMongo bounded find operations](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/crud/query/find/)
