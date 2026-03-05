# AI-First, Voice-First Architecture (My AI PA)

This project now includes:

- A CRA frontend (`src/`) with a new landing page, signup flow, and `/admin` dashboard route.
- A Node/Express backend (`server/`) exposing `/api/*` endpoints.
- Prisma + SQLite development data model (`prisma/schema.prisma`).

## Call Flow

1. Voice provider sends a webhook to `POST /api/webhooks/voice`.
2. Webhook router normalizes the event (`call.started`, `call.completed`, `faq.lookup`, `lead.capture`, etc.).
3. Router calls master agent tools (server-side functions):
   - `logCall()`
   - `searchFaq()`
   - `createLead()`
   - `sendOwnerSms()`
   - `createBooking()` (stub)
   - `escalateToHuman()` (stub)
4. Tool functions persist data through Prisma and return structured results.
5. Admin dashboard reads the same data via `/api/admin/*`.

## Master Agent Tools Interface

Defined in `server/agentTools.js`.

- `createLead(payload)`
  - Creates/links `Caller`, optional `Call`, and `Lead`.
- `logCall(payload)`
  - Creates or updates a `Call`, links to `Caller`, stores transcript/recording URL.
- `searchFaq({ q, businessId, limit })`
  - Searches FAQs by `question`, `answer`, `tags`.
- `sendOwnerSms(payload)`
  - Mock implementation (console log) with Twilio env placeholders ready.
- `createBooking(payload)`
  - Stubbed booking integration response.
- `escalateToHuman(payload)`
  - Stubbed escalation response.

## Data Model (Prisma / SQLite)

Defined in `prisma/schema.prisma`.

- `Business`
- `Settings`
- `Caller`
- `Call`
- `Lead`
- `FAQ`

Enums included:

- `AfterHoursMode`
- `CallStatus`
- `LeadIntent`
- `LeadUrgency`
- `LeadStatus`

## API Endpoints

Public / Agent-facing:

- `POST /api/leads/create`
- `POST /api/calls/log`
- `GET /api/faqs/search?q=...`
- `POST /api/notify/owner-sms`
- `POST /api/webhooks/voice`

Admin (password-gated by `ADMIN_PASSWORD` via `x-admin-password` header):

- `POST /api/admin/login`
- `GET /api/admin/leads`
- `GET /api/admin/calls`
- `GET /api/admin/faqs`
- `POST /api/admin/faqs`
- `PUT /api/admin/faqs/:id`
- `DELETE /api/admin/faqs/:id`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`

## How To Run (Dev)

1. Install dependencies (root):

```bash
npm install
```

2. Copy env file and fill values:

```bash
cp .env.example .env
```

Required:

- `ADMIN_PASSWORD`
- `DATABASE_URL` (default SQLite example provided)

Optional:

- `OWNER_SMS_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `REACT_APP_GOOGLE_MAPS_API_KEY`
- `REACT_APP_API_BASE_URL`

3. Generate Prisma client and run migrations:

```bash
npm run db:generate
npm run db:migrate -- --name init
```

4. Seed default business + settings:

```bash
npm run db:seed
```

5. Run backend API:

```bash
npm run server
```

6. In another terminal, run frontend:

```bash
npm start
```

## Sample cURL Commands

### Create a lead

```bash
curl -X POST http://localhost:8787/api/leads/create \
  -H "Content-Type: application/json" \
  -d "{\"businessId\":1,\"callerPhone\":\"+15550109999\",\"name\":\"Jamie\",\"callbackNumber\":\"+15550109999\",\"intent\":\"QUOTE\",\"urgency\":\"HIGH\",\"summary\":\"Leaking water heater, wants same-day estimate.\"}"
```

### Log a call (start)

```bash
curl -X POST http://localhost:8787/api/calls/log \
  -H "Content-Type: application/json" \
  -d "{\"businessId\":1,\"callerPhone\":\"+15550101111\",\"callerName\":\"Alex\",\"status\":\"STARTED\",\"startedAt\":\"2026-02-22T15:00:00Z\"}"
```

### Log a call (complete with transcript)

```bash
curl -X POST http://localhost:8787/api/calls/log \
  -H "Content-Type: application/json" \
  -d "{\"businessId\":1,\"callId\":1,\"callerPhone\":\"+15550101111\",\"status\":\"COMPLETED\",\"startedAt\":\"2026-02-22T15:00:00Z\",\"endedAt\":\"2026-02-22T15:03:12Z\",\"durationSec\":192,\"transcript\":\"Caller asked about emergency service and pricing.\",\"recordingUrl\":\"https://example.com/recording.mp3\"}"
```

### FAQ search

```bash
curl "http://localhost:8787/api/faqs/search?q=hours&businessId=1"
```

### Mock owner SMS

```bash
curl -X POST http://localhost:8787/api/notify/owner-sms \
  -H "Content-Type: application/json" \
  -d "{\"businessId\":1,\"message\":\"New urgent lead captured.\"}"
```

### Voice webhook (stubbed routing)

```bash
curl -X POST http://localhost:8787/api/webhooks/voice \
  -H "Content-Type: application/json" \
  -d "{\"eventType\":\"lead.capture\",\"businessId\":1,\"callerPhone\":\"+15550102222\",\"name\":\"Morgan\",\"callbackNumber\":\"+15550102222\",\"intent\":\"BOOKING\",\"urgency\":\"MEDIUM\",\"summary\":\"Wants to schedule service this week.\"}"
```

### Admin login check

```bash
curl -X POST http://localhost:8787/api/admin/login \
  -H "Content-Type: application/json" \
  -H "x-admin-password: change-me" \
  -d "{\"password\":\"change-me\"}"
```

### Admin leads list with filters

```bash
curl "http://localhost:8787/api/admin/leads?status=NEW&urgency=HIGH" \
  -H "x-admin-password: change-me"
```

## Notes

- The owner SMS integration is intentionally mocked first for safe local development.
- Twilio wiring can be added inside `sendOwnerSms()` later without changing the API contract.
- The frontend admin dashboard defaults to `REACT_APP_API_BASE_URL=http://localhost:8787`.
