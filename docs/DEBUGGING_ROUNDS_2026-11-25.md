# Ten rounds of KUKU improvements and debugging

The user requested ten focused rounds on 25 November 2026. Work started from
`e9427906ca23352b75bd6480dd3cd0317533d83a`; controller lease
`603ab57c4780126af85d54af1f65e0d4f68f2a85` preserves the previous release evidence.
One controller integrates independent file owners. No real chat content, messages,
invitations, provider credentials or phone calls are used as test fixtures.

| Round | Focus | Repair | Regression evidence |
|---|---|---|---|
| 1 | Baseline and API failure recovery | Confirm the existing beta; reject unreadable successful responses instead of silently accepting an empty object; preserve status/session for malformed errors and native uploads | API response tests; direct login/setup/assets 200 and private status 401/no-store before changes |
| 2 | Imported WAV boundaries | Validate exact RIFF extent, chunk padding, one complete data chunk and sample-frame/duration consistency | Malformed length/padding/frame and decoded metadata fixtures |
| 3 | Sound preferences and navigation | Serialize clip writes/removal, settle reads, restore the persisted preference after failed saves, fence focus/account reloads and explain partial import saves | Pending writes, failed saves, focus/late-load and clip-selection regressions |
| 4 | Call media cleanup | Continue cleanup after individual SDK/track failures; release tab ownership; fence late playback to the exact media element | Throwing cleanup and detached/replaced element regressions |
| 5 | Honest call setup | Clear stale configuration success on retry and stop every microphone track even if one stop throws | Microphone cleanup unit test; configured → failed refresh browser journey |
| 6 | Chat recovery | Coalesce overlapping recovery requests and preserve a newer retry after a failed pass, within the account scope | Pending/failed resolve and account-loss regressions |
| 7 | Chat action clarity | Explicitly review the latest revision before retrying removal; invalidate pending original-message panels on action/reply transitions | Conflict action and pending-panel regressions |
| 8 | Attachment sharing authorization | Reject attachment references on non-media messages; only active owner-authored media proves sharing | Forged text/Space references and tampered/removed sharing-proof fixtures |
| 9 | Authorization across slow storage I/O | Recheck session, verification, membership and block status across upload streaming/provider write; withhold new R2 grants after access loss | Synthetic revocation during body/write/presign with cleanup/quota assertions |
| 10 | Private voice/file lifecycle | Bind playback and confirmation actions to account/session/focus/resource identity; clean up late web/native resources and stop revoked playback | Deferred loads, resource cleanup, stale confirmation and playback regressions |

## Acceptance

All ten rounds are implemented, independently reviewed, cloud verified and deployed to the existing beta.

- Tested source: `70ed5ec457c5b23937dce7c163ccb4ecb7259b64`; [PR #15](https://github.com/leonartist7/KUKU/pull/15) runtime merge: `acb29b8bf999ee8950cd41fb31943ff2f893d49b`. Exact shared tree: `dbfcd28c8d7f29e0173168870abba84a97c3e45a`.
- [Run 45605352739](https://github.com/leonartist7/KUKU/actions/runs/45605352739) SUCCESS: 163 backend cases (job 139174691127), 167 frontend cases (job 139174690746), TypeScript/export and all onboarding/WAV/call-setup, Spaces, chat-tools and controlled-performance journeys. Forty-five regression cases were added. Initial acceptance caught a web/native typing issue and a fixture control-scope mistake; both were corrected before this successful source. No acceptance gate was skipped.
- Android job 139176519049 SUCCESS. [Test artifact 15019095965](https://github.com/leonartist7/KUKU/actions/runs/45605352739/artifacts/15019095965): 39,095,899 bytes; ZIP SHA256 `3b34fb3e92477b4730dfd292cb489afa956cd2d435accfb9f333f0096eed835c`. Arm64, SDK36, Hermes and public test-signing provenance verified; physical phone behavior remains unverified.
- Browser artifact 15018230508: 51 screenshots and performance/audit reports; ZIP SHA256 `c29da501980046ba9028e3452c32902c287f2d0048cf72e7697fbe11b2b33b3a`. Relevant narrow WAV/setup and failed-status-refresh screenshots were inspected. The controlled report is persisted in [performance/2026-11-25-debugging-controlled.json](performance/2026-11-25-debugging-controlled.json).
- API-first rollout: Render `dep-dc3cgku7bikc73cq6nkg` LIVE on runtime `acb29b8`, finished 2026-11-25T11:38:00.553134Z; then matching Vercel `dpl_BqQ68z9nL58ScP7yPZv5UdMHgDVv` READY. [Existing beta](https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app/login), alias UID/access exception preserved. Direct health 200/ok; direct and proxy private routes 401/no-store; login/notifications/call-settings 200 with KUKU HTML/favicon v8. A bounded post-rollout application-error query returned zero rows.
- Main, provider protection, billing, one API worker/manual free Render service and native/call flags are unchanged. No live data migration or personal-content testing occurred.

## Next maintenance and limitations

The existing runtime dependency inventory reports 22 advisories (17 moderate, five high); no manifest/lockfile was changed. See [the durable summary](performance/2026-11-25-dependency-audit-summary.json) for advisory links and reported fixes. Dependency graph inventory is not reachability analysis. Compatible remediation and web/Android verification are the next independent maintenance package. A forced Expo upgrade/downgrade is not accepted evidence.

Official advisory examples verified on 25 November 2026: [decode-uri-component](https://github.com/advisories/GHSA-qr28-fpjm-wq7f), [image-size](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [PostCSS](https://github.com/advisories/GHSA-r28c-9q8g-f849). The notification/call/privacy repairs do not establish that the complete dependency graph is vulnerability-free.

All synthetic checks establish their exercised behavior only. Calls and native push
stay off. LiveKit configuration, physical two-phone audio/Android notification tests,
production signing and existing backup/retention gates remain separate. R2 grants
already issued retain their existing 60-second expiry; this pass does not add
retroactive provider revocation. No billing, production/main, DNS, access-protection,
live retention or schedule changes are authorized by this checkpoint.

## Rollout and rollback

Deploy the accepted API first, then the matching frontend to the existing review
alias. Previous runtime `d26103a6d706d3dfbc1e946484f66cc7e342981f` and Vercel
`dpl_Fgng4tQBTtjPZvbxRtSEgi5YiMGB` form the prior compatible pair. These changes do
not require a database migration. Prefer a forward repair for any privacy regression;
rolling back would reopen the attachment authorization issue repaired in this pass.
