# Privacy Request and Complaint Runbook

Owner: Privacy Officer (appointment pending)
Intake address: pending confirmation
Target: acknowledge within two business days; complete a PIPEDA access response within 30 days unless a lawful extension applies

## Intake

Accept requests for access, correction, deletion, consent withdrawal, message suppression, export, or complaint through the approved privacy channel or an authenticated customer dashboard.

Record request ID, received date, request type, requester, affected business, requested scope, statutory deadline, owner, status, searches, decisions, disclosures, corrections, provider actions, and completion. Do not place request details in public GitHub issues.

## Identity and authority

Use proportionate verification:

- authenticated business session for ordinary account records;
- verification to a previously approved business contact for sensitive account changes;
- caller control of the relevant phone/email plus contextual details for a caller request;
- additional evidence only when necessary for the risk.

Do not request full government ID by default. Redact unnecessary information immediately. Verify an agent’s written authority before disclosing another person’s information.

## Workflow

1. Log and acknowledge the request.
2. Calculate the deadline and any permitted extension.
3. Determine whether My AI PA or the customer business leads the response.
4. Preserve records relevant to the request; suspend conflicting deletion.
5. Search Render/Postgres, Vapi, Twilio, OpenAI, Make, Stripe, email, support, logs, exports, and backups as applicable.
6. Review for another person’s privacy, privilege, security risk, and lawful exceptions.
7. Correct inaccurate information and propagate the correction.
8. Execute approved deletion across active systems and create provider completion evidence.
9. Explain any refusal, partial response, extension, or retained legal record and available recourse.
10. Close with date, approver, systems completed/pending, and follow-up actions.

## Backup handling

Information in immutable or isolated backups remains protected and unavailable for ordinary use until expiry. If restored, post-backup deletion, correction, withdrawal, and suppression events must be replayed before the restored system serves traffic.

## Complaint handling

Assign an impartial reviewer, preserve evidence, investigate the relevant privacy principle/control, communicate a written outcome, and identify regulator recourse where required. Track root cause and corrective action separately from the requester’s personal-information file.

## Synthetic exercise

Run `npm run ops:privacy:drill` after material privacy-workflow changes and before a release review. The drill uses no production data and verifies tenant-scoped access, correction, consent withdrawal, active-data deletion, preservation of another tenant, and replay of the deletion ledger after a simulated restore. Keep the generated local report with release evidence; it is not a substitute for provider-side deletion proof or accountable approval.

Official reference: https://www.priv.gc.ca/media/2038/guide_org_e.pdf
