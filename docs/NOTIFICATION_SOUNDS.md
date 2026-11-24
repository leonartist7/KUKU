# Notification sounds and small icons

The November 24 notification update keeps the distinction between foreground audio and operating
system alerts explicit. This is not native push configuration or physical Android acceptance.

## While KUKU is open (web)

Settings → Notifications includes seven audible presets, Silent, and one imported WAV per account
on this device. Bright bell, Double knock and Clear signal are more distinct options; the four
existing tones have stronger bounded levels. Low / Medium / High / Maximum retain a 0–1 volume
range. They cannot bypass the phone's media volume, a muted tab or browser autoplay requirements.

WAV import accepts PCM or IEEE-float mono/stereo WAV, at most 1 MiB and five seconds. The actual
RIFF header, chunk bounds, channel/rate/alignment and duration are checked before browser decode.
Decoded audio is checked again, mixed to mono, capped at 48 kHz, normalized with 18% peak headroom
(maximum 16× gain), and faded at both ends. Re-encoding strips embedded metadata. The result stays
in account-specific local storage; it is not uploaded, placed in a chat, or sent with push payloads.
The original file is not retained. Replacing/removing the clip is explicit and saved preferences
survive reload. Failed import preserves the existing selection. Logout, navigation and visibility
cleanup cancel pending or playing audio, including a decode that completes late.

## Background / lock screen

Web push uses Android/Chrome's system notification sound and volume. Browser notification options
do not allow KUKU to substitute an imported WAV. Long-press an actual KUKU notification to open its
Android settings. Media volume and notification volume are separate controls. A local tray test
only checks local display, not server delivery or background acceptance.

The installed Android notification plugin now names a 96×96 all-white transparent small icon.
Native push remains gated off until configured signing/FCM and physical-device testing pass.
Arbitrary imported WAVs are not advertised as native notification-channel sounds.

## Icon assets

A simplified vector pair of KUKU birds is rasterized deterministically without new dependencies.
The status-bar badge uses white RGB on transparent alpha, including antialiased edges; the larger
notification icon retains sage/terracotta on warm white. A larger, crisp version replaces the tiny
favicon, with SVG plus PNG/ICO fallbacks. Web push and the local tray test use separate icon/badge
paths. Public service-worker cache version 8 refreshes these assets without caching private APIs.

## Verification scope

Synthetic tests cover WAV bounds, normalization, silent/invalid audio, account-isolated storage,
removal, late-playback cancellation, preset levels and native/web icon configuration. The browser
journey imports a real synthetic PCM WAV through the file chooser, reloads, tests Maximum volume,
rejects an invalid file without losing the selected sound, and removes the import. Cloud TypeScript,
web export, browser and Android build evidence belongs in AUTONOMOUS_LEDGER.md after acceptance.
No personal messages, real invitations, live push recipients or personal audio are test fixtures.

Official references reviewed November 24, 2026:
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- https://docs.expo.dev/push-notifications/faq/
