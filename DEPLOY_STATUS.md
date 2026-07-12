# Deploy Status

Last updated: 2026-07-12

## Morning Executive Summary

- Biggest win: The local Pages build now defaults to `https://api.myaipa.ca`, Stripe Checkout return URLs are pinned back to `www.myaipa.ca`, signup anti-abuse/reminder env defaults are explicit in Render, admin/customer API responses now get no-store privacy headers, query-string admin password login is blocked, customer dashboard lookup now uses session-only storage plus backend rate limits with legacy `localStorage` cleanup, admin now has a read-only live Stripe Trials view, stale Star Runner PWA/game shipping paths were removed from the production bundle, dashboard/admin routes are included in repeatable visual diagnostics, the Vapi eval suite covers emergency handling, AI disclosure, and installation routing, trust copy is safer for launch, and visual/accessibility checks pass.
- Biggest blocker: The remaining launch work is external: Render blueprint creation, secret entry, DNS for `api.myaipa.ca`, and production deploy/push approval. The live site still serves old bundle `main.62f74467.js`, and `api.myaipa.ca` currently returns DNS `ENOTFOUND`.
- Files changed this run: `.env.example`, `server/index.js`, `src/config/apiBase.js`, `src/AdminDashboard.css`, `src/AdminDashboard.js`, `src/CustomerDashboard.js`, `src/Signup.js`, `src/index.js`, `public/index.html`, `public/manifest.json`, `public/sw.js`, `render.yaml`, `config/backend.env.example`, `config/vapi-agent-evals.json`, `BACKEND_DEPLOY.md`, `scripts/build-pages.js`, `scripts/browser-drive.js`, `scripts/diagnose-live-site.js`, `scripts/diagnose-signup.js`, `scripts/test-signup-payload.js`, `scripts/diagnose-visual.js`, `scripts/telegram-send-admin-customers-mock.js`, `scripts/validate-render-blueprint.js`, `package.json`, `src/LandingPage.js`, and generated `docs/` assets.
- Checks passed: `npm run render:validate`, `npm run backend:check`, `npx prisma validate`, `node scripts/check-backend-deploy.js`, `npm run diagnose:signup`, `npm run evals:vapi:dry-run`, `npm run build:pages`, `npm run diagnose:visual -- --url=http://127.0.0.1:3101` including `/#/dashboard` and `/#/admin`, `npm run diagnose:visual -- --url=http://127.0.0.1:3102`, `npm run find:todos -- --url=http://127.0.0.1:3101` including `/#/dashboard` and `/#/admin`, `npm run diagnose:site`, `npm run diagnose:live-site`, `node --check server\index.js`, `node --check scripts\browser-drive.js`, `node --check scripts\diagnose-live-site.js`, `node --check scripts\setup-vapi-evals.js`, `node --check scripts\telegram-send-admin-customers-mock.js`, `node --check scripts\validate-render-blueprint.js`, local backend header/auth probe on port 8799, local read-only Stripe Trials endpoint probe on port 8797, customer dashboard session-storage Playwright smoke test, customer dashboard rate-limit local backend probe, Vapi eval JSON parse/count check, server env-template coverage audit, local admin mock desktop/mobile Playwright captures, local admin Stripe Trials mock capture, checkout-return route smoke tests for `/#/signup?payment=success` and `/#/signup?payment=cancelled`, and a lightweight Playwright accessibility/SEO probe.
- Checks blocked: `npm run diagnose:vapi-agents` could not run because `VAPI_API_KEY` and `MAKE_API_TOKEN` are not set in the local environment.
- Review item: A broad local secret-pattern scan matched likely false positives in lockfile/old backup files (`package-lock.json`, `src/Hello.js`, backup copies); review before deployment, but no secrets were printed or edited. A stale old-API generated bundle also remains under `output/build-check/`; it is not the deployable `docs/` bundle.
- Next 3 human actions: create the Render Blueprint from `render.yaml`; fill Render secrets, including SMTP or set `TRIAL_REMINDER_DISABLE=true`; add DNS for `api.myaipa.ca`, verify `/api/health`, then approve the GitHub Pages deploy. After credentials are available, sync/run the safe Vapi evals explicitly.

## Latest www.myaipa.ca Frontend Build

The current `docs/` GitHub Pages output is the latest build intended for:

```text
https://www.myaipa.ca
```

Build label: `2026-07-12-api-base-trust-copy-a11y-admin-mobile-stripe-return-customer-privacy`

Current production bundles after `npm run build:pages`:

```text
docs/static/js/main.7186918e.js
docs/static/css/main.9f678dae.css
```

This is the latest `www.myaipa.ca` frontend build and includes the refreshed homepage hero for My AI PA:

- `AI Telephone Answering Assistant` hero badge.
- Tim's Electrical AI live-call demo with a service-van avatar mark.
- Updated live-call conversation for residential and commercial electrical work.
- Larger `Summary ready` badge and clearer `An Example of A Real Conversation` heading.
- Larger Details Captured, Owner Text, Customer Text, and trust-line copy.
- `PIPEDA-aware setup`, `14-day free trial`, and `No credit card required` shown as a readable two-line trust block.
- Laptop-height layout fixes so the hero cards fit without clipping.
- Production API defaults now point at `https://api.myaipa.ca` instead of the old Render fallback.
- The React entrypoint uses `createRoot` instead of deprecated `ReactDOM.render`.
- The signup hash route now handles checkout return URLs such as `/#/signup?payment=success`.
- Checkout return notices are shown for successful or cancelled Stripe returns.
- Customer dashboard email/phone lookup convenience now uses session storage, clears the legacy persistent localStorage key, and removes both values on sign-out.
- Render config now sets explicit Stripe success/cancel URLs that point back to `www.myaipa.ca`.
- Testimonial-style cards are now labeled as field examples until real customer permission is verified.
- The trust section now uses buyer-facing proof points instead of internal implementation notes.
- The admin overview cards now shrink correctly on mobile, with wide customer table columns constrained to the table scroll area instead of forcing page-level overflow.
- The admin dashboard now has a `Trials` nav item backed by a read-only `/api/admin/stripe-trials` endpoint that lists live Stripe trial counts, active trials sorted by trial end, ending-soon warnings, recently ended trials, and Stripe Dashboard links.

## Recurring Thread Request

The Codex app heartbeat `MyAIPA overnight code monitor` is active for safe local improvement work until 2026-07-12 08:00 America/Toronto.

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
- Backend API privacy/security hardening now adds no-store cache headers for admin/customer API responses, baseline API security headers, and rejects admin passwords supplied in query strings.
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
- Live/public drift diagnostic added:
  - `scripts/diagnose-live-site.js`
  - npm script: `npm run diagnose:live-site`
- Vapi eval suite expanded:
  - `config/vapi-agent-evals.json`
  - npm script: `npm run evals:vapi:dry-run`
  - Safe evals now cover social routing, repair pricing consent, caller-ID confirmation, out-of-scope trades, emergency safety escalation, respectful AI disclosure, and installation estimate routing.
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

## Most Recent Local Validation

The earlier `EPERM: operation not permitted, lstat 'C:\Users\Olive'` validation blocker did not reproduce in the overnight monitor. These checks passed on 2026-07-12:

```bash
npm run render:validate
npx prisma validate
```

`npx prisma validate` still warns that `package.json#prisma` is deprecated and should eventually move to `prisma.config.ts` before Prisma 7.

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
- The local `docs/` output is rebuilt with `https://api.myaipa.ca`; the live frontend will remain stale until the generated Pages output is pushed/deployed after backend DNS and health are ready:
- `npm run diagnose:live-site` confirms the public site currently serves stale `static/js/main.62f74467.js` / `static/css/main.c5f1f9b2.css`, while local `docs/` has `static/js/main.6de62138.js` / `static/css/main.dfabbbe9.css`. The public bundle still contains old Render and localhost API references until Pages is deployed.
- `https://api.myaipa.ca/api/health` currently fails DNS lookup with `getaddrinfo ENOTFOUND api.myaipa.ca`; this is expected until Render and DNS are configured.

```text
REACT_APP_API_BASE_URL=https://api.myaipa.ca
```

## Overnight Monitor Log

### 2026-07-12 13:39 - Live Deploy Readiness and Pages Push Prep

- Priority worked: deploy readiness, GitHub Pages freshness, admin Stripe trials verification, signup/admin reliability, Vapi dry-run coverage, and trust/SEO metadata.
- User request: proceed with the next launch checklist as far as safely possible.
- Safe fix made:
  - Corrected stale PWA metadata from `Star Runner` to `My AI PA` in the source `public/` files and regenerated `docs/` so the deployable HTML, manifest, and service worker no longer advertise an unrelated game.
  - Removed the old `#/game` route import from the production router so the public MyAIPA bundle no longer ships the unrelated Star Runner app code.
- Commands/checks run:
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - `npx prisma validate` passed with the existing Prisma 7 deprecation warning for `package.json#prisma`.
  - `node --check server\index.js` passed.
  - `npm run build:pages` passed after the metadata/game-route fix and produced `docs/static/js/main.7186918e.js` plus `docs/static/css/main.9f678dae.css`.
  - `npm run diagnose:signup` passed; signup endpoint config resolves to `https://api.myaipa.ca`.
  - `npm run diagnose:site` passed locally and confirmed the local `docs/` bundle is newer than the live site.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed `www.myaipa.ca` is still serving stale `main.62f74467.js`; `https://api.myaipa.ca/api/health` still fails DNS with `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed; no Vapi changes were made.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3102` passed for homepage, signup, dashboard, and admin across desktop/mobile viewports.
  - `npm run find:todos -- --url=http://127.0.0.1:3102` completed with only the low-priority manual hero screenshot reminder.
- Deployment access status:
  - GitHub CLI is authenticated for `OllieinCanada`, so a targeted GitHub push can be attempted after a staged secret scan.
  - No `RENDER_API_KEY`/`RENDER_TOKEN` or DNS provider API token is available in the local environment, so Render secret entry, Render service creation, and DNS changes still require a logged-in dashboard/API step.
- Staging policy for the next step: stage only deploy/backend/frontend/docs allowlisted files; leave unrelated local output, tools, data, and X job-finder files untracked.

### 2026-07-12 13:05 - Admin Stripe Trials Dashboard Pass

- Priority worked: admin reliability, signup/trial visibility, owner handoff quality, and safe billing observability.
- Safe fixes made:
  - Added read-only backend endpoint `GET /api/admin/stripe-trials`, protected by existing admin auth, to summarize Stripe subscription trials without exposing secrets or payment method data.
  - Added a first-class admin `Trials` nav item showing active live Stripe trials, ending-soon count, all subscription status counts, account payout warning, recently ended trials, and direct Stripe Dashboard links.
  - Updated admin routing/priority shortcuts so Stripe/trial-related actions open the new Trials view.
  - Updated the local admin browser mock with a Stripe Trials response for repeatable visual diagnostics.
  - Made the local backend load `.env.local` and tolerate PowerShell-style `$env:STRIPE_SECRET_KEY="..."` assignments for local development only.
- Commands/checks run:
  - `node --check server\index.js` passed.
  - `npm run build:pages` passed and produced `docs/static/js/main.759145e8.js` plus `docs/static/css/main.8c2e6edc.css`.
  - Local read-only backend probe on port `8797` passed against live Stripe with temporary local admin credentials: 4 total subscriptions, 4 active trials, 0 ending within 3 days, 0 recently ended in the last 30 days. The probe did not print the Stripe key and did not mutate Stripe.
  - `node scripts/browser-drive.js --url=http://127.0.0.1:3101/#/admin --mock-admin --viewport=1365x768 --action="click:role=button:Trials" --action="wait-for:text=Live subscriptions in Stripe" --screenshot=admin-stripe-trials.png` passed; screenshot looked readable with no obvious table/card overlap.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3102` passed with no obvious visual issues.
- Files changed in this pass: `server/index.js`, `src/AdminDashboard.js`, `src/AdminDashboard.css`, `scripts/browser-drive.js`, `DEPLOY_STATUS.md`, and generated `docs/` assets.
- Next human action: in production Render, make sure `STRIPE_SECRET_KEY` is set on the backend so the new admin Trials view can read live Stripe. Keep `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` set for checkout/webhook behavior.
- No deployment, push, Render account action, DNS action, scheduler change, production database mutation, phone call, SMS/email send, Telegram send, live Vapi mutation, or Stripe mutation was performed.

### 2026-07-12 01:51 - Preflight

- Active Codex heartbeat: `MyAIPA overnight code monitor`, scoped to safe local improvement work in this repo until 2026-07-12 08:00 America/Toronto.
- Windows sleep-after setting is disabled on AC and battery. The lid-close action was not exposed by the current `powercfg` query, so leave the laptop open and plugged in for best overnight reliability.
- `npm run render:validate` passed.
- `npx prisma validate` passed. Prisma emitted a deprecation warning for `package.json#prisma`; this is not a deploy blocker, but should be migrated to `prisma.config.ts` before Prisma 7.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, or live Vapi mutation was performed.

### 2026-07-12 02:19 - First Overnight Run

- Priority worked: deploy readiness, signup/admin reliability, Vapi dry-run readiness, and homepage visual health.
- Safe fixes made:
  - Changed production API defaults from `https://myaipa-api.onrender.com` to `https://api.myaipa.ca` in `src/config/apiBase.js`, `scripts/build-pages.js`, `scripts/diagnose-signup.js`, and `scripts/test-signup-payload.js`.
  - Updated visual diagnostics expected homepage text to match current copy (`Owner Text`, `Instantly sends`).
  - Added compact desktop/laptop hero dashboard CSS so the first viewport no longer clips the live-call dashboard at 1440x900, 1536x650, or 1365x768.
  - Updated the React entrypoint from deprecated `ReactDOM.render` to `createRoot`.
- Commands run:
  - `npm run render:validate` passed.
  - `npx prisma validate` passed with the Prisma 7 config deprecation warning.
  - `node scripts/check-backend-deploy.js` passed.
  - `npm run diagnose:signup` passed and now reports `https://api.myaipa.ca` as the fallback API base.
  - `npm run evals:vapi:dry-run` passed without network mutation.
  - `npm run build:pages` passed and produced `docs/static/js/main.d430a68a.js`.
  - A local docs preview was started at `http://127.0.0.1:3101`.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious visual issues.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed; remaining TODOs are buyer-facing trust proof, testimonial permission, and manual Firefox-window screenshot inspection.
  - `npm run diagnose:vapi-agents` was attempted but blocked because `VAPI_API_KEY` and `MAKE_API_TOKEN` are not set.
- Research sources used: none in this run; local build, diagnostics, and repo evidence were higher priority.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, or live Vapi mutation was performed.

### 2026-07-12 02:44 - Trust, Accessibility, and Privacy Pass

- Priority worked: website trust copy, privacy/security confidence, accessibility, and visual health.
- Safe fixes made:
  - Replaced the `PIPEDA Compliant` hero claim with `PIPEDA-aware setup` to avoid overclaiming before legal review.
  - Relabeled testimonial-style content as field examples and common workflows until real customer permission is verified.
  - Replaced the internal note about verification badges/tokens with buyer-facing proof points: public privacy/terms, no-credit-card trial, demo audio, transcripts, and text follow-up examples.
  - Changed a hidden legacy homepage `h1` to `h2`, leaving one visible `h1` per checked route.
- Commands/checks run:
  - `npm run build:pages` passed and produced `docs/static/js/main.6cea7be1.js`.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious visual issues.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed; only remaining TODO is manual Firefox-window screenshot inspection.
  - A Playwright accessibility/SEO probe passed for `/`, `/#/signup`, `/#/privacy`, and `/#/terms`: one `h1` per route, meta description present, no missing image alt text, no unnamed buttons, and no unnamed links.
  - The Firefox-window hero screenshot was manually inspected and looked readable with no first-viewport clipping.
  - Old API URL search found active source and generated docs using `https://api.myaipa.ca`; the only old Render fallback mention is in a mock admin screenshot script, which is not production code.
  - A broad secret-pattern scan flagged likely false positives in `package-lock.json`, `src/Hello.js`, `src/Hello.js.bak_tailfix`, and backup copies. No secret values were printed or edited; review these legacy/backup files before deployment.
- Research sources used:
  - [Office of the Privacy Commissioner of Canada: meaningful consent](https://www.priv.gc.ca/en/privacy-topics/business-privacy/collecting-personal-information/consent/gl_omc_201805/) - supports clear, understandable privacy explanations rather than vague compliance claims.
  - [Office of the Privacy Commissioner of Canada: PIPEDA fair information principles](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/) - supports consent, safeguards, limited use, and access/correction framing.
  - [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm) - supports consent, identification, and unsubscribe expectations for commercial electronic messages.
  - [MDN text labels and names](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Text_labels_and_names) and [MDN aria-label](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label) - supports checking headings and accessible names.
  - [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [Render environment variables and secrets](https://render.com/docs/configure-environment-variables) - confirms Blueprint/env-var patterns and keeping secret values out of `render.yaml`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, or live Vapi mutation was performed.

### 2026-07-12 02:47 - Stale URL and Site Diagnostic Pass

- Priority worked: stale environment assumptions, admin mock diagnostic reliability, and Pages deployment readiness.
- Safe fix made:
  - Updated `scripts/telegram-send-admin-customers-mock.js` so the mock Customers-tab screenshot helper accepts `TELEGRAM_ADMIN_MOCK_URL` and intercepts `**/api/admin/**` instead of only the old `https://myaipa-api.onrender.com/api/admin/**` route.
- Commands/checks run:
  - `node --check scripts\telegram-send-admin-customers-mock.js` passed.
  - `npm run diagnose:site` passed and confirmed `docs/index.html` points at `static/js/main.6cea7be1.js`.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed with no obvious visual issues; the only remaining TODO report item is manual Firefox-window hero screenshot inspection, which was already checked in the previous pass.
  - Old Render API URL search found no active source/deployable `docs/` matches after excluding stale generated artifacts. A stale old-API bundle remains under `output/build-check/`; it was not deleted because it is generated output outside the deployable Pages bundle.
- Research sources used: none in this pass; repo diagnostics were sufficient.
- Files changed in this pass: `scripts/telegram-send-admin-customers-mock.js` and `DEPLOY_STATUS.md`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, or live Vapi mutation was performed.

### 2026-07-12 03:20 - Admin Mobile and Mock Diagnostic Pass

- Priority worked: signup/admin reliability, local admin visual diagnostics, Pages build readiness, and stale diagnostic assumptions.
- Issue found:
  - Local admin mock screenshots initially showed intermittent failed API loads and a mobile full-page screenshot width of `953px` for a `390px` viewport. The admin cards/table were forcing the page-level capture wider than the phone viewport, making later admin columns effectively clipped on mobile.
- Safe fixes made:
  - Updated `scripts/browser-drive.js` mock admin mode to return explicit admin response shapes for session, leads, and analytics endpoints.
  - Added CORS-style headers and `OPTIONS` handling to the local mock admin route.
  - Blocked service workers in the Playwright browser context so static Pages service worker state cannot interfere with mocked admin diagnostics.
  - Updated `src/AdminDashboard.css` so admin overview containers can shrink on mobile and only the customer table scrolls horizontally.
- Commands/checks run:
  - `node --check scripts\browser-drive.js` passed.
  - `npm run build:pages` passed and produced `docs/static/js/main.6cea7be1.js` plus `docs/static/css/main.dfabbbe9.css`.
  - `npm run diagnose:site` passed and confirmed `docs/index.html` points at `static/js/main.6cea7be1.js` and `static/css/main.dfabbbe9.css`.
  - `npm run browser:drive -- --url=http://127.0.0.1:3101/#/admin --mock-admin --viewport=1365x768 --wait=5000 "--wait-for=text=Oliver" --screenshot=admin-desktop-postfix-mock.png --viewport-only` passed.
  - `npm run browser:drive -- --url=http://127.0.0.1:3101/#/admin --mock-admin --viewport=390x844 --wait=5000 "--wait-for=text=Oliver" --screenshot=admin-mobile-postfix-full-mock.png` passed; screenshot dimensions are now `390x2224`, confirming the page-level mobile overflow is gone.
  - `npm run render:validate` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed; captcha remains disabled with honeypot, timing, and browser attempt limiting.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious homepage/signup visual issues.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed; the only automated TODO remains manual Firefox-window hero screenshot inspection, already checked in the prior pass.
  - `npm run diagnose:vapi-agents` is still blocked because `VAPI_API_KEY` and `MAKE_API_TOKEN` are not set locally.
- Research sources used: none in this pass; local diagnostics and repo evidence were sufficient.
- Files changed in this pass: `scripts/browser-drive.js`, `src/AdminDashboard.css`, `DEPLOY_STATUS.md`, and generated `docs/` CSS/assets.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, or live Vapi mutation was performed.

### 2026-07-12 03:40 - Live/Public Drift Diagnostic Pass

- Priority worked: public/local website assumptions, deployment readiness, frontend API-base drift, and exact morning actions.
- Safe fix made:
  - Added `scripts/diagnose-live-site.js` and npm script `npm run diagnose:live-site` for repeatable read-only public checks of `https://www.myaipa.ca/`, public bundle hashes, public bundle API-base strings, and `https://api.myaipa.ca/api/health`.
- Commands/checks run:
  - `node --check scripts\diagnose-live-site.js` passed.
  - `npm run diagnose:live-site` passed as a diagnostic and saved `diagnostics/live-site/live-site-report.md`.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.6cea7be1.js` and `static/css/main.dfabbbe9.css`.
- Public/live findings:
  - `https://www.myaipa.ca/` returned HTTP 200.
  - Public site still serves stale `static/js/main.62f74467.js` and `static/css/main.c5f1f9b2.css`.
  - Local `docs/` serves `static/js/main.6cea7be1.js` and `static/css/main.dfabbbe9.css`.
  - Public bundle scan found old Render API and localhost API references, and did not find `https://api.myaipa.ca`; this confirms the live frontend is stale until Pages deploy is approved.
  - `https://api.myaipa.ca/api/health` failed with `getaddrinfo ENOTFOUND api.myaipa.ca`, confirming DNS/Render setup is still external launch work.
- Research sources used: none in this pass; the diagnostic used read-only public HTTP checks.
- Files changed in this pass: `scripts/diagnose-live-site.js`, `package.json`, and `DEPLOY_STATUS.md`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, or live Vapi mutation was performed.

### 2026-07-12 04:18 - Stripe Return and Render Env Pass

- Priority worked: Render deploy readiness, checkout/signup reliability, env documentation, and local Pages verification.
- Issue found:
  - `PUBLIC_APP_URL` is correctly set to the API host for backend identity, but Stripe Checkout falls back to `PUBLIC_APP_URL/#/signup?...` if explicit return URLs are absent. Without explicit Stripe URLs, customers could return to `https://api.myaipa.ca/#/signup?...` after checkout.
  - The frontend hash router treated `#/signup?payment=success` as a route named `signup?payment=success`, which could send returning checkout users to the homepage instead of the signup return state.
- Safe fixes made:
  - Added explicit `STRIPE_SUCCESS_URL=https://www.myaipa.ca/#/signup?payment=success` and `STRIPE_CANCEL_URL=https://www.myaipa.ca/#/signup?payment=cancelled` to `render.yaml`.
  - Expanded `config/backend.env.example` with the Stripe return URLs and production env knobs that `server/index.js` already reads for verification TTL/base URL, Vapi auto-sync interval, call transcript/recording storage and retention, Twilio API base, and fixed monthly cost settings.
  - Updated `scripts/validate-render-blueprint.js` so `npm run render:validate` fails if the Render Blueprint loses the website checkout return URLs.
  - Updated `BACKEND_DEPLOY.md` to document that `PUBLIC_APP_URL` is the backend URL while Stripe success/cancel URLs must point at `www.myaipa.ca`.
  - Updated `src/index.js` to strip query/hash suffixes before route matching, so checkout return URLs resolve to the signup route.
  - Added small signup return notices for successful or cancelled Stripe returns.
- Commands/checks run:
  - `node --check scripts\validate-render-blueprint.js` passed.
  - `npm run render:validate` passed.
  - `npm run build:pages` passed and produced `docs/static/js/main.bbbd6275.js` plus `docs/static/css/main.dfabbbe9.css`.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious visual issues.
  - `npm run diagnose:site` passed and confirmed the local `docs/` bundle points at `static/js/main.bbbd6275.js`.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`) and `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - Playwright route smoke test for `http://127.0.0.1:3101/#/signup?payment=success` passed: the page rendered `Create your AI phone assistant`, showed `Checkout complete`, and did not show the homepage hero.
  - Playwright route smoke test for `http://127.0.0.1:3101/#/signup?payment=cancelled` passed: the page rendered `Create your AI phone assistant`, showed `Checkout cancelled`, and did not show the homepage hero.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed with no obvious visual issues; the remaining low item is manual Firefox-window hero screenshot inspection.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - Local env check confirmed `VAPI_API_KEY` and `MAKE_API_TOKEN` are still unset, so live Vapi diagnostics remain blocked.
- Research sources used: none in this pass; repo evidence and local verification were sufficient.
- Files changed in this pass: `render.yaml`, `config/backend.env.example`, `scripts/validate-render-blueprint.js`, `BACKEND_DEPLOY.md`, `src/index.js`, `src/Signup.js`, `DEPLOY_STATUS.md`, and generated `docs/` assets.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, or live Vapi mutation was performed.

### 2026-07-12 04:42 - Env Coverage and Signup Guardrails Pass

- Priority worked: Render deploy readiness, signup reliability/security, env documentation, and backend startup assumptions.
- Issue found:
  - `server/index.js` already reads signup rate-limit, duplicate-review, trial-reminder, captcha fallback, OpenAI assistant/transcription, and cost-setting env vars, but the production env template did not list all of them.
  - Trial reminders are enabled by default. Without SMTP secrets, reminder attempts would fail later in production logs, so the deployment guide needs to make the SMTP-or-disable choice explicit.
- Safe fixes made:
  - Added signup anti-abuse defaults to `config/backend.env.example`, `.env.example`, and `render.yaml`: IP/identity windows, duplicate window, minimum elapsed time, and `SIGNUP_REVIEW_DUPLICATES=true`.
  - Added explicit trial reminder defaults to `config/backend.env.example` and `render.yaml`.
  - Added optional captcha fallback and OpenAI assistant/transcription env names to the env examples so future diagnostics do not depend on hidden assumptions.
  - Added fixed monthly cost env names to `.env.example` for local/admin cost parity.
  - Extended `scripts/validate-render-blueprint.js` to assert the new signup/reminder/Stripe trial env defaults in `render.yaml`.
  - Updated `BACKEND_DEPLOY.md` to tell the morning deployer to configure SMTP for trial reminders or set `TRIAL_REMINDER_DISABLE=true`.
- Commands/checks run:
  - `node --check scripts\validate-render-blueprint.js` passed.
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - Server env-template coverage audit passed: no non-alias backend env vars are missing from `config/backend.env.example` or `.env.example`.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.bbbd6275.js` and `static/css/main.dfabbbe9.css`.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`) and `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run diagnose:vapi-agents` was not rerun because the same credential blocker remains: `VAPI_API_KEY` and `MAKE_API_TOKEN` are not set locally.
- Research sources used:
  - [Stripe Checkout Session create API](https://docs.stripe.com/api/checkout/sessions/create) - supports keeping explicit `success_url` and `cancel_url` targets for hosted Checkout.
  - [Stripe custom success page guide](https://docs.stripe.com/payments/checkout/custom-success-page) - reinforces returning customers to a real website page and using webhooks/server checks for reliable fulfillment.
  - [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [Render environment variables and secrets](https://render.com/docs/configure-environment-variables) - support Blueprint-managed non-secret env values and `sync: false` placeholders for secret values.
- Files changed in this pass: `.env.example`, `config/backend.env.example`, `render.yaml`, `scripts/validate-render-blueprint.js`, `BACKEND_DEPLOY.md`, and `DEPLOY_STATUS.md`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, or live Vapi mutation was performed.

### 2026-07-12 05:10 - Vapi Eval Coverage Pass

- Priority worked: Vapi/voice-agent quality checks, missed-lead prevention, customer trust, emergency escalation, and safe handoff behavior.
- Issue found:
  - The local Vapi eval suite covered social routing, repair pricing consent, explicit callback number capture, out-of-scope trade handling, and structured SMS tools, but it did not explicitly test emergency safety escalation, respectful AI disclosure, or installation/estimate routing.
- Safe fixes made:
  - Added safe-by-default eval `MYAIPA 06 - Emergency Safety Escalation` to ensure active danger is escalated to emergency guidance instead of normal repair booking.
  - Added safe-by-default eval `MYAIPA 07 - Respectful AI Disclosure` to ensure the assistant says it is an AI/virtual assistant and does not guarantee a technician arrival time.
  - Added safe-by-default eval `MYAIPA 08 - Installation Estimate Routing` to ensure EV charger/install estimate callers are not routed through repair diagnostic pricing.
  - Renumbered the two local-only tool-call evals to `MYAIPA 09` and `MYAIPA 10`, preserving their previous names in `legacyNames` so future syncs can update rather than duplicate.
- Commands/checks run:
  - Vapi eval JSON parse/count check passed: 10 evals total, 8 safe/default-sync evals, and 2 local-only mock-target tool-call evals.
  - `npm run evals:vapi:dry-run` passed and made no Vapi changes.
  - `node --check scripts\setup-vapi-evals.js` passed.
  - `npm run diagnose:vapi-agents` was attempted and blocked by the expected missing local credentials: `VAPI_API_KEY` and `MAKE_API_TOKEN`.
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.bbbd6275.js` and `static/css/main.dfabbbe9.css`.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`) and `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run build:pages` was not rerun in this pass because only the Vapi eval JSON and handoff docs changed; `npm run diagnose:site` confirmed the existing local Pages build remains present.
- Research sources used: none in this pass; repo evidence and local eval definitions were sufficient.
- Files changed in this pass: `config/vapi-agent-evals.json` and `DEPLOY_STATUS.md`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

### 2026-07-12 05:38 - Admin API Privacy Headers Pass

- Priority worked: privacy/security trust, admin reliability, customer-data handling, and backend startup assumptions.
- Issue found:
  - Admin and customer API responses can include lead details, call summaries, transcripts, recordings, signup details, owner contact data, and setup state, but the backend did not explicitly mark those JSON responses as no-store.
  - Admin password auth accepted `?password=...` query strings in addition to the existing POST body/header paths. Query strings are easier to leak through browser history, logs, analytics, referrers, and screenshots.
- Safe fixes made:
  - Added baseline backend security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and `X-Robots-Tag` for API responses.
  - Added no-store headers for `/api/admin/*` and `/api/customer/*`: `Cache-Control: no-store, max-age=0`, `Pragma: no-cache`, and `Expires: 0`.
  - Removed query-string admin password support. Admin login still works through the existing POST body path and the existing `X-Admin-Password` header path.
- Commands/checks run:
  - `node --check server\index.js` passed.
  - `npm run backend:check` passed.
  - `npm run render:validate` passed.
  - Local backend probe on port `8799` passed with throwaway local admin credentials:
    - `GET /api/health` returned 200.
    - `POST /api/admin/login?password=...` returned 401.
    - `POST /api/admin/login` with JSON body password returned 200 and an HttpOnly cookie.
    - Authenticated `GET /api/admin/session` returned 200 with `Cache-Control: no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow`, and `X-Content-Type-Options: nosniff`.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.bbbd6275.js` and `static/css/main.dfabbbe9.css`.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`) and `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run build:pages` was not rerun in this pass because only backend server code and handoff docs changed; `npm run diagnose:site` confirmed the existing local Pages build remains present.
- Research sources used: none in this pass; local code inspection and runtime verification were sufficient.
- Files changed in this pass: `server/index.js` and `DEPLOY_STATUS.md`.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

### 2026-07-12 06:08 - Customer Dashboard Session Privacy Pass

- Priority worked: customer-data handling, privacy/security trust, signup/customer dashboard reliability, local Pages build readiness, and public/local drift.
- First steps completed: inspected `git status --short`, read `AGENTS.md`, reviewed `package.json` scripts and the `scripts/` folder, read the latest `DEPLOY_STATUS.md` handoff, and preserved the dirty worktree.
- Issue found:
  - The customer dashboard lookup convenience stored owner email and phone in persistent `localStorage`. Those values are not an admin password, but they are customer identifiers and do not need to persist after the browser session.
- Safe fixes made:
  - Updated `src/CustomerDashboard.js` to read/write the lookup convenience through `sessionStorage`, remove the legacy persistent `localStorage` key during migration, and clear both storage locations on sign-out.
  - Updated `src/Signup.js` so signup success prefill writes the customer dashboard lookup to `sessionStorage` and removes the old persistent key.
  - Rebuilt `docs/` so the current local Pages bundle is `docs/static/js/main.6de62138.js` with existing `docs/static/css/main.dfabbbe9.css`.
- Commands/checks run:
  - `npm run render:validate` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run build:pages` passed and produced `docs/static/js/main.6de62138.js`.
  - `npm run diagnose:site` passed and confirmed local `docs/` points at `static/js/main.6de62138.js` and `static/css/main.dfabbbe9.css`.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious visual issues.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed with the same low manual Firefox-window screenshot item.
  - `npm run backend:check` passed.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - Customer dashboard Playwright smoke test passed: legacy `localStorage` lookup was cleared, `sessionStorage` was set for the active session, and sign-out cleared both.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`), while local docs now has `main.6de62138.js`; `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run diagnose:vapi-agents` was attempted and blocked by the expected missing local credentials: `VAPI_API_KEY` and `MAKE_API_TOKEN`.
- Research sources used: none in this pass; local code inspection and verification were sufficient.
- Files changed in this pass: `src/CustomerDashboard.js`, `src/Signup.js`, `DEPLOY_STATUS.md`, and generated `docs/` assets.
- Product/privacy recommendation: after launch, replace email+phone lookup with a short-lived emailed magic link or verified customer portal token so dashboard access does not rely on stable personal identifiers.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

### 2026-07-12 06:38 - Customer Dashboard Lookup Rate Limit Pass

- Priority worked: customer-data handling, privacy/security trust, backend deployment readiness, Render env coverage, and public/local drift.
- First steps completed: inspected `git status --short`, read `AGENTS.md`, reviewed `package.json` scripts and the `scripts/` folder, read the latest `DEPLOY_STATUS.md` handoff, and preserved the dirty worktree.
- Issue found:
  - `/api/customer/dashboard` is a public owner lookup by signup email and phone number. It returns customer setup state and sanitized recent-call summaries after a match, but it did not have its own rate limiter like signup.
- Safe fixes made:
  - Added backend in-memory rate limits for customer dashboard lookups, split by requester IP and email+phone lookup identity.
  - Added `Retry-After` on limited dashboard lookup responses and a generic 429 message.
  - Added explicit `CUSTOMER_DASHBOARD_*` defaults to `.env.example`, `config/backend.env.example`, and `render.yaml`.
  - Extended `scripts/validate-render-blueprint.js` so `npm run render:validate` catches missing customer dashboard limiter defaults.
  - Updated `BACKEND_DEPLOY.md` to explain the customer-dashboard lookup limiter.
- Defaults added:
  - `CUSTOMER_DASHBOARD_IP_WINDOW_MS=900000`
  - `CUSTOMER_DASHBOARD_IP_MAX_REQUESTS=30`
  - `CUSTOMER_DASHBOARD_LOOKUP_WINDOW_MS=3600000`
  - `CUSTOMER_DASHBOARD_LOOKUP_MAX_REQUESTS=8`
- Commands/checks run:
  - `node --check server\index.js` passed.
  - `node --check scripts\validate-render-blueprint.js` passed.
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - Local backend rate-limit probe on port `8798` passed with temporary one-request test limits: first dashboard lookup returned 404 for an unknown valid owner lookup, second returned 429 with `Retry-After`.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.6de62138.js` and `static/css/main.dfabbbe9.css`.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`), while local docs has `main.6de62138.js`; `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with no obvious visual issues.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed with the same low manual Firefox-window screenshot item.
  - `npm run diagnose:vapi-agents` was attempted and blocked by the expected missing local credentials: `VAPI_API_KEY` and `MAKE_API_TOKEN`.
- Build note: `npm run build:pages` was not rerun in this pass because only backend/config/docs changed; the current local Pages build remains `docs/static/js/main.6de62138.js`.
- Research sources used: none in this pass; local code inspection and verification were sufficient.
- Files changed in this pass: `server/index.js`, `.env.example`, `config/backend.env.example`, `render.yaml`, `scripts/validate-render-blueprint.js`, `BACKEND_DEPLOY.md`, and `DEPLOY_STATUS.md`.
- Product/privacy recommendation: keep email+phone lookup rate limits for launch, then replace the lookup with a short-lived emailed magic link or verified customer portal token before broad self-serve rollout.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

### 2026-07-12 07:08 - Customer Dashboard Visual Diagnostic Coverage Pass

- Priority worked: website quality, customer dashboard reliability, visual health, accessibility smoke coverage, and public/local drift.
- First steps completed: inspected `git status --short`, read `AGENTS.md`, reviewed `package.json` scripts and the `scripts/` folder, read the latest `DEPLOY_STATUS.md` handoff, and preserved the dirty worktree.
- Issue found:
  - The customer dashboard had just gained privacy/session and backend rate-limit work, but the repeatable visual diagnostic still only checked the homepage and signup route. That left the owner dashboard login route uncovered in the normal screenshot/TODO pass.
- Safe fix made:
  - Updated `scripts/diagnose-visual.js` to include `/#/dashboard` in the route sweep.
  - Added expected dashboard login text checks for `Customer dashboard`, `Signup email`, and `Open Dashboard`.
  - Because `npm run find:todos` invokes `diagnose-visual`, the TODO finder now also inherits dashboard login coverage across desktop, Firefox-window, laptop, and mobile viewports.
- Commands/checks run:
  - `node --check scripts\diagnose-visual.js` passed.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with homepage, signup, and dashboard screenshots at `1440x900`, `1536x650`, `1365x768`, and `390x844`.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed and now checks `/#/dashboard`; the only remaining low item is manual Firefox-window hero screenshot inspection.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.6de62138.js` and `static/css/main.dfabbbe9.css`.
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`), while local docs has `main.6de62138.js`; `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run diagnose:vapi-agents` was attempted and blocked by the expected missing local credentials: `VAPI_API_KEY` and `MAKE_API_TOKEN`.
- Build note: `npm run build:pages` was not rerun in this pass because only a local diagnostic script and the handoff changed; the current local Pages build remains `docs/static/js/main.6de62138.js`.
- Research sources used: none in this pass; local diagnostics and repo evidence were sufficient.
- Files changed in this pass: `scripts/diagnose-visual.js` and `DEPLOY_STATUS.md`.
- Product/accessibility recommendation: keep dashboard login in the default visual sweep until the customer portal is replaced by magic-link/token auth, because this route is now part of the trust story for business owners.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

### 2026-07-12 07:38 - Admin Sign-In Visual Diagnostic Coverage Pass

- Priority worked: admin reliability, website visual health, accessibility smoke coverage, local diagnostics, and public/local drift.
- First steps completed: inspected `git status --short`, read `AGENTS.md`, reviewed `package.json` scripts and the `scripts/` folder, read the latest `DEPLOY_STATUS.md` handoff, and preserved the dirty worktree.
- Issue found:
  - The full admin dashboard had mock screenshot coverage, but the default visual/TODO sweep did not check the unauthenticated admin sign-in route. That route matters because it is the first admin experience on a stale or unauthenticated browser.
- Safe fix made:
  - Updated `scripts/diagnose-visual.js` to include `/#/admin` in the route sweep.
  - Added expected admin sign-in text checks for `Admin Dashboard`, `Admin Password`, and `Unlock Admin`.
  - Added a route-specific wait for admin so the script checks the actual sign-in gate after the safe `/api/admin/session` fallback, rather than the short-lived loading state when no local backend is running.
  - Because `npm run find:todos` invokes `diagnose-visual`, the TODO finder now inherits admin sign-in coverage across desktop, Firefox-window, laptop, and mobile viewports.
- Commands/checks run:
  - `node --check scripts\diagnose-visual.js` passed.
  - `npm run diagnose:visual -- --url=http://127.0.0.1:3101` passed with homepage, signup, dashboard, and admin screenshots at `1440x900`, `1536x650`, `1365x768`, and `390x844`.
  - `npm run find:todos -- --url=http://127.0.0.1:3101` passed and now checks `/#/admin`; the only remaining low item is manual Firefox-window hero screenshot inspection.
  - `npm run diagnose:site` passed and confirmed local `docs/` still points at `static/js/main.6de62138.js` and `static/css/main.dfabbbe9.css`.
  - `npm run render:validate` passed.
  - `npm run backend:check` passed.
  - `npx prisma validate` passed with the same Prisma 7 config deprecation warning.
  - `npm run diagnose:signup` passed.
  - `npm run diagnose:live-site` passed as a diagnostic and confirmed the live site is still stale (`main.62f74467.js`), while local docs has `main.6de62138.js`; `api.myaipa.ca` still has DNS `ENOTFOUND`.
  - `npm run evals:vapi:dry-run` passed without Vapi mutation.
  - `npm run diagnose:vapi-agents` was attempted and blocked by the expected missing local credentials: `VAPI_API_KEY` and `MAKE_API_TOKEN`.
- Build note: `npm run build:pages` was not rerun in this pass because only a local diagnostic script and the handoff changed; the current local Pages build remains `docs/static/js/main.6de62138.js`.
- Research sources used: none in this pass; local diagnostics and repo evidence were sufficient.
- Files changed in this pass: `scripts/diagnose-visual.js` and `DEPLOY_STATUS.md`.
- Product/accessibility recommendation: keep unauthenticated admin sign-in in the default visual sweep, and keep the separate mock-admin screenshot flow for authenticated dashboard panels.
- No deployment, push, Render account action, DNS action, scheduler change, secret entry, production database mutation, phone call, SMS/email send, Telegram send, live Vapi sync, live Vapi run, or live Vapi mutation was performed.

## External Steps Remaining

1. In Render, create a Blueprint from `render.yaml`.
2. Fill Render secret env vars:

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

3. Because trial reminders are enabled by default, either fill the SMTP settings above or set `TRIAL_REMINDER_DISABLE=true` before relying on production reminders.
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

9. After `VAPI_API_KEY` and `MAKE_API_TOKEN` are available and you are ready to touch Vapi, first rerun:

```bash
npm run evals:vapi:dry-run
```

Then sync/run only the safe evals. Do not include tool-call evals until a mock SMS target is wired:

```bash
npm run evals:vapi:run
```

## Recommended Resume Prompt

```text
Read DEPLOY_STATUS.md and continue the Render backend deploy.
```
