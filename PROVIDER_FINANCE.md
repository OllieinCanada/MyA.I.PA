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

RuntimeStore durably saves only normalized facts and original observation times. Each provider has its own opaque storage namespace: reconnecting Make does not invalidate Render's records. Twilio uses its account SID, Make its organization/zone, Render its service (or explicitly configured `FINANCE_RENDER_WORKSPACE_ID`), and Vapi an explicitly configured `FINANCE_VAPI_ORGANIZATION_ID` or a slow derivation of the existing key. A Vapi key rotation without the optional stable organization identifier intentionally requires a new wallet check. No raw credentials or fast credential hashes are persisted.

The exact matching legacy v1 account configuration is copied forward without deleting old evidence or changing check timestamps. Unrelated legacy namespaces are never scanned or guessed. Previously hidden facts from a different legacy configuration require a new account check rather than an unsafe automatic reassignment. Imported Vapi usage remains aggregate saved application calls, not proof of current wallet activity.

Retained results survive restart, but expired and previous-period values are labelled; provider failures do not turn into zero. A failed database save is reported, not claimed durable. Multiple server instances may each perform a cached read refresh; they never perform provider writes.

Record missing dashboard facts through the signed-in page, including when they were actually checked. This only saves My AI PA admin records. It does **not** configure provider recharge settings. Trusted Origin plus a non-simple header protect these writes, in addition to the existing admin session. No card details, invoice links, raw responses or credentials are stored or returned by this module.

## Phases 1 and 2: trustworthy records and overview

- Every metric distinguishes provider-reported, manually checked, estimated, outdated and unknown data. Source, account context, original check time, currency and known period remain visible. Download time never replaces source freshness.
- The editor offers **Checked just now**, an explicit month for monthly estimates, a pre-save read-back, and an acknowledgement of the actual saved value/time. A lost acknowledgement is uncertain: refresh/check history before retrying; there is no automatic resubmission.
- Current manual facts and append-only before/after correction records commit in the same serializable database transaction. An identical submitted fact is a no-op. History is admin-only, account-scoped and limited to the latest 50 records returned per provider.
- Successful refreshes keep at most one immutable snapshot per provider per UTC hour, only while the page is used. Source timestamps are retained even after a failed read. This is sampled financial history, not continuous uptime monitoring, a complete invoice ledger, or a recovery backup. No retention/deletion job is introduced.
- Existing matching legacy manual facts become labelled history baselines, preserving their original observation time. The database schema is unchanged; RuntimeStore holds versioned keys.
- The overview prioritizes funding/data checks, shows Twilio and Vapi wallets separately, and shows known Make/Render monthly-plan subtotals **per currency**. It does not add overlapping usage to manufacture a business-wide total. Missing/stale sources remain explicit.
- The 7/30-day timeline combines recorded provider billing dates with the existing Twilio number schedule. Number renewals remain acquisition-date estimates with unknown amounts—not verified invoices, payment promises or a guaranteed charge date. Past dates trigger a recheck, not a failed-payment claim.
- Provider details and history expand on demand; status text does not rely on colour alone. The existing older customer/profit estimates are unchanged and are not reconciled accounting.

## Interpretation

- Twilio's `totalprice` already includes its categories: never add its child categories again. Pagination or an absent/ambiguous total is unknown, not a partial total claimed complete.
- Vapi totals from imported calls can be incomplete and can include externally billed telephony/model costs. They are shown separately, never added to Twilio to invent a grand total.
- Make credits are workload units, not cash or billing-cycle remaining credit. Plan price may differ from the taxed invoice.
- Top-ups fund a credit wallet; they are not an additional usage expense.
- Original currency is retained. No assumed exchange rate or mixed-currency profit.
- Usage periods for Twilio and saved calls use UTC calendar days/months. Make uses organization-timezone rolling days. Check timestamps explicitly use Toronto time; the editor accepts the viewer's local time and previews the Toronto equivalent. Calendar billing dates retain their recorded day.
- Manual balances become stale after 24 hours; other manual facts after 30 days. Monthly cost estimates additionally expire when their selected Toronto-calendar coverage month changes, even if entered recently. Renewal countdowns also use Toronto calendar days, including daylight-saving changes. Automatic facts become stale after 15 minutes or a failed provider refresh. A reload-trigger value is not proof recharge is enabled or payment will succeed.
- Warnings appear in this admin page only. They do not stop live calls, change billing, send Telegram notices, or replace an independent outage monitor.
- The older monthly revenue/profit section is explicitly a planning estimate, not actual Stripe cash received or reconciled profit.

## Verify and release

`npm run test:finance` runs isolated backend tests. Run the component test and `npm run build:pages`, then `npm run test:finance:browser` for offline full-app checks at 320/412/820/1180/1440 pixels. Browser fixtures are synthetic and are never production billing proof.

Deployment needs a separate user release request. After deployment, confirm the selected provider accounts and permissions, enter dashboard-verified facts, and compare API readings against the billing dashboards. No funding or renewals should be marked live-verified solely because local tests pass.
