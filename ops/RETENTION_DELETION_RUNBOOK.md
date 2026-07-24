# Retention and Deletion Runbook

Owner: Privacy Officer (appointment pending)
Technical owner: designated production operator
Review cycle: quarterly during pilot and at least annually afterward

This is an operational default, not legal advice. A legal hold, active dispute, regulator direction, customer contract, or statutory requirement can require longer retention. Holds must be written, scoped, approved, reviewed, and released.

## Approved operational defaults pending counsel confirmation

| Record category | Default retention | Disposal or review action |
|---|---:|---|
| Verification tokens | 24 hours | Automatic expiry and deletion |
| Admin sessions | 12 hours | Automatic expiry |
| Rate-limit and abuse records | 90 days | Delete or aggregate without reusable identifiers |
| Abandoned signup/inquiry | 30 days | Delete unless the person continues or a legal/security reason applies |
| Call recording URL | 30 days | Clear URL and request provider deletion where supported |
| Call transcript text | 30 days | Clear text and request provider deletion where supported |
| Call summary and lead record | 12 months after last activity | Review, export if instructed, then delete or de-identify |
| SMS content | 90 days | Delete content; retain only necessary delivery/compliance metadata |
| Delivery metadata | 24 months | Delete after complaint, dispute, and legal-hold review |
| Consent evidence | While relied on plus 3 years | Retain minimal proof; counsel must approve final period |
| Suppression/STOP record | While needed to prevent contact | Retain minimal normalized destination and scope |
| Closed support report | 24 months | Delete attachments/content first; retain minimal resolution metrics |
| Privacy request or complaint | 24 months after closure | Securely destroy after hold and limitation review |
| Breach record | At least 24 months after determination | PIPEDA minimum; retain longer only with documented reason |
| Privileged/admin audit event | 24 months | Expire after investigation and legal-hold review |
| Financial/tax record | Six years from the end of the last tax year to which it relates | Accountant/counsel confirms categories and exceptions |
| Active customer account/configuration | Contract term plus 90 days | Export if authorized, close providers, then delete |
| Point-in-time database recovery | Actual Render workspace recovery window | Record actual 3- or 7-day window from provider |
| Downloaded logical backup | Target 35 days, encrypted | Expire automatically after a restore-tested successor exists |

The CRA describes a general six-year period for business records. Do not use that period to keep unrelated call content.

## Daily audit

1. Run `npm run ops:retention:audit`.
2. Review counts only; the report must not contain transcripts, phone numbers, addresses, or message bodies.
3. Investigate any expired transcript or recording URL that remains populated.
4. Do not use apply mode while a legal hold, privacy request, incident, or provider investigation may involve those records.
5. When authorized, set `RETENTION_APPLY_CONFIRM=PURGE_EXPIRED_CALL_ARTIFACTS` and run `npm run ops:retention:audit -- --apply`.
6. Preserve the redacted report and approver/date in the private operations evidence store.

When running from an isolated worktree, set `OPERATIONS_ENV_FILE` to the protected `.env.local` path. The audit report contains counts and policy settings only, not database credentials or record content.

## Account closure

1. Verify the requester and authority.
2. Freeze new calls, messages, provisioning, integrations, and billing.
3. Record legal holds and records that must remain.
4. Offer the authorized customer export.
5. Delete or de-identify active database records not on hold.
6. Disconnect calendar and field-service integrations and revoke tokens.
7. Request deletion from Vapi, Twilio, OpenAI, Make, Render, email, monitoring, and other applicable providers.
8. Close or release phone numbers only after dependency and portability checks.
9. Add the deletion event to a protected ledger so a later backup restore reapplies it.
10. Issue a completion record that lists systems completed, systems pending, exceptions, owner, and date without exposing unnecessary personal information.

## Backup restoration rule

Before restored data serves traffic, replay every deletion, correction, withdrawal, suppression, and account-closure event that occurred after the backup timestamp. A restore is incomplete until that replay and a tenant-isolation check pass.

## Quarterly verification

Use synthetic records to confirm expiry in the primary database, provider systems, logs, exports, and backups. Record failures, corrective action, owner, due date, and retest evidence.

Official references:

- OPC recording guidance: https://www.priv.gc.ca/en/privacy-topics/surveillance/02_05_d_14/
- PIPEDA breach record rule: https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-64/section-6.html
- CRA records: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html
