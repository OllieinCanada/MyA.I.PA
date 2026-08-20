# My AI PA test strategy

## Purpose

No single test style can prove that the product is ready. My AI PA uses a layered test strategy so a passing mocked unit suite cannot hide a broken browser flow, database constraint, deployment configuration, accessibility issue, or provider integration.

The strategy is based on:

- [Playwright best practices](https://playwright.dev/docs/best-practices): test user-visible behavior, isolate journeys, and use resilient user-facing locators.
- [Playwright browser guidance](https://playwright.dev/docs/browsers): exercise Chromium, Firefox, WebKit, mobile, and tablet configurations.
- [Playwright accessibility guidance](https://playwright.dev/docs/accessibility-testing): automate detectable WCAG failures while retaining human review for issues tools cannot judge.
- [W3C accessibility evaluation guidance](https://www.w3.org/WAI/test-evaluate/): evaluate throughout development and do not treat one automated tool as complete accessibility proof.
- [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/): derive explicit verification requirements for application security controls.
- [OWASP Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/): combine code review, automated tests, deployment checks, and operational testing instead of relying on a single technique.
- [GitHub Actions PostgreSQL service guidance](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers): run integration tests against an actual PostgreSQL service in CI.

## Required layers

| Layer | Command or workflow | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Frontend component/regression | `CI=true npm test -- --watchAll=false` | Rendering rules, security regressions, signup state, demo data | Real browsers, network behavior, provider delivery |
| Backend and provider-contract | `npm run test:backend` | Validation, auth boundaries, redaction, idempotency logic, notification decisions, call tooling | Real PostgreSQL locking/constraints or live providers |
| Coverage report | `npm run test:backend:coverage` | Which executed server modules and branches have evidence | Correctness of uncovered behavior or meaningful assertions |
| PostgreSQL integration | `RUN_DATABASE_INTEGRATION=1 npm run test:database` | Real uniqueness races, replay claims, and cascades | Production database configuration and backups |
| Browser quality | `npm run build` then `npm run test:browser:quality` | Critical home/signup journey, desktop/tablet/mobile overflow, keyboard entry, serious/critical automated WCAG findings, browser runtime errors | Full WCAG conformance, usability with assistive technology, a real signup submission |
| Release gate | `npm run test:release` | Combined local regression, config, audit, build, and browser gate | Live provider delivery, legal approval, production monitoring |
| Production monitor | `npm run ops:monitor` | Public availability and operational health | Every customer journey or provider outage hidden behind a healthy endpoint |

## CI-specific checks

The quality workflow starts a disposable PostgreSQL 16 service, pushes the Prisma schema, runs database integration tests, builds the production site, installs current Playwright browser engines, then runs the browser quality suite in Chromium, Firefox, and WebKit.

The local Windows Playwright launcher is skipped by default because it stalled inside the installed browser runtime during this audit. CI remains mandatory. Set `RUN_LOCAL_PLAYWRIGHT=1` only when diagnosing the local launcher; responsive checks can also be performed through the in-app browser.

CodeQL also analyzes JavaScript and TypeScript changes on pull requests, pushes to `main`, and a weekly schedule. It complements example-based tests by checking for vulnerable data flows and security mistakes outside the cases the test suite executes.

The backend suite discovers every `tests/*.test.js` file through Node's test-directory discovery. This removes the previous risk that adding a test file without updating a second hard-coded list silently excluded it from release checks.

## Manual release checks that remain mandatory

Automated checks cannot certify the following. Record evidence for each release:

1. Complete one sandbox signup through the final submit and verify the user-facing confirmation.
2. Place one controlled call per changed live assistant; verify transcript, tool results, hang-up behavior, owner message, and customer message.
3. Use keyboard-only navigation and at least one screen reader on home, signup, admin login, and customer login.
4. Inspect the homepage and signup at current iPhone, iPad, laptop, and wide-desktop sizes.
5. Perform a real encrypted backup and restore drill against a disposable database.
6. Review authentication, authorization, session, input-validation, error-handling, and business-logic tests whenever an endpoint is added.
7. Confirm monitoring alerts reach the intended human and that duplicate alerts are suppressed.

## Known remaining gaps

- Live Vapi, Twilio, Make.com, email, and calendar delivery requires credentials and controlled external test calls; CI uses mocks and contract tests.
- The production dependency audit is clean, but the legacy Create React App/Jest development toolchain currently reports 36 advisories. Replace that toolchain deliberately rather than using `npm audit fix --force`, which proposes breaking dependency changes.
- Automated axe results are not WCAG conformance. A knowledgeable human and assistive-technology review are still required.
- The browser suite stops before a real trial submission so it never creates a customer or sends a message.
- Backup restore evidence cannot be produced without a disposable PostgreSQL target, `pg_dump`/`pg_restore`, and the backup encryption key.
- A formal threat model, periodic penetration test, load test with production-like traffic, and disaster-recovery timing exercise remain release-readiness work.
