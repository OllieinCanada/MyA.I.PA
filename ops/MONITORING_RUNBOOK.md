# Production Monitoring Runbook

Owner: designated production operator
Escalation: Privacy Officer for privacy/security events; business owner for customer impact

## Monitored signals

| Signal | Expected result | Alert threshold |
|---|---|---|
| `https://www.myaipa.ca/` | HTTP 200 | Two consecutive failures or certificate/DNS failure |
| `/api/health` | HTTP 200 and `ok: true` | Two consecutive failures |
| `/api/health/ready` | HTTP 200, database reachable | One failure during live traffic |
| Render deployment | Healthy readiness checks | Failed/cancelled deployment |
| Signup/Make | Completed once with correlation ID | Failure, duplicate, or stuck over 10 minutes |
| Vapi calls/tools | Authenticated event and terminal call state | Error spike, rejected webhook, missing terminal state |
| Twilio owner/caller SMS | Final delivered or explained terminal state | Owner failure, wrong destination, duplicate, undelivered |
| Stripe webhook | Verified and reconciled | Signature failure, backlog, duplicate side effect |
| Retention cleanup | Daily successful run | Missed run over 36 hours or expired artifact remains |
| Backup | Verified backup and current PITR | No verified backup in seven days |

## Running the monitor

`npm run ops:monitor` checks the public site, API liveness, and database readiness and writes a redacted JSON report under `diagnostics/operations/`.

Use `npm run ops:monitor -- --telegram-on-failure` only from a trusted scheduler with the Telegram secrets available. The Telegram bot token must be rotated before production because an earlier token appeared in diagnostic output.

Schedule this monitor outside the production web service so a full Render outage cannot suppress the check. Render’s own HTTP health check remains the first restart/deployment guard.

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
