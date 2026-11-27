# Secure audio calling — readiness and acceptance

The November 24 call package improves the real media path but does not enable calls or claim
physical phone acceptance. Calls remain web-only while the installed Android media integration is
prepared. No test in this package places a live call or sends a notification to a real person.

## Implemented

- Creation, acceptance, token issuance and provider removal require a secure root-level `wss://`
  DNS endpoint. Credentials, query/fragment, alternate paths, IP/localhost and malformed authority
  forms are rejected. The browser validates before loading the SDK or using a token.
- Verified-account `GET /api/calls/status` exposes configuration booleans and reason codes only.
  It never returns keys, secrets, URLs, tokens, users or call history, and it never contacts LiveKit.
  One redacted startup log uses the same status for an operator to diagnose setup safely.
- The pinned LiveKit client uses mono Opus speech at 24 kbps, DTX and RED, and requests browser echo
  cancellation, noise suppression and automatic gain control. Device/browser support varies.
- Local and expected remote participant quality are separate: unknown, excellent, good, poor or
  lost. Outsider events are ignored. Lost transport suspends the media-ready state; reconnect,
  remote disconnect and disposal clear stale audio and feedback.
- Remote microphone mute and subscription failure are distinct from bad signal. Browser autoplay
  recovery stays explicit. Signaling acceptance does not start the media-connected timer.
- You → Calls shows setup status without placing a call. Check microphone access asks permission
  and immediately releases every acquired track, including a late grant after leaving the screen.

## Encryption and quality

The WebRTC transport is encrypted; a secure endpoint is required. This is not an end-to-end
key-management implementation and must not be called E2EE. Speech settings and reconnection improve
resilience but cannot guarantee mobile signal, packet loss or a particular microphone/speaker.
No physical Android, Bluetooth, locked-screen/background ringing or measured call-quality pass is
established by synthetic fixtures or cloud browser media doubles.

## External setup and controlled acceptance

Keep `ENABLE_CALLS=false` and `EXPO_PUBLIC_ENABLE_CALLS=false` for the general beta. Add only the
server-side LiveKit project URL/API key/API secret through Render's Environment page; never paste
secrets into a chat, repository, frontend setting or public build. Inspect redacted readiness first.
A controlled two-phone test configuration must be reviewed separately before general enablement.

With a configured project and the controlled test build, two people should test Android Chrome on
different networks: answer/decline, caller cancellation, denied mic permission, mute/unmute,
speaker/headphones/Bluetooth, Wi-Fi↔cellular, temporary disconnect/recovery, either side hanging
up, logout and two-tab ownership. A 20–30-minute session must have audible audio both ways and no
microphone left running afterward. Record actual device/browser/network and pass/fail results.

Native FCM/incoming-call integration, production signing and video remain separate gates. Do not
change DNS, protection, billing or worker count to make a mocked test look ready.

## Verification

Synthetic backend tests cover secure configuration, verified/secret-free diagnostics and pending
revocation when secure provider removal cannot run. Frontend tests cover token destination safety,
speech options, participant-scoped quality/mute/subscription errors, lost/reconnect/disconnect
readiness and cleanup races. The setup UI's fake-device browser journey is not real media evidence.
Exact-source cloud counts/deployment IDs belong in AUTONOMOUS_LEDGER.md after acceptance.

Official sources reviewed November 24, 2026:
- https://docs.livekit.io/transport/encryption/
- https://docs.livekit.io/intro/basics/connect/
- https://github.com/livekit/client-sdk-js/tree/v2.23.0/src
