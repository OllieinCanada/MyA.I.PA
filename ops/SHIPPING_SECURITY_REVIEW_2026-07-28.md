# My AI PA Shipping and Security Review

Review date: July 28, 2026

Scope: local code, repository controls, read-only production health and Render configuration metadata

Release action: none; this review did not commit, push, deploy, message customers, or modify production

## Decision

The release candidate is suitable for continued controlled internal testing, but it is not ready for an unrestricted paid launch. The main application, backend tests and production health checks pass. The remaining blockers are operational evidence, legal approval, database recovery proof, signup abuse protection and complete telephone/text cost authentication.

## Changes made locally

- Removed browser storage of the master admin password. The admin UI now uses the existing HttpOnly, Secure, SameSite session cookie.
- Restricted request-body admin passwords to the login route. Protected admin routes no longer accept a password smuggled in an arbitrary JSON body.
- Made rate limiting use Express's trusted-proxy client address instead of manually trusting a caller-supplied forwarded header.
- Added a separate limit of six customer support-report submissions per hour per dashboard session.
- Prevented a customer-supplied support-analysis object from escalating its own severity.
- Added regression tests for those controls.
- Added dedicated Twilio API-key support and more complete call, text-message and phone-number cost allocation.
- Added a credential-readiness audit that reports presence and safe authentication results without printing secrets.
- Set the local Render database blueprint to `ipAllowList: []`, because the API uses Render's same-region private database connection.

## Verified evidence

| Check | Result |
| --- | --- |
| Backend security/integration suite | 167 of 167 passed |
| Frontend admin credential regression | 1 of 1 passed |
| Production dependency audit | 0 known vulnerabilities |
| Full dependency audit | 72 advisories in the Create React App development/build toolchain; no production dependency advisories |
| Production build | Passed |
| Tracked and untracked secret scan | Passed |
| Render blueprint validation | Passed with the local database external-access restriction |
| Backend deployment preflight | Passed |
| Prisma schema validation | Passed |
| Signup diagnostic | Passed existing honeypot, timing, identity and duplicate controls; CAPTCHA is disabled |
| Production website | HTTP 200 |
| API liveness | HTTP 200 |
| Database-aware readiness | HTTP 200 |
| Synthetic privacy drill | 6 of 6 passed |
| Retention audit | Could not query production: no approved production database connection was supplied locally |
| Logical backup check | Failed safely: local `DATABASE_URL`, `pg_dump` and `pg_restore` were unavailable |

## Production observations

- The Render API has one running Starter instance. In-memory login-code and rate-limit state is therefore consistent within the current instance, but it resets on a restart or deploy. A shared store is required before adding more instances.
- The paid Render Postgres instance is on `basic_256mb`, PostgreSQL 18, 15 GB, without HA or a read replica.
- The live database metadata showed the default `0.0.0.0/0` external allow list. This permits external connection attempts from any IP when valid credentials are presented. The local blueprint now specifies no external access; production remains unchanged until an authorized deployment.
- Render documents continuous point-in-time recovery for paid databases, with the available window determined by the workspace plan. The actual Recovery page and a successful restore still need human verification.

## Launch blockers, in order

### P0 — complete before a paid external launch

1. **Fix telephone/text cost authentication.** Create a dedicated Twilio API key pair and rotate or verify the Account Auth Token. Re-run the cost report until calls, messages and phone rental costs have no authentication warning.
2. **Restrict production database external access.** Apply the reviewed Render blueprint or remove the database's external IP rules in the dashboard. Verify `/api/health/ready`, signup and admin reads afterward. If controlled external maintenance is needed, allow only the operator's temporary `/32` address and remove it immediately afterward.
3. **Prove recovery.** Confirm the Recovery page shows PITR, record its actual window, create an encrypted logical export, restore it into an isolated database and record RPO/RTO and validation evidence.
4. **Finish legal identity and counsel review.** Resolve the 166 draft placeholders; approve the entity, address, Privacy Officer/contact, Terms, Privacy Policy, DPA, recording notice, messaging consent and launch jurisdictions. Do not advertise “PIPEDA compliant” based only on repository controls.
5. **Protect public signup.** Configure Turnstile and test valid, missing, expired and replayed challenges before promoting the signup form broadly.
6. **Prove provider deletion and retention.** Run the production retention audit through an approved connection and record provider-side deletion evidence for call recordings, transcripts, messages, logs and exports.
7. **Run two end-to-end sandbox signups.** Cover both supported signup paths, payment/trial creation, phone/assistant provisioning, dashboard access, call log/transcript, customer and owner text routing, STOP/START, cost allocation and clean cancellation.

### P1 — complete before scaling the pilot

1. Move dashboard login-code, abuse-limit and webhook replay state to a shared TTL store before running more than one API instance.
2. Add independent external uptime monitoring and test a real failure alert to at least two approved responders.
3. Enable SMTP verification if unattended public signup is allowed.
4. Set independent `INTEGRATION_API_KEY` and `VAPI_WEBHOOK_SECRET` credentials and coordinate client migration before removing compatibility fallbacks.
5. Add broader frontend tests for signup, customer dashboard, admin dashboard and support reporting.
6. Patch safe dependency updates, refresh Browserslist data and plan a controlled migration away from the aging Create React App toolchain. Do not use `npm audit fix --force`.

### P2 — optional integrations and maturity

- Configure Microsoft Calendar, Jobber and GitHub issue creation only when those features are offered.
- Add high availability, a connection pool and capacity alerting as paid load justifies them.
- Add an independent encrypted backup-retention destination after counsel and the owner approve residency and access.

## Controlled production sequence

1. Resolve P0 credentials and legal approvals.
2. Create a Render database recovery point or export.
3. Apply the database external-access restriction.
4. Deploy the reviewed release candidate.
5. Verify health and one read-only admin and customer dashboard query.
6. Run the two sandbox signups and controlled calls.
7. Re-run `npm run test:release -- --skip-pages`, `npm run audit:credential-readiness`, `npm run ops:monitor`, and the cost report.
8. Record approvals and evidence, then make the shipping decision.

## Rollback notes

- If the API loses database access after the external allow-list change, first verify it is using Render's internal database URL and that the API and database remain in the same region. Restore the previous database IP rule only as a time-bounded emergency measure.
- Do not restore an old database directly over production. Restore to a new isolated instance, validate it, replay post-backup privacy and deletion events, and then cut over.
- Admin-cookie changes are backward compatible with operator scripts that use `X-Admin-Password`; the browser UI intentionally no longer retains the master password.

## Repeatable local commands

```text
npm run test:backend
npm test -- --watchAll=false
npm run build
npm run security:scan-secrets -- --include-untracked
npm audit --omit=dev
npm run test:release -- --skip-pages
npm run audit:credential-readiness
npm run ops:monitor
npm run ops:retention:audit
npm run ops:backup:check
```
