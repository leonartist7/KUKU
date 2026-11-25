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

Implementation and review are in progress. The final accepted source, cloud checks,
test counts, Android artifact, compatible beta pair and rollback reference must be
recorded here and in AUTONOMOUS_LEDGER.md before this checkpoint is complete.

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
