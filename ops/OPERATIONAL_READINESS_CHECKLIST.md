# My AI PA Legal and Operational Readiness Checklist

Last updated: July 28, 2026
Status: controlled pilot only; counsel and production evidence remain required

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
- [x] `npm run ops:backup` creates a private PostgreSQL custom-format backup, verifies its archive structure, and writes a SHA-256 manifest.
- [x] Backup output and operational diagnostics are excluded from Git.
- [x] Runbooks exist for retention/deletion, backup/restore, monitoring, incidents, privacy requests, and counsel review.
- [x] Central SMS suppression, signed inbound STOP/START handling, fail-closed send checks, and provider-neutral dashboard visibility are implemented and tested locally.
- [x] Local and GitHub release gates validate the operational controls on every release.
- [x] Legal drafts remain private, marked as drafts, and excluded from the public repository.
- [x] Admin browser authentication uses an HttpOnly session cookie instead of retaining the master password in browser storage.
- [x] Customer support-report submission has a dedicated rate limit and cannot escalate severity from customer-supplied analysis.
- [x] The Render blueprint disables external Postgres access and uses the same-region private database connection.
- [x] A sanitized credential-readiness audit is available with `npm run audit:credential-readiness`.

## Required before a paid external pilot

- [ ] Confirm the full legal entity name, form, jurisdiction, registration number, mailing address, and trade name.
- [ ] Appoint a Privacy Officer in writing and provide a monitored privacy contact.
- [ ] Verify that `hello@myaipa.com` is controlled and monitored or replace it everywhere with the approved contact.
- [ ] Have qualified Canadian counsel approve the Privacy Policy, Terms, DPA, customer acknowledgement, call notice, messaging templates, and launch jurisdictions.
- [ ] Have an accountant confirm financial and tax record categories and retention.
- [ ] Confirm every live provider, legal name, role, processing location, DPA, retention, deletion mechanism, subprocessor list, and incident commitment.
- [ ] Verify the production Render database is a paid instance with recovery enabled and record the actual PITR window.
- [ ] Apply the reviewed database external-access restriction and verify the API continues to use Render's internal database URL.
- [ ] Create an encrypted logical database export and complete an isolated restore drill.
- [ ] Select protected backup storage and approve access, encryption, residency, retention, and deletion.
- [ ] Schedule monitoring outside the production API and test a real failure alert.
- [ ] Verify provider-side deletion for Vapi, Twilio, OpenAI, Make, Render logs, Stripe, email, and any monitoring service.
- [x] Activate the production messaging webhook and complete one authorized live `STOP`/`START` exercise using `ops/SMS_CONSENT_RUNBOOK.md` (controlled provider-path exercise completed July 24, 2026; all nine active routes read back successfully and the test number finished active).
- [ ] Complete a privacy incident tabletop exercise and retain its signed report.
- [x] Complete one privacy access/correction/deletion exercise using synthetic data (`npm run ops:privacy:drill`; local evidence excludes personal information).
- [ ] Configure Turnstile and test valid, missing, expired, and replayed challenges before public signup promotion.
- [ ] Install a working Twilio reporting API key pair and verify call, text-message, and phone-number costs without authentication warnings.
- [ ] Complete two end-to-end sandbox signups covering both supported paths, dashboard data, texts, cost allocation, consent, and cancellation.

## Repeatable commands

```text
npm run legal:validate
npm run ops:validate
npm run ops:retention:audit
npm run ops:privacy:drill
npm run ops:backup:check
npm run ops:monitor
npm run audit:credential-readiness
npm run render:validate
npm run backend:check
npm run test:backend
```

Use `LEGAL_DRAFTS_DIR` when validating the private legal package from a checkout where it is intentionally absent.

## Approval rule

Repository checks do not establish legal compliance. Do not claim “PIPEDA compliant,” accept a paid external pilot, or promise a recovery/retention service level until the open items above have evidence and accountable approval.
