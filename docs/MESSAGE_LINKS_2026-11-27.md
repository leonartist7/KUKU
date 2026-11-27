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

- Tested source `76719e273dc5eb08f9b6e9cad7f564a6cd85aeb0`; [PR #16](https://github.com/leonartist7/KUKU/pull/16) runtime `448dc4dcf54e6ed721851f45789835fdbbb1265d`; exact shared tree `ca5ae6ddf82f5f775dc26d4840d27e3189c6c696`.
- [Run 46059065953](https://github.com/leonartist7/KUKU/actions/runs/46059065953): overall SUCCESS; web acceptance PASS. Backend job 140708611224 passes 163 cases; frontend job 140708610929 passes 180 cases, TypeScript/export and all synthetic browser/performance journeys. Thirteen new unit regressions plus popup, clipboard, context-menu, keyboard, responsive, quiet cached-shell and scroll checks cover the changed behavior. An initial ambiguous quote locator was scoped correctly; later acceptance exposed and repaired scroll timing races. Pixel assertions were retained.
- Android job 140710210722 PASS, including arm64/SDK36/Hermes/public test-signing provenance. [Test artifact 15228089353](https://github.com/leonartist7/KUKU/actions/runs/46059065953/artifacts/15228089353), 39,138,135 bytes; ZIP SHA256 `7b042249cd20bd3198bf553b1a1f5f0c8c789b9146ee34c8a5c6eaed8340c99b`. This verifies compilation/packaging, not physical Android link, clipboard or background behavior.
- Browser artifact 15227409578: 2,507,623 bytes, 54 screenshots/reports; ZIP SHA256 `667c27c4bb6923f027ab0570c71fadbe5c4336b2a9046b7a9916cbc5a6a86b34`. Relevant 390px links and message action sheet were visually inspected. The [durable performance report](performance/2026-11-27-links-controlled.json) records the exact checkout tree, quiet cached-shell privacy checks, bounded rendering/media requests and strict reading-position checks. Fixture results are not real-user latency or physical-device evidence.
- Vercel `dpl_2efvy9D7C3SqE5mHV8emkyFdwg8r` is READY on runtime 448dc4d at https://kuku-9y2ikkugz-lionovart.vercel.app . The [existing beta alias](https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login) points to it; alias UID/access exception preserved. Login/notifications return200 KUKU HTML with the new script; private auth/me and calls/status return401/no-store.
- Backend paths are byte-equivalent to running API `acb29b8bf999ee8950cd41fb31943ff2f893d49b`, Render `dep-dc3cgku7bikc73cq6nkg` LIVE. No API redeploy, migration, hosting/billing, access protection, DNS, main/production or schedule change was made. The prior frontend `dpl_BqQ68z9nL58ScP7yPZv5UdMHgDVv` remains the frontend rollback reference with that same API.
- No real chat content, messages, clipboard data or external destination was used as a fixture. Browser destinations and clipboard values are synthetic. The unchanged dependency inventory still reports 22 advisories (17 moderate/five high); compatibility-tested remediation remains the next maintenance task.

This package changes frontend code and adds only `expo-clipboard ~8.0.8`, the
official SDK54-compatible module, to the dependency lock. Existing dependency entries
are unchanged. The backend contract is unchanged, so a verified frontend can use the
existing API runtime without another API deploy. Calls/native push remain gated;
physical Android link/clipboard behavior needs device acceptance beyond compilation.

References: [React Native 0.81 Linking](https://reactnative.dev/docs/0.81/linking),
[Text](https://reactnative.dev/docs/0.81/text),
[Expo SDK54 bundled modules](https://github.com/expo/expo/blob/sdk-54/packages/expo/bundledNativeModules.json),
[SDK54 Clipboard source](https://github.com/expo/expo/blob/sdk-54/packages/expo-clipboard/src/Clipboard.ts).
