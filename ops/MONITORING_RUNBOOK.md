# Production Monitoring Runbook

Owner: designated production operator
Escalation: Privacy Officer for privacy/security events; business owner for customer impact

## Monitored signals

| Signal | Expected result | Alert threshold |
|---|---|---|
| `https://www.myaipa.ca/` | HTTP 200 | Two consecutive failures or certificate/DNS failure |
| `/api/health` | HTTP 200 and `ok: true` | Two consecutive failures |
| `/api/health/ready` | HTTP 200, database reachable | Two consecutive failures |
| Render deployment | Healthy readiness checks | Failed/cancelled deployment |
| Signup/Make | Completed once with correlation ID | Failure, duplicate, or stuck over 10 minutes |
| Vapi calls/tools | Authenticated event and terminal call state | Error spike, rejected webhook, missing terminal state |
| Twilio owner/caller SMS | Final delivered or explained terminal state | Owner failure, wrong destination, duplicate, undelivered |
| Stripe webhook | Verified and reconciled | Signature failure, backlog, duplicate side effect |
| Retention cleanup | Daily successful run | Missed run over 36 hours or expired artifact remains |
| Backup | Verified backup and current PITR | No verified backup in seven days |

## Running the monitor

`npm run ops:monitor` checks the public site, API liveness, and database readiness and writes a redacted JSON report under `diagnostics/operations/`.

`npm run ops:monitor -- --include-operational --confirm-failure --telegram-on-failure` also checks the protected operational queue and repeats failed checks before alerting. It requires `MONITOR_API_KEY`; the endpoint returns counts only and never exposes customer details.

The GitHub Actions workflow `.github/workflows/production-monitor.yml` is scheduled every five minutes, but scheduler delays mean that is not a guaranteed checking interval. Add repository secrets named `MONITOR_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. The monitor key must match the Render environment value. Independent external uptime/heartbeat activation remains deferred at the owner's request; do not represent it as active coverage.

Use `npm run ops:monitor -- --telegram-on-failure` only from a trusted scheduler with the Telegram secrets available. The Telegram bot token must be rotated before production because an earlier token appeared in diagnostic output.

Schedule this monitor outside the production web service so a full Render outage cannot suppress the check. Render’s own HTTP health check remains the first restart/deployment guard.

## Admin Needs Attention inbox

The admin `Needs Attention` page combines failed or stuck signups, payment failures, failed owner/customer text actions, completed leads without a recorded owner handoff, stuck call actions, routing gaps, and high-priority support reports. Recovery buttons are deliberately allowlisted: retry an owner text, resync calls, resend a still-valid signup verification, or reopen a failed signup for manual review. Every recovery attempt is written to the protected admin audit trail with contact information and secrets redacted.

The call-text check confirms that the protected call action recorded successful provider acceptance for both expected recipients. Final carrier delivery receipts remain provider evidence and should still be reviewed when a message was accepted but never reached a handset.

## Durable Twilio receipt recovery

The authenticated operations health response and admin Overview/Needs Attention pages include `twilioReceipts`: pending, processing, completed-retained, failed and expired-lease counts, oldest waiting age, last successful worker run and a sanitized error code. The admin snapshot refreshes every 30 seconds. These views do not reveal message bodies, phone numbers or message SIDs and offer no one-click resend/replay action. Unknown or unavailable evidence must never be treated as an empty, healthy queue.

Warning thresholds are a pending receipt or successful-worker-run age of two minutes, an expired lease, or missing pending timestamps. Ten minutes or any exhausted job is critical. A worker's successful empty scan does not remove failed-job warnings, dismiss historical incidents, or prove that a customer read a text.

The receipt worker uses a cross-process database lease plus process-local overlap protection. Short database-only transactions have a one-second lock timeout and bounded jittered retries for transient database failures; provider calls remain outside transactions. Completed retention cleanup is bounded to 100 rows per pass and never deletes failed or pending work. `P2028` means an expired transaction, not an unsupported advisory-lock result type.

After deployment, inspect the protected snapshot, the oldest saved job and the exact logs before any recovery. Reconcile uncertain downstream outcomes using the existing durable signup/SMS records; never blindly resend a message, buy another number, or create another assistant. Exhausted jobs require a separately reviewed exact-target repair. Keep the original alerts until backlog reconciliation and a full 24-hour observation confirm recovery. A passing homepage or unit test is not sufficient.

Local evidence: `npm run test:twilio-receipts` and `node scripts/run-local-signup-postgres-drill.js --receipts-only` exercise bounded retries, duplicate receipts, competing workers, expired leases and real PostgreSQL health aggregation without contacting providers. CI also requires `npm run test:twilio-receipts:postgres` against its fresh isolated drill database. These tests are not evidence of production backlog recovery.

## Alert content

Alerts include the check name, status, and timestamp only. Do not place phone numbers, email addresses, call text, transcript content, addresses, tokens, database URLs, or customer names in alerts.

## Response

1. Acknowledge the alert and open an incident record.
2. Confirm whether the failure is synthetic-monitor, DNS, certificate, frontend, API, database, or provider-specific.
3. Pause affected automation when continuing could lose, duplicate, or misroute a lead.
4. Preserve correlation IDs and provider IDs without copying message/call content.
5. Follow the incident runbook and communicate through the approved channel.
6. Close only after recovery, backlog reconciliation, customer-impact review, and a successful monitor rerun.

## Monthly review

Review uptime, failed deploys, signup failures, webhook backlogs, call errors, owner/caller delivery, wrong-recipient events, retention failures, backup age, restore evidence, and unresolved incidents. Every recurring alert needs a root cause and accountable corrective action.

Official references:

- Render health checks: https://render.com/docs/health-checks
- Twilio delivery status callbacks: https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
