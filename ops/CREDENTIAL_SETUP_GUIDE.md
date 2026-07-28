# My AI PA Credential Setup Guide

Last updated: July 28, 2026

Use this guide to complete production configuration without sharing secret values in chat, screenshots, Git, diagnostics, or support tickets.

## Safe handoff method

1. Create or rotate the credential in the provider's own dashboard.
2. Save it directly in the Render service's **Environment** page, or in the local untracked `.env.local` file when a local operator script needs it.
3. Never copy the value into a tracked file. Example files contain names and placeholders only.
4. Run `npm run audit:credential-readiness`. It reports presence and limited authentication results without printing secret values.
5. Run the relevant verification below.
6. Delete any temporary download, screenshot, clipboard note, or plaintext transfer after verification.

Local Render operator scripts also require `RENDER_SERVICE_ID` in the untracked
`.env.local` file. Obtain it from the Render service URL; it is an identifier,
not an authentication credential.

## Required for the current release

| Purpose | Render variables | Where to create or retrieve | Verification |
| --- | --- | --- | --- |
| Telephone and text reporting | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`; keep `TWILIO_AUTH_TOKEN` for signed Twilio webhooks | Twilio Console. Create a dedicated Standard API key for server-to-server reporting. Rotate the current Auth Token if it is no longer accepted. | `npm run audit:credential-readiness`, then `npm run repair:twilio-cost-reporting` without `--apply` |
| Public signup bot protection | `TURNSTILE_SECRET_KEY`; website build: `REACT_APP_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site configuration for `myaipa.ca` and `www.myaipa.ca` | Complete a valid signup and confirm an invalid or missing challenge is rejected when enforcement is enabled |
| Independent integration authentication | `INTEGRATION_API_KEY` | Generate a new random secret in an approved password manager; do not reuse a provider key | Update each approved integration client, then run backend tests and one sandbox request |
| Voice webhook authentication | `VAPI_WEBHOOK_SECRET` | Generate a separate random secret and configure the same value on the Vapi server webhook | Run the Vapi webhook security audit and a controlled call before removing any compatibility path |
| Transactional email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Approved email provider; use a restricted sending credential and an authenticated My AI PA domain | Enable verification in staging and complete one inbox and expiry test |
| Legal identity/contact | Not a secret: approved legal entity, mailing address, Privacy Officer and monitored privacy email | Owner, accountant and qualified Canadian counsel | Resolve all legal draft placeholders and obtain written approval |

## Required only when the feature is enabled

| Feature | Variables | Notes |
| --- | --- | --- |
| AI support suggestions | `OPENAI_API_KEY` | Use a project-scoped restricted key. Keep personal information redaction tests passing. |
| Telegram operational alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Operational convenience only; do not make Telegram the sole incident-alert channel. |
| GitHub support issue creation | `GITHUB_SUPPORT_TOKEN`, `GITHUB_SUPPORT_REPO` | Use a fine-grained token limited to Issues on the single repository. |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Existing token encryption and OAuth state secrets must remain set. |
| Microsoft Calendar | `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET` | Optional until Microsoft Calendar is offered. |
| Jobber | `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET` | Optional until the Jobber connection is offered. |
| X job finder | `X_BEARER_TOKEN` | Separate, optional internal tool. |

## Current sanitized readiness result

The July 28, 2026 read-only audit found:

- Vapi, Stripe, the Make runtime handoff, Google Calendar and the locally operated Make API tool had credentials available.
- Twilio's Account SID and Auth Token were present, but the Auth Token failed a read-only API authentication check. A dedicated Twilio API key pair was not present.
- Turnstile, SMTP, the independent integration key and an explicit Vapi webhook secret still require setup.
- OpenAI, Telegram and Google Maps credentials were available locally but were not present on the Render service. Install them only if the associated production feature is intended to be enabled.
- Microsoft Calendar, Jobber, GitHub issue creation and the X job finder remain optional and were not fully configured.

The machine-readable local report is written to `diagnostics/security/credential-readiness-latest.json`. That path is ignored by Git.

## Rotation response

If a secret appears in Git, a screenshot, chat, logs, an email, or an unintended diagnostic:

1. Revoke or rotate it at the provider immediately.
2. Update the approved secret store and Render.
3. Restart the affected service.
4. Verify the old secret fails and the new secret works.
5. Inspect provider audit logs for unauthorized use.
6. Record the event using the incident runbook.
