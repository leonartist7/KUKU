# Android browser chat features

Android Chrome can use browser push after the member opens You > Notifications (or the chat header bell), taps Enable and accepts Chrome's notification permission. Installation through Chrome > Add to Home screen is optional. The browser and Android notification settings still control delivery; no phone-display acceptance is implied by a provider acknowledgement.

The backend requires WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY (a matching P-256 VAPID key pair; private key is base64url DER or raw scalar). Store the private key only in Render environment settings. Native Expo push remains separately gated by its existing credentials. Never regenerate VAPID keys on deployment: existing browser subscriptions depend on the matching public key.

Subscriptions accept only approved HTTPS push provider hosts and correctly sized keys. They bind to a verified account and active session. Logout removes registrations; the service worker checks the current account before displaying or opening an alert. Previews contain no sender, message text, or filename. Delivery retries reuse message tags; no end-to-end encryption is claimed.

Voice memos record real microphone bytes, offer a local preview and re-record option, upload privately and send through the account-bound message outbox. Recordings are limited to five minutes and 10 MiB. The server accepts supported audio container signatures and requires a voice attachment before accepting a voice message; declared duration is bounded metadata, not a decoded measurement. Playback fetches authorized bytes into a temporary local player; it never exposes private provider URLs. Cancel, navigation and backgrounding stop browser microphone tracks. Upload failures keep the draft available for retry while the composer remains open; unsent recordings are not persisted across a reload.

Release evidence: frontend unit checks include service-worker account isolation and safe click handling. Backend checks cover voice bytes/authorization/duration and browser subscription restrictions/logout/recipient privacy. The cloud browser walkthrough uses a synthetic microphone and provider routes, verifies actual encoded recording bytes, playback and mobile layouts. Physical Android notification display and microphone quality still require acceptance on the recipient's phone.

The API proxy allows up to 90 seconds for the free backend to wake, within a 120-second function limit. This reduces startup timeouts; it does not make free hosting always-on.
