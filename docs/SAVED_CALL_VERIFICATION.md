# Verify one saved call record

The manual **Verify one saved call record** workflow runs only from reviewed `main` code. It uses the existing injected `MONITOR_API_KEY` to make one GET request to the monitor-authenticated `/api/internal/operations/call-record-verification` endpoint. It does not require exporting admin, database, Vapi or Twilio credentials.

After this change is reviewed, landed and deployed, select the workflow on `main` and enter the exact Vapi call UUID plus the expected business ID from trusted routing evidence. Do not paste credentials. The CLI can also run `npm run verify:saved-call` with `CALL_ID`, `BUSINESS_ID`, and securely injected `MONITOR_API_KEY`.

The endpoint reads at most two exact provider matches and counts the same carrier SID inside a bounded PostgreSQL read-only, repeatable-read transaction. It returns a hash of the requested UUID, closed status/check enums, timestamps and duration. It returns no names, phone numbers, raw call IDs, transcripts, recordings, message bodies or credentials. Business mismatch suppresses saved metadata. Invalid input, missing authentication, missing data, database failure and unrecognized metadata never count as a passed check. Duration must agree with saved timestamps within two seconds. The manual runner labels authentication, endpoint, network and saved-state failures separately.

`savedRecordVerified: true` means one saved Vapi record with the expected business, one carrier identity, a linked caller and consistent completed-call metadata. It is **saved database evidence**, not independent confirmation of live provider ownership, audio, delivery, quota correctness, or end-to-end service health. The tool does not place calls, send messages, replay events, change routes, clear incidents or repair records. Missing carrier identity and unknown end reasons remain unverified.

Before this endpoint is deployed, HTTP 404 is an unavailable check, not a successful test. The prepared feature branch must not be used to run production diagnostics.
