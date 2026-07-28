# My AI PA Shipping and Security Review

Review date: July 28, 2026

Scope: local code, repository controls, read-only production health/provider inventory, and one synthetic review-only signup

Release status: commit `54efb3f` is live and healthy. The follow-up hardening described below is a local release candidate; it has not been committed, pushed, or deployed.

## Decision

The live release is suitable for controlled internal testing, but it is not ready for an unrestricted paid launch. The remaining blockers are legal approval, recovery/retention evidence, public-signup CAPTCHA, complete telephone/text cost authentication, and six Vapi numbers whose customer ownership cannot yet be proven from the production mapping table.

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
- Added PostgreSQL-backed dashboard login codes, abuse limits, and webhook replay claims. Production requests fail closed if this shared security state is unavailable.
- Added a repeatable read-only Vapi mapping audit. Unmapped calls are skipped and reported individually while trusted calls continue syncing; the code never guesses a default customer.
- Added backend persistence-adapter tests plus signup and customer-dashboard frontend regression tests.
- Added a production-safe signup harness that requires a synthetic signup to be held for review and fails if any telephone, agent, Stripe customer, subscription, or checkout resource appears.
- Applied patch-only updates for Prisma 6.19.3, Nodemailer 9.0.3, Stripe 22.3.2, Playwright 1.62.0, and React Hooks linting 7.1.1. No major framework migration or forced audit fix was used.

## Verified evidence

| Check | Result |
| --- | --- |
| Backend security/integration suite | 170 of 170 passed |
| Frontend regression tests | 8 of 8 passed across admin, signup, and customer-dashboard suites |
| Production dependency audit | 0 known vulnerabilities |
| Full dependency audit | 61 vulnerable development/build packages, representing 72 advisory paths in npm's JSON report; no forced breaking upgrade applied |
| Production build | Passed |
| Tracked and untracked secret scan | Passed |
| Render database external access | Production metadata verified with `ipAllowList: []`; API readiness remained HTTP 200 |
| Backend deployment preflight | Passed |
| Prisma schema validation | Passed |
| Signup diagnostic | Passed existing honeypot, timing, identity and duplicate controls; CAPTCHA is disabled |
| Production website | HTTP 200 |
| API liveness | HTTP 200 |
| Database-aware readiness | HTTP 200 |
| Vapi business mapping audit | 4 of 10 provider numbers have a trusted route; 6 remain deliberately fail-closed pending owner confirmation |
| Review-only signup harness | Passed health, readiness, 202 review hold, no external resource identifiers, and admin-feed verification |
| Synthetic privacy drill | 6 of 6 passed |
| Retention audit | Could not query production: no approved production database connection was supplied locally |
| Logical backup check | Failed safely: local `DATABASE_URL`, `pg_dump` and `pg_restore` were unavailable |

## Production observations

- The Render API has one running Starter instance. The follow-up release candidate moves login codes, rate limits, and webhook replay claims to PostgreSQL so restarts and future horizontal scaling do not reset those controls.
- The paid Render Postgres instance is on `basic_256mb`, PostgreSQL 18, 15 GB, without HA or a read replica.
- The live database metadata now shows no external IP allow-list entries. The API continues to use Render's same-region private connection and `/api/health/ready` returns HTTP 200.
- Ten Vapi telephone records were inventoried. Four route to a known customer through an explicit phone mapping or verified business number; six attached assistants have neither a phone/assistant mapping nor an exact business-number match. No mapping was created from a name guess.
- Render documents continuous point-in-time recovery for paid databases, with the available window determined by the workspace plan. The actual Recovery page and a successful restore still need human verification.

## Launch blockers, in order

### P0 — complete before a paid external launch

1. **Fix telephone/text cost authentication.** Create a dedicated Twilio API key pair and rotate or verify the Account Auth Token. Re-run the cost report until calls, messages and phone rental costs have no authentication warning.
2. **Confirm Vapi ownership mappings.** For each of the six fail-closed numbers in the private mapping-audit output, confirm the customer record or decommission the unused number. Add explicit phone and assistant mappings through the admin workflow, then rerun `npm run audit:vapi-business-mappings`.
3. **Prove recovery.** Confirm the Recovery page shows PITR, record its actual window, create an encrypted logical export, restore it into an isolated database and record RPO/RTO and validation evidence.
4. **Finish legal identity and counsel review.** Resolve the 166 draft placeholders; approve the entity, address, Privacy Officer/contact, Terms, Privacy Policy, DPA, recording notice, messaging consent and launch jurisdictions. Do not advertise “PIPEDA compliant” based only on repository controls.
5. **Protect public signup.** Configure Turnstile and test valid, missing, expired and replayed challenges before promoting the signup form broadly.
6. **Prove provider deletion and retention.** Run the production retention audit through an approved connection and record provider-side deletion evidence for call recordings, transcripts, messages, logs and exports.
7. **Run the destructive lifecycle sandboxes.** The review-only harness passed without provisioning. Two separately authorized end-to-end sandboxes must still cover payment/trial creation, telephone/assistant provisioning, dashboard access, call log/transcript, customer and owner text routing, STOP/START, cost allocation and clean cancellation.

### P1 — complete before scaling the pilot

1. Add independent external uptime monitoring and test a real failure alert to at least two approved responders.
2. Enable SMTP verification if unattended public signup is allowed.
3. Set independent `INTEGRATION_API_KEY` and `VAPI_WEBHOOK_SECRET` credentials and coordinate client migration before removing compatibility fallbacks.
4. Plan a controlled migration away from the aging Create React App toolchain. Do not use `npm audit fix --force`.

### P2 — optional integrations and maturity

- Configure Microsoft Calendar, Jobber and GitHub issue creation only when those features are offered.
- Add high availability, a connection pool and capacity alerting as paid load justifies them.
- Add an independent encrypted backup-retention destination after counsel and the owner approve residency and access.

## Controlled production sequence

1. Resolve P0 credentials and legal approvals.
2. Confirm or remove all six unmapped Vapi numbers.
3. Create a Render database recovery point or export.
4. Deploy the reviewed release candidate, including the PostgreSQL security-state schema.
5. Verify health and one read-only admin and customer dashboard query.
6. Rerun the review-only harness, then separately authorize the two destructive lifecycle sandboxes and controlled calls.
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
npm run audit:vapi-business-mappings
npm run test:signup-sandbox:dry
npm run ops:monitor
npm run ops:retention:audit
npm run ops:backup:check
```
