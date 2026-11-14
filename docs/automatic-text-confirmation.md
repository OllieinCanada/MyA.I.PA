# Automatic confirmed-call texts (candidate, default off)

The authenticated Vapi `tool-calls` path can admit an owner summary and caller confirmation automatically after current conversational permission to **send**, not merely save a draft. Model approval flags, recipients and business labels are not authority. Exact server-owned business, assistant, phone, open-signup and lifecycle checks must agree. Missing conversation, refusal, correction, ambiguous identity, suppression or ineligible service refuses admission.

The existing durable call/sender/recipient-role claim commits before provider submission. Changed context, simultaneous requests, repeated tool IDs and fresh workers cannot reopen it. Unknown outcomes are held, not retried. This is at-most-once admission, not guaranteed delivery; a crash after admission but before submission can leave an unsent message held.

Both dispatch and automatic-notification flags must be explicitly enabled, and an exact numeric business must be opted in. Defaults are off/empty. Preparing a function-tool definition is a pure operation, not a provider migration. The assistant's authenticated server must supply the conversation artifact and ask permission to send. Blocked caller-ID/spoken-number migration and model-extracted request correctness remain separate requirements. No expired-account exception is included.

## Outcome evidence

Owner and customer have separate accepted/not-sent/unknown alerts. Accepted means provider acceptance, not physical delivery. Alerts appear in structured redacted logs and existing admin call details. The authenticated admin outcome GET reads only existing claims and saved authenticated status receipts: no provider requests, claim resets, sending or automatic replay. Missing message IDs, conflicting/malformed receipts and store failures cannot prove delivery. Legacy claims without automatic-admission metadata are outside the endpoint's scope, not assumed healthy. These alerts do not themselves send Telegram/email messages.

## Verification

`npm run test:automatic-call-notifications` uses fictitious data, modeled transactions, actual authenticated localhost handlers and fake provider transport. It is not real database or phone-delivery proof. `npm run test:automatic-call-notifications:postgres` requires explicit opt-in to the existing disposable CI database; the workflow runs it after the fresh-database crash drill. Its real SQL tests cover admission concurrency, rollback, commit acknowledgement loss, fresh clients, receipt persistence failures, lock-wait revocation, conflicts and zero-write inspection. Routing context is injected in that SQL fixture; actual handler/context-reader integration is separately covered by HTTP tests. Neither proves live readiness.

Before release: require clean locked dependencies, full CI/review, real disposable SQL results, source-bound artifacts and a reviewed assistant migration. Any merge/deployment, runtime opt-in, billing change or live controlled test needs separate authorization. Never resolve an unknown send by guessing or blindly resending.
