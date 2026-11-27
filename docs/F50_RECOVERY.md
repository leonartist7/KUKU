# F50 queued-message usefulness scenarios

These ten controlled simulations use in-memory synthetic accounts and durable
storage mocks. Each row maps to an executable case in
`frontend/tests/outbox-usefulness.unit.cjs`. They are not physical device tests or
ten distinct bug claims.

| ID | Everyday need / interruption | Result |
|---|---|---|
| R01 | Remove a later queued message while an earlier send is slow | Fixed: re-read the saved queue before dispatch; removed item does not send |
| R02 | Clear a queue while its first send is pending | Fixed: later snapshot entries cannot escape the cleared queue |
| R03 | Log out while a send is pending | Confirmed: no subsequent dispatch; remaining item retained |
| R04 | A view subscriber throws after a queue write | Fixed: successful disk write stays successful and healthy subscribers still run |
| R05 | Restart after a lost send acknowledgement | Confirmed: retry retains the original durable ID |
| R06 | One queued item is permanently forbidden | Confirmed: failed item is visible and later valid items proceed |
| R07 | Lose the network before the first acknowledgement | Confirmed: original order and queued state remain |
| R08 | Deliberately retry a failed item | Confirmed: clear old error and retain ID |
| R09 | Reach the 100-message queue limit while another account has a queue | Confirmed: actionable limit; account queues remain separate |
| R10 | Trigger two flushes and use a chat identifier containing reserved characters | Confirmed single dispatch; fixed encoded URL path segment |

Cancellation can stop future dispatch. It cannot recall a request already sent to
the server. Lost acknowledgements still use backend idempotency; this change does
not promise message recall or guaranteed delivery while offline. No queue migration
or live user data was used. Source/run/deployment acceptance is recorded in the
controller's F50 checkpoint.

Before integration, all ten cases and the 15 existing release cases passed locally
with a standalone pinned TypeScript 5.9.2 compiler; no app dependency tree was
installed. The existing account restoration, API response, realtime and export
suites also passed (40 cases), including quiet startup, server-proof gates,
cross-account responses, explicit restore retry, malformed responses and cancelled
exports. These supporting checks are separate from the 50 numbered scenarios.
