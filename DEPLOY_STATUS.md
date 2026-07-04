# Deploy Status

Last updated: 2026-07-04

## Latest www.myaipa.ca Frontend Build

The current `docs/` GitHub Pages output is the latest build intended for:

```text
https://www.myaipa.ca
```

Build label: `2026-07-04-homepage-live-call-refresh`

Current production bundle after `npm run build:pages`:

```text
docs/static/js/main.6bfb1f96.js
```

This build includes the refreshed homepage hero for My AI PA:

- `AI Telephone Answering Assistant` hero badge.
- Lowered hero badge spacing so it does not crowd the My AI PA logo.
- Updated live-call conversation around installation, maintenance, and repair.
- Owner Text and Customer Text cards with clearer service request formatting.
- Enlarged blue arrow/text note: `Instantly sends you and the customer a text message`.
- Laptop-height layout fixes so the hero cards fit without clipping.

## Recurring Thread Request

The user asked for recurring work every 5 hours starting at 2:11 AM. This chat/tool environment does not expose a scheduler or recurring thread automation API, so no actual timed wake-up has been created.

If a future run/session starts manually, first:

1. Inspect repo state with `git status --short`.
2. Read `AGENTS.md`.
3. Inspect `package.json` scripts and `scripts/`.
4. Continue from this handoff report.
5. Before ending, update this file with a fresh handoff.

## Goal

Deploy the My AI PA backend as a public API at:

```text
https://api.myaipa.ca
```

Then rebuild the GitHub Pages frontend so admin and signup flows call that backend instead of `localhost:8787`.

## Completed Repo Work

- Existing Express backend is in `server/index.js`.
- Render deployment files added:
  - `render.yaml`
  - `Procfile`
  - `Dockerfile`
  - `.dockerignore`
- Backend env template added:
  - `config/backend.env.example`
- Render/deploy guide added:
  - `BACKEND_DEPLOY.md`
- Backend CORS now supports `ALLOWED_ORIGINS`.
- Backend runtime JSON path now supports `DATA_DIR`.
- Prisma model added:
  - `RuntimeStore`
- JSON runtime import script added:
  - `scripts/migrate-json-stores-to-db.js`
  - npm script: `npm run data:migrate-json`
- Render blueprint validator added:
  - `scripts/validate-render-blueprint.js`
  - npm script: `npm run render:validate`
- Pages build was updated to avoid the locked `build/` folder:
  - `scripts/build-pages.js` uses `build-pages-output`
- Local docs preview script added:
  - `scripts/preview-docs.js`
  - npm script: `npm run preview:docs`
- Codex resume wakeup scripts added:
  - `scripts/codex-wakeup.ps1`
  - `scripts/codex-schedule-wakeup.ps1`
  - npm script: `npm run codex:wakeup`
  - npm script: `npm run codex:wakeup:install`

## Validation Completed

These checks have passed across the deployment-prep work:

```bash
node --check server/index.js
node --check scripts/migrate-json-stores-to-db.js
node --check scripts/validate-render-blueprint.js
npx prisma validate
npm run backend:prepare
```

In the current run, these syntax checks passed:

```bash
node --check server\index.js
node --check scripts\migrate-json-stores-to-db.js
node --check scripts\validate-render-blueprint.js
```

`render.yaml` parsed successfully in an earlier run. A dedicated validator now exists at `npm run render:validate`, but the most recent attempt to execute it inside the sandbox failed before project code ran because Node hit:

```text
EPERM: operation not permitted, lstat 'C:\Users\Olive'
```

Escalated reruns of `node scripts\validate-render-blueprint.js` and `npx prisma validate` were requested, but the approvals were not accepted in that turn. Treat the validator as syntax-checked but not yet runtime-verified in the current run.

`npm run codex:wakeup` can be used to prepare `.codex-resume-prompt.txt` and copy the resume prompt to the clipboard.

`npm run codex:wakeup:install` installs a Windows Scheduled Task named `MyAIPA Codex Resume Wakeup` that runs every 5 hours starting at 2:11 AM and launches the Codex watchdog window through `scripts/codex-watch.ps1` directly. This has not been rerun after the scheduler hardening change; installing or updating the task changes Windows scheduler state and should be done only with explicit approval.

The direct PowerShell wakeup script was tested successfully:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\codex-wakeup.ps1
```

It wrote `.codex-resume-prompt.txt` and `.codex-wakeup.log`. Clipboard copy failed in the non-interactive tool context, which is expected; it may work in a normal logged-in desktop task. The generated prompt/log are ignored by `.gitignore`.

The npm wrapper `npm run codex:wakeup` previously hit the recurring sandbox Node path issue before PowerShell started. The launch path now avoids npm when starting the watchdog, but use the direct PowerShell command above if npm is blocked in this environment.

## Most Recent Interrupted Step

`npm run render:validate` / `node scripts\validate-render-blueprint.js` was attempted inside the sandbox and failed before project code ran with the recurring Windows `EPERM: operation not permitted, lstat 'C:\Users\Olive'` issue.

Escalated validation was requested but not approved. Next session should run:

```bash
npm run render:validate
npx prisma validate
```

If the sandbox repeats the same `EPERM`, rerun with approval or run from a normal desktop terminal.

Previously, `npm run data:migrate-json` was attempted inside the sandbox and failed before script startup with the same recurring Windows path issue.

It was then requested with escalation. The user interrupted that turn before the command completed. A prefix approval for `npm run data:migrate-json` was saved afterward, but the import should be treated as **not yet run successfully**.

Run it only after the target database schema includes `RuntimeStore`:

```bash
npm run db:push
npm run data:migrate-json
```

If running locally, this requires local Postgres from `DATABASE_URL`. If running on Render, run it after Render Postgres is created and `DATABASE_URL` is set.

## Known Current State

- The repo has many pre-existing dirty files and generated logs. Do not blindly revert.
- There are many unrelated modified/untracked files; preserve user work.
- `www.myaipa.ca/admin` was blank because live GitHub Pages was stale and did not include the admin route.
- The rebuilt local `docs/` output showed the admin page correctly.
- The live frontend will still have fetch errors until it is rebuilt with:

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
```

## External Steps Remaining

1. Run `npm run render:validate` in an approved/non-sandbox shell if the sandbox still hits `EPERM`.
2. In Render, create a Blueprint from `render.yaml`.
3. Fill Render secret env vars:

```text
ADMIN_PASSWORD
MAKE_SIGNUP_WEBHOOK_URL
MAKE_SIGNUP_WEBHOOK_API_KEY
VAPI_API_KEY
STRIPE_SECRET_KEY
STRIPE_PRICE_ID
STRIPE_WEBHOOK_SECRET
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
OWNER_SMS_FROM
TURNSTILE_SECRET_KEY
SMTP_* if email verification/reminders are enabled
```

4. Add the DNS record Render provides for `api.myaipa.ca`.
5. Wait for Render HTTPS certificate to become active.
6. Verify:

```text
https://api.myaipa.ca/api/health
```

7. Rebuild and deploy GitHub Pages with:

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
npm run build:pages
npm run deploy:pages
```

8. After the backend database is ready, run:

```bash
npm run data:migrate-json
```

## Recommended Resume Prompt

```text
Read DEPLOY_STATUS.md and continue the Render backend deploy.
```
