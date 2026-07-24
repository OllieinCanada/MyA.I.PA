# Service Text Consent and Suppression Runbook

Owner: Operations and Privacy Officer
Scope: owner alerts, caller confirmations, appointment updates, dashboard codes, and other application-originated service texts

## Implemented control

- One global suppression row is keyed by normalized phone number. A suppression follows the recipient across businesses.
- The signed inbound messaging webhook accepts standard STOP-family and START-family keywords.
- Ordinary backend sends and isolated phone-assistant tools check the same suppression store before sending.
- A suppressed recipient is skipped before a provider request is made.
- A missing or unavailable suppression check fails closed; it must not be treated as permission to send.
- The customer dashboard displays `Active`, `Paused`, or `Not configured` using provider-neutral wording.
- Message bodies are not stored in the suppression table. Only the preference keyword, source, timestamps, and last message identifier are retained for audit evidence.

## Production activation

Repository code alone does not activate inbound preference handling.

1. Deploy the schema change and confirm the `SmsSuppression` table exists.
2. Confirm Render has a strong `SMS_SUPPRESSION_API_KEY`, the public HTTPS `SMS_SUPPRESSION_CHECK_URL`, and the exact `TWILIO_INBOUND_WEBHOOK_URL`.
3. Configure the inbound messaging webhook for every active service-text number to POST to `https://api.myaipa.ca/api/webhooks/sms`.
4. Verify the provider signs inbound webhooks and that invalid signatures receive `401`.
5. Roll the current isolated SMS tool configuration to each active phone assistant. Read-back must show both suppression environment variables and the suppression code check.
6. Using an authorized test handset, send `STOP`; verify one global suppression row, no subsequent provider send attempt, and `Paused` in the customer dashboard.
7. Send `START`; verify the same row is resumed, a subsequent test service text is accepted, and the dashboard returns to `Active`.
8. Confirm the provider’s required automatic STOP/HELP/START confirmation language and behaviour with counsel before a paid external pilot. The application webhook intentionally returns empty TwiML so it does not create duplicate replies.

## Troubleshooting

- **Signature rejected:** confirm the exact public URL, scheme, host, path, proxy headers, and auth token. Do not bypass verification.
- **Consent check unavailable:** keep sending paused; restore database/API availability, then retest.
- **Assistant still sends:** its isolated tool is stale. Run the guarded rollout and require a healthy read-back before returning it to service.
- **Dashboard and send result disagree:** compare the normalized phone number, suppression row timestamps, and deployment version. Do not delete the row as a shortcut.
- **Recipient asks to opt out verbally:** document the request through the approved privacy channel and add the suppression through an authenticated administrative workflow once one is approved. Do not expose the private suppression endpoint to customers.

## Evidence

Retain release-gate output, signed webhook tests, STOP/START test timestamps, masked last-four routing evidence, assistant read-back results, and accountable approval. Do not put full phone numbers, message bodies, credentials, or customer data in public issues.
