# First Class Rentals Niagara private demo

Status: private My AI PA demonstration with an internal test line
Last verified: 2026-08-07

## Purpose

This demonstration shows how a rental receptionist can collect prospective-renter inquiries and existing-tenant messages, then prepare a structured summary for Dave. It is not an official First Class Rentals service and does not promise availability, repairs, response times, or emergency dispatch.

## Private test line

- Test number: `249-315-4508`
- Ownership: My AI PA/Twilio account
- Official business forwarding: disabled
- Protected owner and caller summaries: enabled for the authorized test recipient
- Live agent configuration: `npm run configure:vapi-first-class-rentals`
- Conversation QA: `npm run test:vapi-first-class-rentals`
- Telephone smoke test: `npm run test:vapi-private-demo-phones`

## Tenant-message triage

The demo classifies tenant messages into three transparent levels:

- Emergency redirect: immediate danger, fire, gas, electrical arcing, flooding near electricity, or a medical emergency. Ordinary intake stops and the caller is told to leave danger and call 911.
- Urgent matter: no heat, a failed furnace or boiler, a major plumbing leak, no water, an electrical outage, essential stove failure, air-conditioning failure, or an insecure lock. The summary is clearly marked for urgent review without promising timing or dispatch.
- Routine review: non-emergency complaints, general maintenance, and ordinary callback requests.

The agent keeps facts already supplied by the caller, asks one question at a time, and does not ask for the tenant's name twice. A caller who says goodbye receives one short closing before the call ends.

## Verified release checks

- 12 of 12 live Vapi conversation cases passed.
- A controlled PSTN call to `249-315-4508` was answered, recognized a no-heat report, marked it urgent, and avoided a dispatch promise.
- Protected owner and caller SMS sends were accepted and confirmed delivered to the authorized test recipient.
- The demo form visually exposes the same urgent-matter classification used by the phone workflow.

## Route

Local and published hash route: `#/demo/first-class-rentals`
