# KUKU — Design, Performance, Spaces & Calls
## Master improvement plan • 4 November 2026

**Goal:** Make KUKU a beautiful, calm and dependable private place to talk, share and spend time together.

**Recommended order:** reliability → visual consistency → faster, richer chat → dependable Spaces → audio calls → video and Android release.

This is an execution plan. No application code, deployment, subscription or billing setting was changed while preparing it. Proposed targets are acceptance criteria, not measurements of current production performance.

---

## 1. What exists, and what needs to change

The review used leonartist7/KUKU, branch codex/kuku-release-20261027, commit [163f28b](https://github.com/leonartist7/KUKU/commit/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914). The current beta is served by Vercel, with a FastAPI service on Render, MongoDB Atlas, private file storage, transactional email and browser push.

The [latest matching CI run](https://github.com/leonartist7/KUKU/actions/runs/41627629777) passed 51 backend tests, 15 frontend unit tests, TypeScript, web export and a synthetic browser walkthrough. Those checks cover useful existing flows; they do not establish real-device call quality or cross-device playback synchronization.

| Area | Current foundation | Next priority |
|---|---|---|
| Accounts | Invitations, email verification, onboarding, profile photos | Recovery, clear expired-link states, account settings and deletion |
| Chat | Private conversations, voice memos, attachments, image previews, animated emotes | Realtime delivery, replies, reliable retries, search and truthful receipts |
| Appearance | Warm branding, theme schedules, palettes and decor | Shared design tokens, consistent spacing, accessible controls |
| Notifications | Foreground sound choices and browser push registration | Diagnose permissions, show status, verify real Android behavior |
| Spaces | Room interface, membership, playback state and room chat | Host rules, accurate presence, private audio storage, reconnect and sync |
| Calls | LiveKit direction and signaling skeleton | Complete media rendering, state transitions and controls; keep gated until verified |
| Operations | Automated checks and deploy history | Always-on API, readiness checks, recovery and observability |

### The highest-impact findings

1. **The API is on Render's free plan.** Idle services sleep, causing a wake-up delay. That directly affects the feeling of opening a chat, joining a Space or making a call. The current service also has no configured health-check path.
2. **Call acceptance is being treated as media connection.** The interface can start its connected state and timer before audio is ready. Remote audio rendering and several controls are unfinished.
3. **Space controls are inconsistent.** Playback controls require the host, but setting content can transfer host ownership to any member. Leaving, presence and multiple tabs need clearer rules.
4. **Space audio is embedded as base64 in database-backed room data.** Replace this with the private attachment architecture already used elsewhere.
5. **Realtime channels need a consistent reconnect and session model.** In-memory hubs are a reasonable small-beta starting point, but they require one API worker until shared fan-out is introduced.

**Product promise for the next beta:** private conversations, comfortable shared rooms, dependable audio calls and clear recovery whenever a connection fails.

---

## 2. How KUKU should look and feel

### A warm, quiet visual identity

Keep KUKU's existing character. Refine it through consistency instead of replacing it with a generic messaging template.

- Use warm neutral surfaces with one restrained accent per theme. Reserve strong red for destructive actions and urgent errors.
- Keep Fraunces for a few expressive headings and DM Sans for reading and controls.
- Use a spacing system of 4, 8, 12, 16, 24 and 32 pixels. Align headers, content and composers to a shared grid.
- Start with 16–17 px body text and 13–14 px secondary text; support browser scaling and large system text.
- Use 44–48 px touch targets, visible keyboard focus and AA contrast. Status must remain understandable without color.
- Keep shadows soft and rare. Prefer surface contrast and whitespace to nested outlined cards.

Deliver complete light and dark tokens: background, surface, raised surface, text, secondary text, border, accent, success, warning, error and focus. Check every palette against both modes.

Theme scheduling should use the person's local time, preserve their explicit choice and respond correctly after a backgrounded app resumes. Avoid a flash of the wrong theme during startup. Decorations need intensity and off controls.

### Navigation and layout

Use four stable destinations: **Chats · Spaces · Files · You**.

Chats opens the inbox; Spaces opens shared rooms; Files collects authorized shared attachments; You contains profile, appearance, notifications, privacy and devices. Creation actions belong in the relevant destination.

On desktop, use a conversation list and conversation pane, with an optional details panel. On mobile, retain one clear screen at a time. Bound reading widths and preserve scroll position when moving between views.

Make starting a conversation obvious: a visible New chat action, an authorized contact search and a shareable invitation link with clear accept/decline behavior. Explain the difference between inviting someone to KUKU and connecting with an existing account. Avoid exposing the entire user directory.

Design and verify at 320, 390, 768, 1024 and 1440 px. Include software keyboards, safe areas, landscape orientation and 200% zoom.

### Conversation design

- Keep image messages bare and clean: no redundant filename card. Offer download and details in a contextual menu.
- Group consecutive messages subtly; show date breaks and readable timestamps without repeating the sender everywhere.
- Use a compact composer: attachment menu, growing text field, emote access and Send/Microphone behavior.
- Preserve attachment drafts, text drafts and reading position. A new message should not pull someone away from older messages.
- Show uploading, sending, sent, failed and retry states honestly. “Delivered” and “Read” require actual supporting events.
- Make reply, react, copy, edit and delete available by touch and keyboard. Define edit history and deletion behavior before shipping them.

Animations should mostly last 120–240 ms and use opacity or transforms. Keep emotes finite, honor reduced motion, and stop offscreen animation. Empty screens should suggest one useful action.

### Reference direction

These are observed layout references, not designs to copy:

| Reference | Pattern to adapt |
|---|---|
| [Messages conversation](https://mobbin.com/screens/e1424a0e-a482-4d6a-8e64-d7641250c57c) | Clear contact header, restrained composer and simple attachment access |
| [Luma conversation](https://mobbin.com/screens/72500ce0-f688-4e92-8204-63f37a4a5d56) | Grouped bubbles, bare media and low visual clutter |
| [X call screen](https://mobbin.com/screens/7183d739-0796-49b8-a2b4-080a7a084ffd) | A dominant call stage and a small, clear set of bottom controls |

These are iOS references. KUKU must adapt them to Android, browser permissions and its own warmer identity.

---

## 3. Six execution phases

| Phase | Outcome | Exit requirement |
|---|---|---|
| 1. Reliability and baseline | Opening and reconnecting feel understandable and safe | No indefinite loaders; tested recovery and recorded baseline |
| 2. Design and interaction | One consistent, polished interface | Responsive, accessible review across core screens |
| 3. Chat and performance | Fast conversations with dependable delivery | Retry, ordering, account isolation and media tests pass |
| 4. Spaces | Small private rooms that stay together | Two-to-four-device playback and reconnect checks pass |
| 5. Calls | Dependable audio, then optional video | Real two-phone media and permission tests pass |
| 6. Android and release | A usable installed app and supportable beta | Signed build, physical-device checks and recovery evidence |

Design exploration and reliability measurement can proceed together. Call implementation depends on reliable sessions and signaling; video depends on audio passing its release gate.

### Phase 1 — Reliability before decoration

**Deliverables**

- Measure startup, API latency, image loading, message acknowledgement, bundle size and memory on a representative Android phone and desktop browser.
- Keep the recent sign-in improvement: a person with no saved account reaches sign-in without waiting for an API refresh.
- Give saved sessions a clear reconnect state with bounded retries, then an actionable error. Do not erase the session merely because the API is temporarily unavailable.
- Add shallow liveness and bounded readiness endpoints. Configure Render health checks against the appropriate endpoint.
- Prepare the move to an always-on API. Confirm the selected compute price before enabling a paid instance.
- Standardize loading, empty, offline, unauthorized, missing and retry states across routes.
- Use backoff with jitter and a single reconnect owner. Stop reconnecting after logout.
- Enforce account-scoped caches and late-response guards everywhere, including Spaces and calls.
- Add structured, redacted diagnostics and release identifiers. Never log message bodies, invitation codes, tokens or recordings.

**Exit check:** fresh sign-in, expired session, lost Wi-Fi, API restart, missing room and logout all produce understandable states. No cross-account data remains after account switching. Capture a baseline before claiming a speed improvement.

### Phase 2 — Design system and everyday comfort

**Deliverables**

- Create shared tokens and reusable primitives for buttons, fields, sheets, menus, avatars, badges, dialogs and status messages.
- Refine onboarding into a clear journey: invitation → verification → profile → first conversation.
- Explain verification delays, resend cooldowns, expired links and which address is being verified.
- Rebuild settings around appearance, notifications, privacy, storage and account management.
- Add avatar crop/preview, upload progress, replace/remove actions and a polished initials fallback.
- Refine inbox, chat header, composer, image viewer, file picker, voice preview and invite sharing together.
- Add contextual help where it solves a task: enabling notifications, microphone permissions and installing the app.
- Reduce heavy decor behind content and eliminate duplicate labels or outlines around media.

**Exit check:** all core screens work at the target widths, with keyboard navigation, large text, light/dark themes and reduced motion. No placeholder control looks available when its action is unfinished.

### Phase 3 — Chat completeness and measured performance

**Deliverables**

- Introduce a shared authenticated realtime connection for chat events. Use bounded polling only as a fallback.
- Resume with a cursor after reconnect. Deduplicate by durable event/message IDs and preserve server ordering.
- Give each send a client-generated idempotency key. Persist safely, acknowledge after durable storage and reconcile optimistic drafts.
- Add reply previews and a restrained reaction set first. Follow with edit/delete rules, conversation search and pinned messages.
- Paginate conversations, messages and files. Use indexes and projections for the actual queries.
- Virtualize long histories carefully, preserving variable-height images and reading position.
- Lazy-load call code, media players and the emote picker.
- Serve bounded previews and defer full-resolution media. Release object URLs and audio resources.
- Add upload progress, cancellation, retry, quota explanations and expired-link refresh.
- Improve notification settings with sound previews, volume, quiet hours, per-chat mute and a diagnostic/test action.
- Make Files useful with photo/document/audio filters, conversation context and accessible preview/download actions. Recheck authorization when opening a file; show clear states for deleted, expired or unavailable media.
- Add archive and unread controls; make typing, online presence and read receipts optional privacy settings rather than mandatory signals.

Notification wording must distinguish foreground app sounds from Android/browser-controlled background notifications. Avoid duplicate alerts while a conversation is visible. Opening an alert should navigate to the authorized conversation after sign-in if necessary.

**Exit check:** simulate lost acknowledgements, repeated taps, reconnects and two devices sending together. Messages appear once, in order, and failures remain recoverable. Test long histories and large authorized attachments without growing memory indefinitely.

---

## 4. Phase 4 — Spaces that feel like being together

### Define a Space clearly

A Space is a **persistent, small private room** for talking, listening or watching together. Invited members and people currently present are different concepts.

The first release should support two to four active people reliably. A membership limit of 20 is not proof that a 20-person media session is supported.

A Space has a name, optional cover/decor, members, roles, room chat and a current activity. Use three simple activities: **Hang out · Listen together · Watch together**. Keep the room screen focused on the current activity, with members and room chat accessible without covering essential controls.

Show who is present, who is reconnecting and who has not enabled audio. Offer one clear Join/Leave control. Keep microphone mute separate from playback mute.

### Roles and ownership

| Action | Owner/host | Co-host | Member |
|---|---|---|---|
| Play, pause, seek and select current content | Yes | Yes | Request control |
| Adjust personal playback volume | Yes | Yes | Yes |
| Invite or remove people | Owner policy | Only if explicitly granted | Only if explicitly granted |
| Transfer hosting | Yes | When delegated | Accept an offered handoff |
| Change room policy or delete the Space | Owner | No | No |

Choose the simplest initial rule: one owner and one active host, with explicit handoff. Add co-hosts only if needed. Changing content must never silently seize hosting.

If the host leaves, show the handoff state and elect or offer a replacement according to a documented rule. If everyone leaves, close the activity session once while retaining the Space and permitted history.

Invitations must have scoped permissions, expiry, revocation and optional use limits. A room invitation must not reveal other private conversations, emails or files.

### Playback synchronization

Use one authoritative server playback state containing activity/session ID, version, media reference, playing/paused status, position, server timestamp and host identity.

1. The host sends an authorized command.
2. The server commits a newer state and broadcasts its version.
3. Clients estimate server-time offset and render the expected current position.
4. Reconnecting clients request a fresh snapshot before applying later events.
5. Small drift receives gentle correction; large drift triggers an explicit seek or a visible resync action.

Use monotonic elapsed time locally, bounded clock-offset estimates and stale-event rejection. Account for buffering and playback-rate limits; do not seek repeatedly on every update.

For YouTube, use the supported IFrame Player API, readiness/error events and the required API configuration. A plain iframe is insufficient for reliable shared controls. Handle unavailable videos, embedding restrictions and autoplay blocks honestly. Show “Tap to join playback” when a gesture is required.

For private audio, upload binary media through the private attachment system. Store a reference and metadata, not base64 in room snapshots. Authorize playback and support seeking with range requests where the storage/proxy supports them. Test browser and native pickers separately.

Do not promise synchronized Netflix, Spotify or other protected streaming services. Add integrations only where their official APIs and terms support the intended experience.

### Presence, reconnect and lifecycle

- Track connections by device/session rather than only by user.
- Derive user presence from active connections with heartbeat expiry.
- Closing one tab must not remove another tab's presence.
- Revalidate sessions and membership on reconnect and sensitive mutations.
- Version room state and reconcile missed events; show reconnecting status.
- Make leave, disconnect and session summaries idempotent.
- Clear listeners, timers, players and animations on leave.
- Split the large room screen into player, controls, members, chat and connection modules.

### Space acceptance targets

These are proposed controlled-test targets, not achieved measurements:

- Two-to-four devices can join, leave and reconnect without losing correct roles.
- Private audio drift stays within 500 ms on a stable test network.
- After reconnect, playback converges within 1.5 seconds of the host position within five seconds, once media is ready.
- YouTube buffering or provider restrictions show a useful state rather than a false synchronized indicator.
- A removed member cannot receive new room events or obtain fresh media access; short-lived already-issued media links follow a documented expiry policy.
- Thirty-minute sessions leave no continuing microphone, playback or animation after exit.

A room may remain useful even when a provider cannot meet the synchronization target; the interface must explain the limitation.

---

## 5. Phase 5 — Calls that work before they look finished

### Ship 1:1 audio first

Keep calls gated until audio passes its real-device checks. The first audio experience needs an incoming screen, ringing, answer/decline, microphone permission, mute, supported output control, hang up and clear reconnect/failure states.

Allow a connected call to minimize into a compact ongoing-call banner while the person reads a chat or shares a file. Provide Return to call and Hang up. Keep call ownership in a shared session controller so ordinary navigation does not accidentally end the conversation.

Use distinct states:

**Permission check → Calling/Ringing → Accepted, connecting audio → Connected → Reconnecting → Ended with reason.**

Start the duration timer from confirmed media connection. Signaling acceptance alone is insufficient. Show useful reasons for missed, declined, busy, unavailable, permission-denied and network-failed calls.

### Complete the media path

- Subscribe to remote LiveKit audio and attach/render it on the web; handle track subscription, replacement and removal.
- Resume browser audio through a user gesture when needed.
- Use confirmed SDK microphone state for mute indicators.
- Implement real audio routing where supported. In browsers with restricted output selection, explain or hide unsupported speaker controls.
- Stop local tracks, detach remote media and remove listeners on end, logout and unrecoverable failure. Dispose the call controller safely when its owning session ends; ordinary navigation must hand ownership through the shared controller rather than leaking or stopping tracks.
- Treat camera and microphone independently; camera stays off until deliberately enabled.
- Handle failed acceptance without navigating into a falsely connected call.

### Make signaling authoritative

- Enforce the feature flag consistently across call creation, acceptance, token issuance and events.
- Use atomic state transitions for ringing, accepted, declined, timed out and ended.
- Prevent simultaneous active calls with a participant lease or equivalent durable constraint.
- Make simultaneous answers from multiple devices and repeated mutations idempotent.
- Broadcast changes to the other participant and the appropriate own-device sessions.
- Add server-owned ringing expiry and cleanup when a caller disappears.
- Revalidate active sessions and membership throughout long-lived channels.
- Issue short-lived, room-bound LiveKit tokens only to authorized participants in an accepted active call.
- Apply blocking/contact policy before signaling and token issuance. On revocation, remove the participant through the provider where supported.

Existing transport encryption does not make KUKU end-to-end encrypted. Any future E2EE needs a separate key-distribution, device and recovery design.

### Audio release gate

Use two physical phones, including the sister's Android or an equivalent representative device, on different networks. Test:

- Answer/decline, missed/busy, caller cancellation and either side hanging up.
- Denied/revoked microphone permission and devices with no available microphone.
- Built-in speaker, wired headphones and Bluetooth.
- Wi-Fi to cellular changes, temporary packet loss and provider reconnect.
- Browser autoplay restrictions, background/resume and expired sessions.
- Two tabs/devices answering, repeated taps, logout and participant removal.
- A 20–30 minute conversation with no one-way audio or leaked microphone afterward.

Proposed target: p95 media connection within five seconds after acceptance and permission, measured under documented network conditions. It is a goal, not a guarantee.

### Video and room voice follow separately

After audio passes, add camera preview, camera switching, camera-off state, participant tile layout, bandwidth adaptation and clear poor-network indicators. Test rotation, thermal load and lower-powered Android devices.

Integrate voice into Spaces only after 1:1 calls and room membership are dependable. Use room-scoped media permissions and separate local microphone from shared playback controls. Default to headphones guidance when shared media would cause echo.

Recording, screen sharing and large group calls are later features with their own consent, cost and compatibility work.

---

## 6. Phase 6 — Android, privacy and release readiness

A signed APK is a valid distribution path, but it does not automatically solve background notifications or calls. Build the native behavior intentionally.

- Use an Expo development/production build with LiveKit's React Native SDK and config plugins. Expo Go does not include the required native support.
- Use cloud builds rather than installing a large local Android toolchain.
- Configure Android push delivery, channels and notification permission.
- Implement native incoming-call behavior with supported Android calling notifications, answer/decline actions and required lifecycle handling.
- Test locked-screen and background behavior on real devices with battery optimization enabled.
- Document installation, updating and browser-versus-installed-app differences.
- Protect signing keys and define an upgrade path that preserves accounts and app data.

For the release itself:

- Confirm privacy wording, retention, block/report behavior, account export and deletion.
- Verify backups and perform a restoration exercise.
- Clean abandoned uploads and apply attachment retention rules.
- Set aggregate monitoring and spending alerts.
- Retain a known-good frontend/backend pair and document rollback.
- Test with the two existing accounts before adding a small invited beta group.
- Publish a short known-limitations list and a simple way to report a broken flow.

Never label web background calling as equivalent to a native Android experience until that exact scenario is verified.

---

## 7. Architecture and performance budgets

### Keep the stack, repair the boundaries

| Layer | Responsibility |
|---|---|
| Vercel frontend | Interface, navigation, web delivery and installable web experience |
| Render FastAPI | Authentication, authorization, durable signaling, chat and Space APIs |
| MongoDB Atlas | Users, membership, messages, event cursors and authoritative activity state |
| Private object storage | Images, files and audio; referenced from database documents |
| LiveKit | Realtime microphone/camera transport and connectivity |
| Push/email | Invitations, verification and notification delivery appropriate to each platform |

Do not proxy live audio/video through ordinary FastAPI JSON or Vercel request handlers. Keep the API at one worker while connection hubs are process-local. Before horizontal scaling, add shared fan-out and durable event recovery; a larger instance alone does not solve that requirement.

Audit indexes and query plans against actual workloads. Prefer bounded cursor pagination to loading full histories. Shared cache keys must include account and authorization scope.

### Proposed budgets and how to measure them

| Experience | Target | Measurement |
|---|---|---|
| Web loading | p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 | Real-user measurements, separated by device class |
| Local send feedback | ≤100 ms | Tap to optimistic message/draft state |
| Foreground realtime delivery | p95 ≤1 s | Persisted message event to receiving active client |
| Warm ordinary API read | p95 ≤300 ms | Server and client timings, excluding file transfer |
| Call media connection | p95 ≤5 s after acceptance/permission | Signaling and actual media-ready timestamps |
| Space private-audio drift | ≤500 ms on stable controlled network | Shared timeline samples on multiple devices |
| Long session health | Memory plateaus; resources stop on exit | 20–30 minute call and Space traces |
| Correctness | No duplicate durable messages in retry suite | Idempotency and reconnect tests |

Core Web Vitals thresholds come from official web.dev guidance. Other numbers are proposed KUKU budgets and must be revised from measured device/network baselines.

Avoid arbitrary bundle-size promises before measurement. Record initial download, parsed JavaScript and lazy-loaded chunks; prioritize changes that reduce real startup and input delay. Respect data-saving settings and never precache private originals or authenticated API responses indiscriminately.

---

## 8. Costs and infrastructure decisions

Prices and quotas were checked against official documentation on 4 November 2026; confirm again before a purchase.

| Component | Recommendation | Cost implication |
|---|---|---|
| Render API | Move from sleeping free service to always-on compute | Entry web-service compute listed at $7/month; other usage and taxes may apply |
| LiveKit calls | Start with Build for development and limited beta | $0 plan; current allowance includes 5,000 WebRTC participant minutes and 50 GB downstream/month |
| Vercel, Atlas, storage and email | Retain existing setup; review actual usage | Existing plan limits and variable charges remain separate |
| Native builds and distribution | Cloud build and signed Android release | Depends on build provider and distribution choice |
| Monitoring | Minimal aggregate metrics first | Set caps/alerts before adding paid tooling |

Two people in a 60-minute call use approximately 120 participant minutes. At 5,000 participant minutes, that is about 2,500 minutes of two-person conversation, assuming no other usage; bandwidth or other shared limits may bind first. This is arithmetic based on the documented allowance, not a promise of free capacity.

The first infrastructure recommendation is the always-on API. LiveKit's free allowance can support initial validation, but it needs usage tracking. No paid plan or service change was made for this document.

---

## 9. Execution backlog

P0 = correctness/reliability required for release. P1 = core polish or completeness. P2 = expand after the first release gate.

| ID | Priority | Work package | Depends on | Acceptance evidence |
|---|---|---|---|---|
| R01 | P0 | Record baseline and error inventory | — | Device, build and network documented |
| R02 | P0 | Health checks and always-on deployment preparation | R01 | Healthy rollout/restart and bounded readiness |
| R03 | P0 | Session-scoped requests, caches and reconnect | R01 | Logout/account-switch/reconnect checks |
| D01 | P1 | Tokens, primitives and responsive shell | R01 | Five-width theme/accessibility review |
| D02 | P1 | Onboarding, recovery and profile refinement | D01, R03 | New and expired invitation walkthroughs |
| D03 | P1 | Chat composer, media, menus and settings | D01 | Keyboard, large text and touch review |
| M01 | P0 | Shared realtime events and cursor resume | R03 | Restart and missed-event replay tests |
| M02 | P0 | Durable idempotent send and pagination | M01 | No duplicates; stable ordering |
| M03 | P1 | Replies, reactions and contextual actions | D03, M02 | Correct authorization and thread previews |
| M04 | P1 | Search, pins and edit/delete semantics | M02 | Scoped search and mutation checks |
| P01 | P1 | Media, list, font and bundle optimization | R01, M02 | Before/after traces and memory checks |
| N01 | P0 | Notification diagnosis and Android verification | R03 | Foreground/background evidence |
| S01 | P0 | Space roles, connection presence and lifecycle | R03 | Multi-tab, host-exit and removal tests |
| S02 | P0 | Replace inline Space audio with private assets | R03 | Authorized stream/seek and quota checks |
| S03 | P0 | Versioned playback and reconnect protocol | M01, S01 | Drift and reconnect measurements |
| S04 | P1 | Space room/player/queue presentation | D01, S02, S03 | Two-to-four-device walkthrough |
| C01 | P0 | Atomic call lifecycle, expiry and scoped tokens | M01, R03 | Race, revoke and timeout tests |
| C02 | P0 | Complete audio subscription and device controls | C01 | Audible two-way media; tracks stop |
| C03 | P0 | Real-phone audio acceptance gate | C02, N01 | Recorded pass/fail matrix |
| C04 | P2 | Video and adaptive call layout | C03, D01 | Rotation, bandwidth and heat checks |
| A01 | P1 | Native Android build and OS call integration | C03, N01 | Signed install and locked-screen tests |
| B01 | P0 | Retention, export/deletion, backups and rollback | R03 | Restore and privacy walkthrough |
| B02 | P0 | Small invited beta release | Required gates above | Known limitations and recoverable deployment |

For a chat-and-Spaces beta without calls, C01–A01 may remain gated and clearly unavailable. For a release advertised as supporting calls, C01–C03 are mandatory.

### First execution batch

1. Complete R01 and prepare R02 without changing billing automatically.
2. Implement R03 and design D01 in bounded reviewable changes.
3. Finish D03 around the everyday chat experience.
4. Build M01/M02 and S01/S02 before adding more Space decoration.
5. Run the relevant release checks, deploy the reviewable beta and measure again.
6. Proceed to synchronized Spaces, then audio calls; enable each only after its own gate.

Each batch should include its changed behavior, targeted tests, screenshots where useful, deployment evidence and rollback note. Do not run unrelated test suites repeatedly once the relevant checks pass.

---

## 10. Release evidence and scope boundaries

### Required verification matrix

| Scenario | Chat/files | Spaces | Calls |
|---|---|---|---|
| Android Chrome + desktop browser | Send, view, download, voice memo | Join, sync, leave | Two-way audio |
| Two physical phones on different networks | Delivery and push | Drift and reconnect | Answer, hang up, network switch |
| Offline / API restart | Draft preserved, replay once | Fresh snapshot and role recovery | Honest reconnect/end reason |
| Permissions denied | Clear notification/mic guidance | Playback gesture recovery | No false connected state |
| Multiple tabs or devices | No cross-account leakage | Presence remains accurate | One valid accepted call |
| Logout / revoked membership | New access denied | Events and fresh media access stop | Tokens denied; participant removed |
| Large text / reduced motion | Usable composer and media | Readable controls | Accessible call controls |
| 20–30 minute session | Bounded memory | Stable playback lifecycle | No one-way audio or leaked tracks |

Automate state, authorization, pagination and race checks. Use browser walkthroughs for rendering and interaction. Physical-device evidence remains essential for microphone routing, background notifications, network handover and battery behavior.

### Keep out of the first release

- Public social feeds, discovery and large public rooms.
- AI features that add cost without improving the current private-chat need.
- Unlicensed decorative packs or copied branding.
- Streaming-service integrations unsupported by official APIs.
- Recording, screen sharing and large group calls before the core call path works.
- Claims of end-to-end encryption without a complete audited implementation.
- A full framework rewrite or infrastructure migration without measured need.

**Success means the app feels calm and clear, messages arrive reliably, shared rooms remain coherent, and calls carry real audio with trustworthy controls.** Visual polish and technical reliability should reinforce the same promise.

---

## Source and implementation references

### Current KUKU implementation

- [Backend and authorization/signaling](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/backend/server.py)
- [Space room screen](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/frontend/app/space/%5Bid%5D.tsx)
- [Call screen](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/frontend/app/call/%5Bid%5D.tsx)
- [Call lifecycle client](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/frontend/src/CallContext.tsx)
- [Space client](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/frontend/src/spaces.ts)
- [Release execution record](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/docs/RELEASE_EXECUTION.md)
- [Android chat notes](https://github.com/leonartist7/KUKU/blob/163f28bb96ee9ea0c988b6f67ccc5da5d5c73914/docs/ANDROID_CHAT.md)

### Official technical references

- [Render free-service behavior](https://render.com/docs/free)
- [Render pricing](https://render.com/pricing) and [compute plans](https://render.com/docs/compute-plans)
- [Render WebSocket behavior](https://render.com/docs/websocket)
- [LiveKit quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [LiveKit pricing](https://livekit.com/pricing)
- [LiveKit Expo integration](https://docs.livekit.io/home/quickstarts/expo)
- [LiveKit media subscription/rendering](https://docs.livekit.io/transport/media/subscribe/)
- [LiveKit encryption and key-management responsibilities](https://docs.livekit.io/transport/encryption/)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [Android calling notifications](https://developer.android.com/develop/ui/compose/notifications/call-style)
- [Core Web Vitals thresholds](https://web.dev/articles/vitals)

Provider information can change. Source audit findings describe the pinned commit and observed service configuration; performance targets require new measurements during execution.
