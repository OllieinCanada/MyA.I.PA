# Post-call persistence repair

The controlled inbound call answered and its customer/owner SMS tool returned one
message ID for each role. Both carrier receipts were delivered, and the user
confirmed one customer handset receipt. Two **later** call-record saves expired
their 3000ms interactive transactions (5907ms and4968ms elapsed). This is not an
assistant-selection or confirmation rejection.

## Scoped change

- Only terminal Vapi ingestion with an exact provider ID gets an 8000ms
  transaction budget. Sparse ended-status events need not contain endedAt yet;
  the final report enriches the same row. The answering limits are unchanged.
- Database query/lock limits remain1500ms/800ms and acquisition remains500ms.
- One fresh identity-checked transaction may reconcile an expired terminal write.
  It first resolves/locks the existing unique call, including an uncertain previous
  commit; it does not retry any SMS, call, signup, payment or resource operation.
- Identity conflicts and unrelated failures are not blindly retried. Both startup
  and uniqueness recovery share the same one-retry budget. Persistent failure is
  still an error, not a successful webhook acknowledgement.
- Stage-only timing diagnostics distinguish configuration, identity read and
  create/update delays without recording SQL, transcript, contact or credentials.
- The alert names a post-call record failure and preserves uncertainty about the
  separate conversation/message outcome.

This is a bounded compatibility repair, not proof of the precise infrastructure
pause behind the old errors. Minute-average CPU/RAM data did not show saturation.
A severe outage can still fail both attempts; existing provider sync remains a
separate recovery mechanism and its old success cannot prove this call recovered.

## Validation / rollout

`npm run test:postcall` uses local synthetic/mocked transports.
`npm run test:voice-reliability` protects the unchanged answering/trial path.
`npm run test:postcall:postgres` is opt-in and must run only in the loopback,
empty, explicitly named CI database accepted by `postcall-drill-safety.js`.
The dedicated PostgreSQL18 workflow tests ~6s observed response delay, concurrent
terminal/final-report ingestion, realP2028 expiry, lost commit acknowledgement,
bounded repeated failure and real authenticated loopback webhooks with no outbound
provider traffic. Its artifact is tied to the exact candidate SHA.

Merge/deployment need fresh exact-head approval. Dad's assistant/tool/routing and
credentials are unchanged. After rollout, verify the exact missing call record,
saved notification evidence and trial accounting using read-only checks; do not
resend a message or silently close the incident. If provider sync has not recovered
the missing record, an explicitly bounded database-only recovery is still needed.
