# Launch evidence requirements

The shipping report separates local preparation and models from provider, application, recovery and human approval evidence. Missing or stale proof keeps launch closed; a red gate can mean incomplete or outdated evidence, not a newly detected production outage. Run `npm run report:shipping-readiness` for the current assessment. Set `READINESS_RELEASE_COMMIT` to the exact release being assessed; otherwise the report uses the local Git head. Unconfirmed or mismatched release identity cannot pass the release-bound gates below.

Do not hand-edit a result to mark a gate passed. A producer must record actual checks with their timestamp, scope, exact release, sanitized supporting evidence and failures. Each required named check must appear exactly once with `passed: true`. The predicates in `scripts/launch-evidence.js` define the accepted contracts; predicates do not perform the underlying exercise or authenticate human approvals.

## Local preparation and simulations

- `backup-readiness.json` establishes tools/configuration only. It cannot satisfy restoration.
- `privacy-request-drill.json` is a standalone policy model, not application or provider deletion proof. Its suppression-removal example is not an approved production erasure policy.
- `stripe-local-simulation.json` exercises the actual billing helpers with a mocked SDK. Five consecutive cycles must individually verify cancellation, retry safety, terminal-state handling and late setup rejection. The old unexecuted `cancellationSupported` flag is insufficient.

Run `npm run test:recovery-readiness` for no-provider safety and regression tests. No command in that suite buys a number, creates Stripe objects, starts a production restore or sends messages.

## Recovery proof

The `logical_restore` gate reads `diagnostics/provider-hardening/restore.json` with scope `logical-database-only`, or `restore.json` in the exact directory selected by `READINESS_RECOVERY_DIRECTORY`. It requires an exact-release/execution identity, encrypted artifact digest, actual production-logical-export restoration, validated object policy, archive checksum/readability, table counts, constraints and sealed workers/dispatch. The prepared wrapper saves its bound result beside its plan. Set `READINESS_RECOVERY_DIRECTORY` to that directory when assessing it; the child's older shared output is not bound proof. Do not rerun a restore merely to fit the report's file layout. Independent operators' evidence needs an explicitly reviewed adapter, not invented fields or a forced pass.

The separate `full-recovery-gate.json` requires scope `database-disk-keys`, owner-approved measured recovery-time/data-loss objectives and checks for database restoration, disk reconciliation, key custody, a consistent recovery point, deletion replay, sealed dispatch and safe cutover rehearsal. A logical restore, even successful, cannot satisfy this gate. See `BACKUP_RESTORE_RUNBOOK.md`.

For an already completed independent rehearsal, `npm run ops:backup:record-independent -- --summary=SANITIZED_SUMMARY --execution=SANITIZED_EXECUTION --commit=FULL_COMMIT --out-dir=NEW_EVIDENCE_DIRECTORY --confirm=RECORD_REVIEWED_LOGICAL_RESTORE` verifies matching source/release/execution, digest, counts, integrity, isolation, check ordering and cleanup before recording logical-only evidence. It hashes both input records and requires restoration evidence less than 24 hours old. Readiness uses the actual restoration timestamp; reconciliation/review time is recorded separately and cannot refresh an old test. It performs no network request, backup download or restore. This reconciles reviewed operator records; it does not cryptographically attest their truth or infer disk/key recovery. Legacy TOC-screen-only evidence is explicitly marked `schemaSqlReviewed: false`, not upgraded to SQL/OS sandbox proof. Select its new output directory with `READINESS_RECOVERY_DIRECTORY` for the shipping report.

## Stripe provider and application proof

`stripe-trial-gate.json` accepts only scope `provider-api-test-only`, exact release, test mode, zero real payments and five complete cycles. Each must show no-card pause, activation, a paid renewal and effective period-end cancellation. The declined-card case and every temporary test-clock cleanup must succeed.

The provider script defaults to no-network dry run. Operational execution requires a separately authorized test environment, explicit `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_PRICE_ID`, `--apply --confirm=RUN_STRIPE_TEST_CLOCKS --commit=FULL_COMMIT`. Production-key/price fallbacks are removed. Do not add test secrets to the production service. Failed or unconfirmed cleanup leaves the gate failed and requires an operator to inspect the exact test resources; do not blindly rerun it.

Direct provider requests do not exercise hosted Checkout or signed application webhooks. `stripe-checkout-gate.json`, scope `isolated-stripe-checkout-webhook`, separately requires hosted test Checkout completion, a verified application webhook, customer/subscription ownership, duplicate and late-event safety, invoice-failure handling and preserved cancellation. Do not test by charging a real customer.

## Privacy and alert proof

`privacy-application-gate.json`, scope `isolated-application-privacy`, must exercise actual handlers on synthetic data: tenant-scoped access, correction, withdrawal, deletion, other-tenant preservation, restore replay, retained suppression, legal holds and audit redaction. No production data or external-provider mutations are permitted for this isolated gate. Provider-held deletion/retention review remains an additional accountable operational requirement.

`alert-delivery-gate.json`, scope `controlled-private-alert`, requires an authorized private incident, provider acceptance, recipient-confirmed receipt, duplicate prevention and no customer impact. A configured monitor, accepted API request or local outbox test is not recipient receipt. This contract does not authorize an alert or activate deferred external monitoring.

## Human approvals

`legal-approval-gate.json`, scope `owner-counsel-approval`, requires zero unresolved placeholders and explicit owner/counsel approval of legal identity/contact, privacy officer, retention, processor dispositions, privacy procedures and customer disclosures. Structural document validation is not legal approval. Obtain the facts and approval records from the responsible people; do not generate them from assumptions.
