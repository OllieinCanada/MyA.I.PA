# My AI PA Legal and Operational Readiness Checklist

Last updated: August 26, 2026
Status: internal QA only; the first external controlled pilot is not yet a go

This checklist separates controls implemented in the repository from facts and approvals that only an authorized person, provider dashboard, accountant, or qualified Canadian lawyer can complete.

## Implemented locally

- [x] Public liveness endpoint at `/api/health`.
- [x] Database-aware readiness endpoint at `/api/health/ready`.
- [x] Render health checks target the database-aware endpoint.
- [x] Call transcript and recording URL retention defaults are 30 days.
- [x] Scheduled application cleanup clears expired transcript text and recording URLs.
- [x] `npm run ops:retention:audit` reports expired artifacts without printing personal information.
- [x] Retention apply mode is locked behind the explicit `RETENTION_APPLY_CONFIRM` value.
- [x] `npm run ops:monitor` checks the public site, API liveness, and database readiness.
- [x] Failed production monitoring can send a Telegram alert only when explicitly invoked with `--telegram-on-failure`.
- [x] The scheduled GitHub production monitor rechecks failures before alerting and can include privacy-minimized operational issue counts.
- [x] The admin Needs Attention inbox combines signup, payment, call handoff, text-delivery, routing, and high-priority support failures with guarded recovery actions.
- [x] Admin recovery and login actions are written to a redacted PostgreSQL-backed audit trail with automatic retention.
- [x] Optional TOTP multi-factor authentication disables password-header bypass when configured.
- [x] `npm run ops:backup` creates an AES-256-GCM encrypted PostgreSQL custom-format backup, verifies its archive structure, and writes a SHA-256 manifest.
- [x] `npm run ops:backup:restore-drill` verifies checksum, decryption, and archive readability and refuses production as a restore target.
- [x] Backup output and operational diagnostics are excluded from Git.
- [x] Runbooks exist for retention/deletion, backup/restore, monitoring, incidents, privacy requests, and counsel review.
- [x] Central SMS suppression, signed inbound STOP/START handling, fail-closed send checks, and provider-neutral dashboard visibility are implemented and tested locally.
- [x] Local and GitHub release gates validate the operational controls on every release.
- [x] Legal drafts remain private, marked as drafts, and excluded from the public repository.
- [x] Admin browser authentication uses an HttpOnly session cookie instead of retaining the master password in browser storage.
- [x] Customer support-report submission has a dedicated rate limit and cannot escalate severity from customer-supplied analysis.
- [x] The Render blueprint disables external Postgres access and uses the same-region private database connection.
- [x] A sanitized credential-readiness audit is available with `npm run audit:credential-readiness`.
- [x] Production Postgres external access is disabled (`ipAllowList: []`) and database-aware readiness still returns HTTP 200.
- [x] Dashboard one-time codes, security rate limits, and webhook replay claims have PostgreSQL-backed release-candidate implementations and regression tests.
- [x] A fail-closed Vapi mapping audit is available with `npm run audit:vapi-business-mappings`.
- [x] A review-only signup harness verifies health, readiness, admin visibility, and the absence of external provisioning identifiers.
- [x] A privacy-minimized 60-day Vapi call-playbook audit identifies repeated questions, closing failures, business-name drift, and notification-tool failures without retaining transcripts, recordings, full caller numbers, or raw call identifiers.
- [x] Private-demo regression suites cover every documented First Class Rentals emergency, urgent, and routine route plus Dean-demo identity, consent, sensitive-data, neutrality, emergency, and official-delivery safeguards.
- [x] Owner/customer notification routing, suppression, failure isolation, protected destinations, and webhook replay prevention are covered by the backend release gate.
- [x] Runtime, browser, fatal-process, signup, support, and production-monitor incidents have one privacy-minimized Telegram brief format with a durable local outbox and exact admin deep links.
- [x] The signup result only claims a trial is active when Stripe confirms a real `trialing` subscription; assigned phone numbers alone fail closed with a billing warning.
- [x] Customer dashboards prefer a persisted business ID, then an exact assigned-number mapping, and refuse ambiguous legacy name/phone matches.
- [x] The legacy owner-SMS result route no longer defaults missing routing to Business 1 and rejects missing, invalid, unknown, or conflicting tenant context.

## Current pilot audit (August 26, 2026)

- [x] `npm run test:release -- --skip-pages` passes: backend and frontend tests, legal/transparency validators, secret scan, Render/backend/Prisma checks, signup diagnostics, and the production dependency audit.
- [x] The public site, API liveness endpoint, and database-aware readiness endpoint return healthy responses.
- [x] The GitHub production monitor is enabled, has the three required secrets, and is completing scheduled checks successfully.
- [x] The local pilot-hardening candidate passes the full backend suite, focused signup rendering regressions, production build, operational validator, and tracked-secret scan. These fixes are not production evidence until reviewed and deployed.
- [ ] The Vapi mapping audit is not ready: 7 of 13 attached phone records do not have a provable business mapping. The selected pilot line must be mapped explicitly; ownership must never be inferred from an assistant name.
- [ ] The Twilio audit needs remediation or bounded pilot evidence: 124 of 733 outbound messages in the 30-day sample were failed/undelivered, 3 SMS-capable numbers bypass the My AI PA consent route, 10 Vapi SMS tools have no delivery-status callback, and no approved compliance profile was found.
- [ ] The Make audit found 9 high-risk gaps across 3 scenarios, including PII execution-history retention, one unauthenticated PII-bearing HTTP request, missing error routes, and an inactive provisioning scenario with no visible durable idempotency guard.
- [ ] Backup readiness cannot be evidenced from this workstation: the production database URL, PostgreSQL dump/restore tools, and backup encryption configuration are unavailable locally.
- [ ] A real alert-failure exercise has not yet proved Telegram delivery and the exact-incident admin link end to end.

## Required before the first external controlled pilot

- [ ] Name one pilot business, owner contact, assigned My AI PA number, forwarding number, permitted testers, start/end dates, and whether the pilot is free or paid.
- [ ] Prove that exact pilot number, Vapi phone ID, assistant ID, and database business ID all map to the same business; all ambiguous routing must fail closed.
- [ ] Put the pilot number on the My AI PA consent route and delivery callbacks, then complete one authorized owner/customer SMS delivery test plus `STOP`/`START` verification.
- [ ] Complete one authorized inbound AI-number call and one missed-call-forwarding call covering disclosure, intake, safety routing, owner handoff, customer confirmation, dashboard visibility, call termination, and cost attribution.
- [ ] Deploy the reviewed incident-alert changes and run one controlled failure exercise that proves the Telegram reason, redacted snapshot, and exact admin incident link.
- [ ] Produce an encrypted database backup and complete an isolated restore drill before storing real pilot customer/caller data.
- [ ] Keep signup on manual approval. Do not present the service as live until phone ownership, Vapi mapping, both SMS routes, trial/billing state, and the smoke-call evidence are all verified.
- [ ] Have the pilot agreement, privacy notice, call disclosure, messaging consent language, support contact, deletion process, and provider/data-handling decisions reviewed by an accountable owner and qualified Canadian counsel.

## Required before a paid external pilot

- [ ] Confirm the full legal entity name, form, jurisdiction, registration number, mailing address, and trade name.
- [ ] Appoint a Privacy Officer in writing and provide a monitored privacy contact.
- [ ] Verify that `hello@myaipa.com` is controlled and monitored or replace it everywhere with the approved contact.
- [ ] Have qualified Canadian counsel approve the Privacy Policy, Terms, DPA, customer acknowledgement, call notice, messaging templates, and launch jurisdictions.
- [ ] Have an accountant confirm financial and tax record categories and retention.
- [ ] Confirm every live provider, legal name, role, processing location, DPA, retention, deletion mechanism, subprocessor list, and incident commitment.
- [ ] Verify the production Render database is a paid instance with recovery enabled and record the actual PITR window.
- [x] Apply the reviewed database external-access restriction and verify the API continues to use Render's internal database URL.
- [ ] Create an encrypted logical database export and complete an isolated restore drill.
- [ ] Select protected backup storage and approve access, encryption, residency, retention, and deletion.
- [x] Add the three GitHub monitor secrets and enable the scheduled workflow.
- [ ] Test a real failure alert and retain evidence of Telegram delivery and the exact admin deep link.
- [ ] Verify provider-side deletion for Vapi, Twilio, OpenAI, Make, Render logs, Stripe, email, and any monitoring service.
- [x] Activate the production messaging webhook and complete one authorized live `STOP`/`START` exercise using `ops/SMS_CONSENT_RUNBOOK.md` (controlled provider-path exercise completed July 24, 2026; all nine active routes read back successfully and the test number finished active).
- [ ] Complete a privacy incident tabletop exercise and retain its signed report.
- [x] Complete one privacy access/correction/deletion exercise using synthetic data (`npm run ops:privacy:drill`; local evidence excludes personal information).
- [ ] Configure Turnstile and test valid, missing, expired, and replayed challenges before public signup promotion.
- [ ] Confirm or decommission seven Vapi phone/assistant pairs that currently have no provable customer mapping. Do not infer ownership from assistant names.
- [x] Complete a review-only production signup with no external telephone, agent, customer, subscription, or checkout resource created.
- [ ] Complete two authorized end-to-end sandbox signups covering both supported paths, dashboard data, texts, cost allocation, consent, and cancellation.

## Repeatable commands

```text
npm run legal:validate
npm run ops:validate
npm run ops:retention:audit
npm run ops:privacy:drill
npm run ops:backup:check
npm run ops:monitor
npm run audit:credential-readiness
npm run audit:vapi-business-mappings
npm run audit:vapi-2026-readiness
npm run audit:vapi-release-safety
npm run audit:twilio-2026-readiness
npm run audit:make-2026-readiness
npm run audit:live-phone-dependencies
npm run test:signup-sandbox:dry
npm run render:validate
npm run backend:check
npm run test:backend
npm run test:release -- --skip-pages
```

Use `LEGAL_DRAFTS_DIR` when validating the private legal package from a checkout where it is intentionally absent.

## Approval rule

Repository checks do not establish legal compliance. Do not claim “PIPEDA compliant,” accept a paid external pilot, or promise a recovery/retention service level until the open items above have evidence and accountable approval.
