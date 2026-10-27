# Post-release verification

Scheduled Vapi syncs save one bounded metadata receipt after complete result accounting. Limited/manual syncs bypass that monitor. Receipt storage failure logs a static diagnostic and does not replay the job or alter existing recovery policy. No provider requests are added.

`GET /api/internal/operations/postrelease-verification` requires the existing monitor key, rejects query parameters, and uses a PostgreSQL read-only RepeatableRead transaction. It reads completion metadata, stored critical-incident counts and aggregate callback queue health without invoking cleanup helpers. The response contains no customer, message, call, incident or job identifiers.

Sync verification requires a nonempty, internally consistent completion on the running release, no future timestamp, age at most 30 minutes, and no newer active sync failure. Missing, empty, stale and previous-release evidence stays unverified.

The main-only manual workflow `verify-postrelease.yml` makes one fixed GET with the existing Actions monitor secret. It sends no alerts and performs no actions. Exit 1 means access/request/schema evidence is unavailable. Exit 2 preserves partial coverage: aggregate callback health cannot establish the original historical operation outcomes or live provider delivery. No incident closure is permitted by this report, including when historical rows are absent.
