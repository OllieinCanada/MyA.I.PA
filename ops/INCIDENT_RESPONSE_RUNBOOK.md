# Security, Privacy, and Reliability Incident Runbook

This operational runbook supplements the private legal breach plan. Do not place incident personal information in the public GitHub repository.

## Contacts to complete before launch

- Incident commander: appointment pending
- Privacy Officer and 24-hour contact: appointment pending
- Technical lead: appointment pending
- Legal counsel: not retained/recorded
- Cyber insurer/broker: not confirmed
- Customer communications owner: appointment pending
- Secure incident record location: not selected

## Severity

- **SEV-1:** active cross-customer disclosure, exposed credential with production access, wrong-recipient sensitive message, material database loss, widespread outage, or likely significant harm.
- **SEV-2:** contained security/privacy event, owner notification failure, partial provider outage, or recoverable data-integrity issue with customer impact.
- **SEV-3:** limited defect or near miss without confirmed disclosure, loss, or material customer impact.

## First 15 minutes

1. Stop ongoing harm without destroying evidence.
2. Open a private incident record and assign an incident commander.
3. Record discovery time, affected service, reporter, and initial scope.
4. Revoke or restrict exposed credentials/routes/accounts where necessary.
5. Pause messaging, provisioning, or automation if it could duplicate or misroute data.
6. Preserve deployment IDs, correlation IDs, provider IDs, configuration, and relevant logs.
7. Escalate SEV-1 immediately to the Privacy Officer, technical lead, and counsel/insurer when available.

## First hour

1. Build a timeline and identify affected customers, jurisdictions, systems, data categories, sensitivity, volume, and exposure duration.
2. Confirm containment independently.
3. Assess integrity and availability as well as confidentiality.
4. Determine whether a privacy breach occurred and begin the real-risk-of-significant-harm assessment.
5. Notify affected customer businesses as contractually and legally appropriate without delaying a required report.
6. Establish update intervals: 30 minutes for SEV-1, two hours for SEV-2.
7. Select a recovery point and validate backups before restoration.

## PIPEDA decision record

For every breach of safeguards, retain enough facts to show:

- what happened and when;
- information and people affected;
- safeguards in place;
- sensitivity and probability of misuse;
- real-risk-of-significant-harm conclusion and approvers;
- containment and mitigation;
- whether the OPC, individuals, or other organizations were notified;
- dates, methods, and notice content; and
- remediation and verification.

Where the real-risk threshold is met, the private breach plan calls for OPC reporting and affected-person notification as soon as feasible. Keep every PIPEDA breach record for at least 24 months after the breach was determined.

## Recovery and closure

1. Restore to an isolated target and validate before cutover.
2. Replay deletion, correction, suppression, and closure events.
3. Reconcile queued calls, texts, webhooks, subscriptions, and provisioning.
4. Verify tenant isolation and intended recipients.
5. Communicate recovery and known residual risk.
6. Complete a blameless review within 10 business days.
7. Assign every corrective action an owner and deadline.
8. Close only after evidence-based retest and management/privacy approval.

## Tabletop exercises

Run before a paid pilot and annually thereafter:

- exposed Vapi/Twilio/Render/OpenAI/Make/Stripe credential;
- transcript or recording visible to the wrong business;
- owner summary sent to the wrong number;
- database deletion or corruption requiring PITR;
- provider outage with queued messages;
- compromised admin session;
- backup exposure; and
- caller refusing recording consent.

Official references:

- OPC breach guidance: https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/
- Breach record regulation: https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-64/section-6.html
