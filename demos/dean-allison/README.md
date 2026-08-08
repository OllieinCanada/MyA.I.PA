# Dean Allison constituency-intake concept

Status: unofficial private demonstration with an internal My AI PA test line
Prepared by: My AI PA
Last public-source review: 2026-08-07

## Purpose

This local demonstration shows how a virtual receptionist could collect a Niagara West constituent's complaint or general federal-service concern and prepare a neutral summary for authorized staff review.

It is not operated, approved, or endorsed by Dean Allison, his constituency office, the House of Commons, or the Government of Canada. It must not be published or represented as an official service without written authorization.

## Verified public sources

- Dean Allison official office-services page: https://www.deanallison.ca/office-services
- Dean Allison official contact page: https://www.deanallison.ca/contact
- House of Commons member listing: https://www.ourcommons.ca/members/en/dean-allison(25446)

The demo uses the public role, office contact information, and advertised federal-service topics only. It does not import campaign material, political opinions, voter data, Google reviews, or information from private accounts.

## Safety and privacy boundaries

- Disclose the unofficial private-demo status at the start of every interaction.
- Never pretend to be Dean Allison, parliamentary staff, a government employee, or a human receptionist.
- Never collect SIN, passport, UCI, immigration-file, tax-account, banking, password, payment, medical-record, or identity-document data.
- Never provide legal, immigration, tax, benefits, passport, or case-outcome advice.
- Never promise intervention, an appointment, response timing, or a government outcome.
- Never collect voting intention, party preference, donation interest, or use complaints for persuasion or fundraising.
- Stop ordinary intake for immediate danger and direct the caller to move to safety and call 911.
- Do not send calls, texts, emails, or webhooks to Dean Allison or his office without written authorization.

## Test-recipient rule

The authorized My AI PA internal test recipient is supplied through a private environment variable owned by the tester. The interface must continue to say that the recipient is a My AI PA test account. The tester's contact information must never be represented as Dean Allison's information.

## Private test line

- Test number: `289-205-7487`
- Ownership: My AI PA/Twilio account
- Recipient: authorized My AI PA tester only
- Recording and transcript: enabled after the opening disclosure asks permission to continue
- Official forwarding: disabled
- Messages to Dean Allison or his office: disabled
- Provisioning command: `npm run provision:vapi-dean-private-demo`
- Conversation QA: `npm run test:vapi-dean-private-demo`

## Route

Local route: `#/demo/dean-allison`

The page is intentionally not linked as an official customer or public case study.
