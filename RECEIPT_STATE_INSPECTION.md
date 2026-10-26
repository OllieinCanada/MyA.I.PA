# Saved SMS receipt-state inspection

`GET /api/admin/twilio/receipt-state` uses the existing administrator session
authentication. A monitor key does not grant access. Responses use `no-store`.
Do not place administrator credentials in URLs or public Actions logs.

Use one of these query forms from an authenticated admin session:

- `?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z` searches at most 24 hours
  by saved job creation or latest update time. Bounds are inclusive/exclusive.
- Add `&cursor=<nextCursor>` for the next page. Each page contains at most 25 jobs.
- `?jobRef=<64 lowercase hexadecimal characters>` reads exactly one saved job.
  References come from inspection results; they are opaque saved receipt keys,
  never phone numbers, message SIDs or customer signup credentials.

Only durable database reads run in this handler. It does not call providers,
start workers, retry processing, send messages, initialize JSON stores, prune
incidents, update billing or clear alerts. Exceptions return a static 503 result
and are not passed into runtime incident capture. Bad selectors return 400.

Results distinguish the saved job processing state from its reported delivery
status. A completed job means the callback processor finished; it does not prove
that a signup completed or independently verify live provider delivery. Unknown
or malformed metadata remains unknown. Raw receipt contents, message SIDs,
customer identifiers, worker tokens and unrecognized error text are omitted.

Time-window matches are candidates, not exact historical incident correlation.
The store is not an immutable attempt history: later updates can move a job's
latest timestamp, and completed jobs are retained for only seven days. Follow
pagination, but do not interpret an empty result as proof that no job existed.
Even a complete metadata page is not complete historical coverage.

The two historical P2028 background-worker incidents lacked job, signup and
receipt correlation identifiers. This inspection enables private investigation
of saved state; it cannot reconstruct absent identifiers or authorize a replay.
Keep original operation outcomes unknown until separate exact receipt/attempt
evidence establishes them. This feature requires deployment before live use;
adding the inspection path does not resolve an incident.
