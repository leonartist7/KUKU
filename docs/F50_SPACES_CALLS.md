# F50: Space audio and call-readiness simulations

Source baseline: `f6f9ab864b9ef2fb7af2e8ada5269b892b5ab317` (the application tree from the prior L01 release). All media, providers, users, events and failures below are synthetic. No real call, family message or personal content was used.

Nine SpaceAudio component scenarios execute the actual transpiled component with a minimal React/player lifecycle harness. The tenth exercises the actual call-readiness presenter. This is deterministic lifecycle and interface evidence, not an audible or physical-device check.

| ID | Everyday use / failure simulation | Result | Exact regression evidence |
|---|---|---|---|
| S01 | Tap Join playback, then the host selects another track before play resolves | FIXED: old success cannot label the new track as playing | `late Join playback success cannot mark a replacement Space track as playing` |
| S02 | Same replacement, but the old play request rejects late | FIXED: old rejection cannot show Join playback on the replacement | `late Join playback rejection cannot block a replacement Space track` |
| S03 | Host pauses while a member's Join playback request is pending | FIXED: immediately pause when that pending play finishes | `host pause while Join playback is pending pauses the acquired player on completion` |
| S04 | Host pauses during pending automatic play | FIXED: recheck current host state after play completion and pause | `host pause while automatic playback is pending does not leave audio running` |
| S05 | Both old and replacement tracks have pending play; the old request finishes first | FIXED: per-effect busy ownership prevents overlapping replacement play attempts | `old synchronization completion cannot unlock a replacement player busy with its own play request` |
| S06 | Leave a web player whose pause method throws | FIXED: still clear source, callbacks and loaded resource | `web Space cleanup still clears the media source when pause fails` |
| S07 | Leave a native player whose listener removal and pause both throw | FIXED: still remove the native player | `native Space cleanup releases player even when listener removal and pause fail` |
| S08 | Private audio grant fails with a signed provider URL in its error text | FIXED: controlled guidance with Reopen audio; no provider URL/ticket rendered | `private Space audio failures do not expose provider links or credentials` |
| S09 | Private-audio URL arrives after content replacement | PASS: the previous existing cancellation guard prevents stale player construction | `private audio resolved after content replacement cannot create a stale player` |
| S10 | Client/server call flags are enabled but secure provider configuration is incomplete | FIXED: presenter says Setup still needed, never Enabled for testing | `client and server flags cannot advertise test calling while secure setup is incomplete` |

Validation on 28 November 2026:

- Targeted command: `NODE_PATH=/tmp/kuku-f50-tooling/node_modules node --test tests/space-audio-lifecycle.unit.cjs tests/call-readiness.unit.cjs tests/spaces.unit.cjs tests/calls.unit.cjs` from `frontend`: **50 passed, zero failed**. This is the domain's full selected suite count; the F50 scenario contribution is the ten rows above.
- Before/after confirmation: injected the unchanged baseline SpaceAudio source into the exact nine new component tests without modifying the working source. Eight tests failed before the repair; the existing late-private-result guard passed. The repaired component passes all nine.
- Full cloud TypeScript/export/browser/Android validation and deployment are the root controller's integration gate, not asserted by this domain note.
- `git -c core.whitespace=cr-at-eol diff --check` passes.

Changed application files: `frontend/src/SpaceAudio.tsx`, `frontend/src/callReadiness.ts`. Added `frontend/tests/space-audio-lifecycle.unit.cjs`; appended one case to `frontend/tests/call-readiness.unit.cjs`.

No provider API contract, dependency, playback cadence or authorization path changed. Calls stay off. LiveKit configuration, actual two-phone audio quality, Android audio routing, background behavior and real Space drift remain external acceptance gates. The native cleanup scenario is a mock; it does not establish physical Android behavior. No end-to-end encryption claim is made.
