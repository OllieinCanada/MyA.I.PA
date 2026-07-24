# My AI PA Backend

The backend is the Express API in `server/index.js`. It must run as a separate public web service because GitHub Pages only hosts the static frontend.

## Local Run

```bash
npm install
npm run db:generate
npm run db:push
npm run server
```

Health check:

```text
http://localhost:8787/api/health
```

## Production Setup

Create a hosted Node service using either:

- `Procfile`: `web: npm run server`
- `Dockerfile`: containerized Node 20 backend
- `render.yaml`: Render Blueprint for the API, Postgres, persistent disk, and `api.myaipa.ca`

Set environment variables from `config/backend.env.example`.

Minimum required production variables:

```text
NODE_ENV=production
PORT=8787
PUBLIC_APP_URL=https://api.myaipa.ca
ALLOWED_ORIGINS=https://www.myaipa.ca,https://myaipa.ca
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=<strong password>
ADMIN_SESSION_SECRET=<long random secret>
INTEGRATION_API_KEY=<long random secret shared only with approved integrations>
STRIPE_SUCCESS_URL=https://www.myaipa.ca/#/signup?payment=success
STRIPE_CANCEL_URL=https://www.myaipa.ca/#/signup?payment=cancelled
SIGNUP_REVIEW_DUPLICATES=true
```

`PUBLIC_APP_URL` is the public backend URL. Keep the Stripe return URLs pointed at the website so customers come back to `www.myaipa.ca` after Checkout instead of landing on the API host.

`FRONTEND_APP_URL` is the public website URL used in owner appointment-request messages. Appointment requests remain pending until the owner approves them in the dashboard. Once approved, the API sends both parties a universal `.ics` calendar link that opens in Google Calendar, Outlook/Hotmail, or Apple Calendar.

Trial reminder emails are enabled by default. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in Render before relying on reminders, or set `TRIAL_REMINDER_DISABLE=true` until outbound email is ready.

The support inbox stores reports without extra credentials. For high-priority Telegram alerts, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. For the admin inbox's one-click GitHub issue option, set a narrowly scoped `GITHUB_SUPPORT_TOKEN` with issue-write access and confirm `GITHUB_SUPPORT_REPO`. The Codex option prepares a scoped, copy-ready task and does not silently execute code or deploy changes.

`SIGNUP_REVIEW_DUPLICATES=true` is recommended for launch so repeat submissions are held for admin review instead of starting duplicate Make/Vapi setup handoffs.

## Integration and Vapi Authentication

The following backend routes reject unauthenticated requests:

- `POST /api/leads/create`
- `POST /api/calls/log`
- `GET /api/faqs/search`
- `POST /api/notify/owner-sms`
- `POST /api/webhooks/voice`
- `POST /api/integrations/vapi/lead-handoffs/events`

Approved server-to-server callers use `INTEGRATION_API_KEY` on the general integration routes. `POST /api/webhooks/voice` is deliberately separate: it accepts only the Vapi webhook credential through `Authorization: Bearer ...` or `X-Vapi-Secret`. It does not accept `INTEGRATION_API_KEY`, request-body credentials, or caller-supplied tenant IDs. Never put either credential in frontend code or a public build.

Set an independent `VAPI_WEBHOOK_SECRET` when account-level secret management is available. If it is absent, production derives a stable, one-way, webhook-only credential from `VAPI_API_KEY`; this keeps the webhook credential distinct from both the private API key itself and the broader integration credential. `npm run deploy:vapi-webhook-security -- --apply --confirm=APPLY_VAPI_WEBHOOK_SECURITY_V1` attaches that value to managed assistants without printing it. Rotating `VAPI_API_KEY` requires rerunning this rollout when the derived mode is in use.

Before enabling a Vapi assistant in production, attach the matching Vapi custom credential to every assistant, phone-number, or tool server URL that calls these routes. The rollout script currently uses Vapi's backward-compatible inline secret field because it can be applied through the API; Vapi redacts that secret on subsequent reads, so verification combines an accepted PATCH, server URL/event readback, and an authenticated tenant-mapping probe. Migrate it to a reusable Vapi Custom Credential when dashboard/API credential management is available. A deployment is not ready until an authenticated test event succeeds, tenant mapping succeeds, and the same event without a credential returns `401` without changing data or sending a message.

`X-Vapi-Secret` verifies knowledge of the configured shared secret. Provider event identifiers should also be stored and checked for duplicate/replayed events before relying on the webhook for billing or message delivery.

## Vapi Owner Lead Handoff

Owner lead texts use Vapi's Chat API with direct Twilio SMS transport. The backend records each request and attempt, creates a signed acknowledgement link, retries Vapi request failures, flags unacknowledged leads, and escalates to the approved backup phone saved in Settings.

Configure these production variables before enabling the workflow:

```text
VAPI_API_KEY=
VAPI_SMS_ASSISTANT_ID=
VAPI_SMS_PHONE_NUMBER_ID=
LEAD_ACK_BASE_URL=https://api.myaipa.ca
LEAD_ACK_SECRET=<generated secret>
LEAD_ACK_TIMEOUT_MINUTES=10
LEAD_ACK_TOKEN_TTL_HOURS=72
LEAD_NOTIFICATION_MAX_RETRIES=2
LEAD_NOTIFICATION_RETRY_MINUTES=2
LEAD_HANDOFF_CHECK_INTERVAL_MS=60000
```

The legacy `POST /api/notify/owner-sms` route now returns `410` and never calls Twilio. Vapi should call `POST /api/webhooks/voice` with `lead.capture`, or use a server tool named `send_owner_sms_dynamic`, `record_lead_and_notify_owner`, or `create_lead_handoff`. Include a stable `eventId` or Vapi tool-call ID so retries are deduplicated.

The acknowledgement URL uses a confirmation page: opening the link does not mutate data. The owner must press the button, which prevents SMS link scanners from acknowledging a lead accidentally. Do not enable backup escalation until the business has approved the backup phone stored in Admin Settings.

The `CUSTOMER_DASHBOARD_*` rate-limit defaults protect the email+phone customer dashboard lookup from rapid guessing while still allowing normal owner refreshes.

### Revenue Rescue and acknowledgement SLA

The owner dashboard now records a lead's lifecycle (`NEW`, `REVIEWED`, `CONTACTED`, `WON`, `LOST`, or `ARCHIVED`), estimated value, actual won revenue, and the reason for the outcome. Every change also creates an immutable `LeadOutcomeEvent` audit row. The dashboard reports recovered revenue, open pipeline, conversion, and the percentage of owner acknowledgements completed inside the configured SLA.

New businesses default to a two-minute acknowledgement target. The business-level fields are `Settings.leadAckSlaMinutes`, `Settings.averageJobValueCents`, `Settings.tradeType`, and `Settings.playbookVersion`. `render.yaml` also sets `LEAD_ACK_TIMEOUT_MINUTES=2` as the deployment fallback.

Production Vapi tool calls now require a trusted assistant or phone mapping when `VAPI_REQUIRE_BUSINESS_MAPPING=true`. Notification and appointment tool calls both use `VapiToolExecution` database claims so repeated provider deliveries cannot create duplicate handoffs or appointment requests.

## Optional Jobber field-service integration

Jobber uses OAuth 2.0. Register the callback below in the Jobber Developer Center and configure:

```text
FIELD_SERVICE_TOKEN_ENCRYPTION_KEY=<generated 32+ character secret>
FIELD_SERVICE_OAUTH_STATE_SECRET=<different generated secret>
JOBBER_CLIENT_ID=
JOBBER_CLIENT_SECRET=
JOBBER_REDIRECT_URI=https://api.myaipa.ca/api/integrations/jobber/oauth/callback
JOBBER_GRAPHQL_VERSION=2025-04-16
```

Owners connect Jobber from the customer dashboard. Access and refresh tokens are encrypted at rest. Owner-confirmed lead outcomes create an idempotent Jobber client sync, and failures remain visible with an explicit retry action. Leave the credentials blank to keep the connector safely disabled.

After the backend is hosted, set the frontend build variable:

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
```

Then rebuild and deploy the frontend:

```bash
npm run build:pages
npm run deploy:pages
```

## Optional Google, Outlook, and Hotmail Calendars

Calendar OAuth is only for the business owner or a staff member. Customers never connect an account: they accept by text/email and receive Google, Outlook/Hotmail, Apple Calendar, and `.ics` choices.

The owner dashboard supports three modes:

- `MANUAL_APPROVAL`: the owner approves requests; a connected calendar is checked and updated when available.
- `AUTO_BOOK_CONNECTED`: My AI PA confirms immediately only when a connected calendar and the internal schedule are clear. A conflict or unavailable connection leaves the request pending for owner approval.
- `EMAIL_INVITES_ONLY`: no OAuth is used; confirmations are sent by text/email with universal calendar links.

Configure these production values in Render:

```text
CALENDAR_TOKEN_ENCRYPTION_KEY=<random 32+ character secret>
CALENDAR_OAUTH_STATE_SECRET=<different random secret>
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=https://api.myaipa.ca/api/calendar/oauth/google/callback
MICROSOFT_CALENDAR_CLIENT_ID=
MICROSOFT_CALENDAR_CLIENT_SECRET=
MICROSOFT_CALENDAR_REDIRECT_URI=https://api.myaipa.ca/api/calendar/oauth/microsoft/callback
```

In Google Cloud, enable Google Calendar API, create a web OAuth client, and register the exact Google redirect URI above. Start with named test users; public use of Calendar scopes may require Google's verification process.

In Microsoft Entra, create a web app registration, allow organizational and personal Microsoft accounts, register the exact Microsoft redirect URI above, create a client secret, and grant delegated `User.Read`, `Calendars.ReadWrite`, and `offline_access` permissions.

OAuth access and refresh tokens are encrypted before database storage. Never put provider secrets in the frontend or commit them to Git.

## Render Blueprint

This repo includes `render.yaml`. In Render:

1. Create a new Blueprint.
2. Connect `OllieinCanada/MyA.I.PA`.
3. Select the `main` branch.
4. Render will create:
   - `myaipa-api` web service
   - `myaipa-postgres` database
   - `/data` persistent disk for runtime JSON stores
   - `api.myaipa.ca` custom domain entry
5. Fill the `sync: false` secrets in the Render dashboard.
6. Add the DNS record Render shows for `api.myaipa.ca`.
7. Check:

```text
https://api.myaipa.ca/api/health
```

Before creating the Blueprint, validate the checked-in Render config:

```bash
npm run render:validate
```

This script checks the expected service, Postgres database, persistent disk, health path, custom domain, and required secret placeholders.

## Runtime Data

The backend now supports two deployment-safe layers:

- Render persistent disk at `/data` through `DATA_DIR=/data`
- A `RuntimeStore` Postgres table for importing the current JSON stores

After the Render database is created and `npm run db:push` has run, import any existing JSON runtime files with:

```bash
npm run data:migrate-json
```

This imports:

```text
pending-signup-verifications.json
trial-reminders.json
signup-dashboard.json
vapi-call-sync.json
```

The live server still reads/writes the JSON files for now, so the persistent disk is required. The database import gives us a recoverable copy and a clean next step for a later full DB-backed adapter migration.

The frontend must be rebuilt with:

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
```

## Why `localhost` Failed

`http://localhost:8787` only works on the machine running the backend. When someone opens `https://www.myaipa.ca/admin`, `localhost` means their own computer, not your server. The frontend must call a public backend URL such as `https://api.myaipa.ca`.
