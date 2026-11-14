# History-sync exclusion reporting

Reports separate `verified_simulation`, `signup_intake` and `unresolved_routing`.
These are descriptive categories, not routing authorization, completion evidence,
incident closure or proof that any notification was delivered. All existing
resolver refusals, quarantine accounting and recovery gates remain unchanged.

Signup intake requires an inbound call with both exact server-configured
`VAPI_VOICE_SIGNUP_ASSISTANT_ID` and `VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID`; all supplied
aliases must agree. Names, caller metadata and phone text do not establish this.
Conflicting, malformed and incomplete routing always remains unresolved.

Historical simulations require a separately reviewed, operator-controlled private
`DATA_DIR/call-sync-simulation-evidence.json`. Missing or invalid evidence keeps
the classification unresolved. Do not classify arbitrary WebSocket calls as tests.
The file is reporting-only attestation, not cryptographic provider authentication.
Its source digests link selected saved simulation results; they do not prove that
an untrusted source was genuine. Review source provenance before preparing it.

Prepare a new local file (never overwrite) from reviewed saved provider simulation
results containing exactly one ended tester and one ended target WebSocket leg:

```text
node scripts/prepare-call-sync-simulation-evidence.js --out=<new-private-local-file> <reviewed-result-1.json> <reviewed-result-2.json>
```

This command makes no provider request and does not install anything on production.
Never commit private call IDs, result files or generated attestations. Installing
or changing the private production file is a separate approved operational step.
No production file is included in this release. Without it, historical simulations
remain conservatively unresolved; matching configured signup intake can still be
reported separately. Logs and sync results contain aggregate category counts;
they do not reset delivery receipts, rewrite customer data or replay calls.
