# Clickable messages and quiet startup

User request, 27 November 2026:
- Sent web links should be clickable.
- Pressing a message reveals its actions; remove the permanently visible message dots.
- Opening KUKU should not announce routine reconnection.

## Behavior

HTTP(S) and `www.` links retain their original text, with punctuation outside the
click target. Web anchors open a separate tab with `noopener noreferrer`; Android
uses the system link handler. No link preview, tracking fetch or automatic remote
request is added. Script/data/file/custom schemes, malformed addresses, bidi controls
and embedded credentials are not made actionable.

Tap message text or its time to open options; emotes can be pressed too. Images,
files and voice controls keep their primary interactions, with options on the time.
Right-clicking a web link opens message options. The menu adds Copy text and up to
five unique Copy link choices. Copy is user-initiated, uses SDK54-compatible Expo
Clipboard and does not read the clipboard; failure never reports successful copying.
The timestamp remains a keyboard/screen-reader accessible action with an expanded
hit area, without a visible dots icon.

Reading older messages also cancels delayed tail jumps on real wheel, pointer and
scroll-key intent. Prepend recovery ignores virtualizer-generated scroll events, uses
monotonic settling time and preserves the anchor through window compaction. The
chat DOM target is scoped to the current account/conversation. Browser fixtures
issue real wheel input before their exact reading positions; pixel checks remain strict.

Normal cached-profile restore has no reconnecting banner. Authentication still
requires server proof before private requests/background operations. Genuine restore
failure retains a visible retry, including a failed sign-out during pending restore.
Startup and settings copy is quieter; the chat subtitle retains real offline guidance.
The free API service may still take time to wake; no hosting/billing change is implied.

## Verification and rollout

Pending cloud TypeScript/unit/export, synthetic browser link/popup/copy/context-menu,
responsive chat and cached-shell isolation checks, plus Android standalone build.
No real chat content, messages, clipboard data or external destination is used as a
fixture. Browser destinations and clipboard values are synthetic.

This package changes frontend code and adds only `expo-clipboard ~8.0.8`, the
official SDK54-compatible module, to the dependency lock. Existing dependency entries
are unchanged. The backend contract is unchanged, so a verified frontend can use the
existing API runtime without another API deploy. Calls/native push remain gated;
physical Android link/clipboard behavior needs device acceptance beyond compilation.

References: [React Native 0.81 Linking](https://reactnative.dev/docs/0.81/linking),
[Text](https://reactnative.dev/docs/0.81/text),
[Expo SDK54 bundled modules](https://github.com/expo/expo/blob/sdk-54/packages/expo/bundledNativeModules.json),
[SDK54 Clipboard source](https://github.com/expo/expo/blob/sdk-54/packages/expo-clipboard/src/Clipboard.ts).
