# My AI PA Founding-Customer Pilot Playbook

## Promise

My AI PA is a Niagara-based startup opening a small founding-customer pilot for Canadian contractors. The pilot helps a business keep its existing number, privately test an assistant, and protect missed calls after the setup passes its safety checks.

The customer is not promised instant activation. During the pilot, My AI PA reviews each signup within one business hour and never releases an assistant with an incomplete phone, assistant, business, or text-message mapping.

## What the pilot includes

- A 14-day free trial with no credit card required for the trial.
- One My AI PA phone number assigned after the setup checks pass.
- A private test call before real customer calls are forwarded.
- An owner lead-summary text and a caller confirmation text.
- Missed-call forwarding guidance while the customer keeps their existing business number.
- Up to 60 AI call minutes during the trial, subject to the configured trial safety policy.
- Signup and activation support through the support contact shown by the product.
- The ability to stop before going live.

## Five discovery questions

1. What normally happens when a customer calls while you are working?
2. About how many calls do you miss in an average week?
3. Do callers usually leave useful voicemails, or do some disappear?
4. What is an average booked job worth to the business?
5. Would it help if the business phone still rang normally, but My AI PA answered only when nobody could take the call?

## Fit check

Good fit:

- The business receives new-customer calls.
- The owner or team cannot always answer while working.
- Slow callbacks or voicemail cause lost opportunities.
- The business wants to keep its existing number.
- The owner is willing to test the assistant privately before forwarding real calls.

Not a good fit yet:

- The business rarely receives phone calls.
- A reliable receptionist already answers every call.
- The owner does not want an AI system to handle any calls.
- The business cannot provide the consent or operational information needed for the pilot.

## Customer introduction

> I am building My AI PA, a Niagara-based startup helping contractors capture calls they would normally miss. We are inviting a small group of local businesses into a founding-customer pilot so we can prove the service in real businesses and improve the onboarding before the wider launch. You keep your existing number, test everything privately, and no credit card is required for the 14-day trial.

## Activation checklist

1. The customer completes signup on their own device.
2. Confirm the signup appears in **Admin → Needs Attention**.
3. Check that the business name, owner contact, existing number, carrier, line type, services, area, hours, and pricing policy are correct.
4. Select **Approve and continue** only after the signup identity looks legitimate.
5. Confirm one Canadian My AI PA number is assigned.
6. Confirm the assistant and phone records map to the same business.
7. Confirm the automatic owner and caller sample texts are accepted.
8. Have the customer make one private test call.
9. Confirm the captured name, callback number, request, address, timing, and preferred start date are accurate.
10. Configure missed-call forwarding and run the forwarding verification test.
11. Do not forward live calls until the dashboard reports that setup and testing passed.

## If something fails

- Do not ask the customer to submit the form again.
- Use the exact signup in **Needs Attention**.
- Read the plain-language failure reason and last completed checkpoint.
- Use **Attempt safe recovery** for a saved failed attempt.
- Use **Reject without provisioning** only when no paid or phone resources exist and the signup should be closed.
- Confirm the customer-facing status page updates before declaring the problem resolved.

## Repeat the no-cost signup rehearsal

Run `npm run test:pilot:signup:local` before deploying signup changes. It checks the real local status/support API and the React signup screen using synthetic records and mocked database storage. External provider requests are refused in the API tests; no phone numbers, calls, text messages, or subscriptions are purchased.

The rehearsal covers refresh recovery, private status access, duplicate submission safety, verification-to-review progress, closed signups, lost connections, support requests, expired access, and a long wait without polling past its rate limit.

Passing this rehearsal does not prove that production PostgreSQL, SMTP, Twilio, Vapi, Make, Stripe, or carrier forwarding is configured correctly. Those still need their dedicated tests and one controlled end-to-end telephone rehearsal before live customer calls are forwarded.

## Recording and privacy explanation

The assistant asks for recording consent before collecting call details. If the caller declines, the recorded assistant does not continue collecting details. Card information is handled by Stripe Checkout and should never be requested by the assistant or stored by My AI PA.

## Feedback questions

1. What did you expect to happen after pressing the signup button?
2. Was any question difficult to understand or answer?
3. Did you understand why the setup waited for final checks?
4. Did the test call sound like your business?
5. Were both text messages clear and useful?
6. Could you find your assigned number and current service status quickly?
7. Was missed-call forwarding understandable?
8. What would stop you from using this after the trial?
9. What would make the product feel trustworthy enough to recommend?

## Pilot graduation rule

Keep guarded approval for the first five pilot businesses. Move normal, verified signups to automatic approval only after the provisioning and recovery path completes repeatedly without duplicate resources, missing mappings, incorrect recipients, or manual database repair. Suspicious and incomplete signups should always remain eligible for manual review.
