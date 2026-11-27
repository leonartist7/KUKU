# F50 backend usefulness and safety scenarios

Scope: isolated synthetic accounts and database fixtures. No live users, reports,
messages, invitations, storage providers or call media were contacted. Each row is
one scenario, not a claim of ten distinct production bugs. Cloud execution and the
accepted source/run/deployment are recorded by the controller in the F50 checkpoint.

Repairs: a repeated block now remains successful at the 200-contact cap without
changing its date. Block/report mutations recheck the active verified session after
potentially slow authorization/rate-limit reads. Block-list responses recheck before
returning contact names, and unblock rechecks before removing protection. These are
request-boundary checks, not database transactions or instant revocation of bytes
already returned to a client.

| ID | Simulated need or failure | Implementation result | Exact regression in `backend/tests/test_safety_boundaries.py` |
|---|---|---|---|
| B01 | Retry an already saved block when all 200 slots are occupied | Fixed false failure; original date and count preserved | `test_f50_b01_existing_block_retries_at_capacity_without_changing_date` |
| B02 | Add a genuinely new block after reaching 200 | Existing storage limit remains enforced | `test_f50_b02_new_block_still_respects_capacity` |
| B03 | Block request pauses while the session logs out | Fixed late mutation; 401 and no block | `test_f50_b03_b05_slow_block_cannot_mutate_after_account_revocation[logout-401]` |
| B04 | Block request pauses while verification is removed | Fixed late mutation; 403 and no block | `test_f50_b03_b05_slow_block_cannot_mutate_after_account_revocation[verification-403]` |
| B05 | Block request pauses while the account closes | Fixed late mutation; 401 and no block | `test_f50_b03_b05_slow_block_cannot_mutate_after_account_revocation[closure-401]` |
| B06 | Report submission pauses while the session logs out | Fixed late submission; 401 and no report | `test_f50_b06_b08_slow_report_cannot_mutate_after_account_revocation[logout-401]` |
| B07 | Report submission pauses while verification is removed | Fixed late submission; 403 and no report | `test_f50_b06_b08_slow_report_cannot_mutate_after_account_revocation[verification-403]` |
| B08 | Report submission pauses while the account closes | Fixed late submission; 401 and no report | `test_f50_b06_b08_slow_report_cannot_mutate_after_account_revocation[closure-401]` |
| B09 | A block-list read begins with a loaded session that is then revoked | Fixed response disclosure; 401 without target name/ID | `test_f50_b09_block_list_is_withheld_after_loaded_session_is_revoked` |
| B10 | Unblock begins with a loaded session that is then revoked | Fixed stale authorization; 401 and saved block retained | `test_f50_b10_unblock_cannot_remove_protection_after_loaded_session_is_revoked` |

The new file is explicitly included in `backend/pytest.ini`. Local Python syntax
compilation and CRLF-aware diff checks passed. Local pytest/FastAPI/Motor were absent;
no local dependency installation was performed. The cloud suite must execute the ten
cases against isolated Mongo before release acceptance. Existing replay, export,
attachment, Space/call authorization and closure suites remain mandatory. One API
worker and every call/provider/physical acceptance gate remain unchanged.
