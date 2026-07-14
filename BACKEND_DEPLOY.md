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

Trial reminder emails are enabled by default. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in Render before relying on reminders, or set `TRIAL_REMINDER_DISABLE=true` until outbound email is ready.

`SIGNUP_REVIEW_DUPLICATES=true` is recommended for launch so repeat submissions are held for admin review instead of starting duplicate Make/Vapi setup handoffs.

## Integration and Vapi Authentication

The following backend routes reject unauthenticated requests:

- `POST /api/leads/create`
- `POST /api/calls/log`
- `GET /api/faqs/search`
- `POST /api/notify/owner-sms`
- `POST /api/webhooks/voice`
- `POST /api/integrations/vapi/lead-handoffs/events`

Approved server-to-server callers can authenticate with `Authorization: Bearer <INTEGRATION_API_KEY>`, `X-MyAIPA-Key`, or `X-Vapi-Secret`. Never put this key in frontend code or a public build.

Before enabling a Vapi assistant in production, create a Vapi custom credential containing the same secret and attach that credential to every assistant, phone-number, or tool server URL that calls these routes. A deployment is not ready until an authenticated Vapi test event succeeds and the same event without a credential returns `401` without changing data or sending a message.

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

After the backend is hosted, set the frontend build variable:

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
```

Then rebuild and deploy the frontend:

```bash
npm run build:pages
npm run deploy:pages
```

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
