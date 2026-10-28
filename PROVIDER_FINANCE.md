# Provider finance meter

The Money Dashboard includes a funding/cost panel. This is an operations aid, **not reconciled accounting or a payment console**.

## Sources and limits

| Provider | Automatic read | Requires dashboard verification |
| --- | --- | --- |
| Twilio | Balance; today and month-to-date `totalprice` usage | Recharge rule, reserve, actual next rental/billing date |
| Vapi | Aggregate saved call-cost estimates, with priced/saved coverage | Account credit balance and reload settings |
| Make | Organization rolling 30-day credits; subscription plan price and next bill | Final invoice/tax, billing-cycle remaining credits |
| Render | No supported billing-read connection in this implementation | Monthly estimate and actual next billing date |

Make: set backend-only `FINANCE_MAKE_ORGANIZATION_ID` and `FINANCE_MAKE_ZONE` (us1/us2/eu1/eu2). Uses existing `MAKE_AUDIT_API_TOKEN` or `MAKE_API_TOKEN` with `organizations:read`. Twilio uses existing backend account credentials. Missing permission/configuration remains unknown. Never add secrets to React build variables or use browser session cookies as billing credentials.

Admin GET requests start an on-demand, single-flight refresh no more than once per five minutes per server instance. There is no new scheduled job, Make scenario, dedicated worker or dependency on the call-answering path. Every external request is GET-only, redirect-blocked and time-limited. A database timeout bounds the whole refresh. Page polling pauses when hidden and stops on unmount.

RuntimeStore durably saves only normalized facts and original observation times. Each account configuration has a separate opaque storage namespace. Retained results survive restart, but expired and previous-period values are labelled; provider failures do not turn into zero. A failed database save is reported, not claimed durable. Multiple server instances may each perform a cached read refresh; they never perform provider writes.

Record missing dashboard facts through the signed-in page, including when they were actually checked. This only saves My AI PA admin records. It does **not** configure provider recharge settings. Trusted Origin plus a non-simple header protect these writes, in addition to the existing admin session. No card details, invoice links, raw responses or credentials are stored or returned by this module.

## Interpretation

- Twilio's `totalprice` already includes its categories: never add its child categories again. Pagination or an absent/ambiguous total is unknown, not a partial total claimed complete.
- Vapi totals from imported calls can be incomplete and can include externally billed telephony/model costs. They are shown separately, never added to Twilio to invent a grand total.
- Make credits are workload units, not cash or billing-cycle remaining credit. Plan price may differ from the taxed invoice.
- Top-ups fund a credit wallet; they are not an additional usage expense.
- Original currency is retained. No assumed exchange rate or mixed-currency profit.
- Usage periods for Twilio and saved calls use UTC calendar days/months. Make uses organization-timezone rolling days. Displayed check timestamps use the viewer's local timezone.
- Manual balances become stale after 24 hours; other manual facts after 30 days. Automatic facts become stale after 15 minutes or a failed provider refresh. A reload-trigger value is not proof recharge is enabled or payment will succeed.
- Warnings appear in this admin page only. They do not stop live calls, change billing, send Telegram notices, or replace an independent outage monitor.
- The older monthly revenue/profit section is explicitly a planning estimate, not actual Stripe cash received or reconciled profit.

## Verify and release

`npm run test:finance` runs isolated backend tests. Run the component test and `npm run build:pages`, then `npm run test:finance:browser` for offline full-app checks at 320/412/820/1180/1440 pixels. Browser fixtures are synthetic and are never production billing proof.

Deployment needs a separate user release request. After deployment, confirm the selected provider accounts and permissions, enter dashboard-verified facts, and compare API readings against the billing dashboards. No funding or renewals should be marked live-verified solely because local tests pass.
