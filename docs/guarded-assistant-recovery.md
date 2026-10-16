# Recover a missing signup assistant

Use `POST /api/admin/signups/recover-missing-assistant` only after an operator has approved recovery of one exact verified signup. This endpoint does not finalize signup, buy/import a number, send texts, place calls or modify subscriptions.

Require an authenticated admin session and the saved signed `provisioning` authorization. Never put these credentials in a URL or a report. Supply `signupAttemptId`, the full `expectedPhone`, `confirmation: "RECOVER_MISSING_ASSISTANT_ONLY"`, and an explicit boolean `apply`. Run with `apply: false` first. An eligible preview is not a reusable authorization: every applied attempt checks live inventory again while owning the durable assistant lease.

The server requires:

- An open, identity-verified, business-scoped `setup_error` record matching the signed context exactly, without saved assistant, import, subscription or dashboard number assignments.
- A completed same-context Twilio stage whose SID, number and deterministic business name agree with a complete live Twilio inventory. Any other dashboard record referencing the number blocks recovery, including archived history.
- Complete, successful Vapi assistant and number inventories with no matching assistant name, imported number or deterministic phone name. Existing resources must use normal reconciliation instead.
- A failed assistant stage, no downstream import attempt, no saved assistant result, no invalidation and no previously consumed guarded-recovery receipt.
- At least 30 minutes since the previous dispatch, or the first saved failure if its dispatch timestamp is unknown. Ordinary requests cannot enable recovery by submitting a flag.

The recovery receipt is atomically persisted before dispatch, under the same durable lease used by normal provisioning. It records the admin actor hash, authorization time, previous dispatch marker and inventory confirmation. A second uncertain result remains held; it is not retried automatically, even by the recovery endpoint. Original error evidence is retained. Successful normal replays reuse the verified saved assistant.

After recovery, use the existing signed import step for the same number and assistant. That step runs the protected SMS routing and mandatory delivery tests. Check their actual saved delivery receipts before finalization. Do not clear an incident on assistant creation alone, and do not repeat the entire signup to work around a failed stage.

Regression coverage includes eligibility/ownership failures, authentication, lost responses, settling time, concurrent attempts, single-use receipts, and isolated PostgreSQL multi-process restart drills. External providers are mocked in the PostgreSQL drill; it does not prove live text or call delivery.
