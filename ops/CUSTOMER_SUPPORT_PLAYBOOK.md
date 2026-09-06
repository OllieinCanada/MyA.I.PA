# My AI PA Customer Support Playbook

Use this playbook for customer-facing incidents. Confirm the affected business before changing anything. Never guess a business mapping from an assistant name, and never ask for card details by phone, email, SMS, or support chat.

## First response for every issue

1. Record the business name, owner name, verified callback number, assigned My AI PA number, and the time the problem happened.
2. Check `/api/health/ready`, then the admin **Needs Attention** list.
3. Keep the customer informed. Say what is being checked and when the next update will arrive.
4. Verify the fix with a synthetic or owner-authorized test before closing the issue.
5. Escalate immediately if information crossed between businesses, emergency advice was unsafe, or payment data may have been exposed.

## Signup failed

- Check whether the signup exists in admin and whether it is pending verification, review, provisioning, or failed.
- Retry only the failed idempotent step. Do not create a second customer, business, assistant, number, or subscription.
- Confirm the business, assistant, AI number, owner route, and caller route all point to the same business.
- Close only after dashboard access and the testing station pass.

## Verification message missing

- Confirm the destination spelling and delivery status without reading private message content.
- Check suppression, opt-out, provider balance, and delivery errors.
- Resend only the verification message. Signup flows must never send an ordinary lead summary.
- If delivery still fails, use the verified support callback process; do not bypass identity verification.

## AI number not working

- Confirm the number is active, SMS/voice capable as required, attached to the intended assistant, and mapped to the intended business.
- Check the Vapi, Twilio, database, and webhook status for that exact number.
- Make one authorized test call. Confirm greeting, intake, closing, dashboard record, and message results.
- Do not tell the customer to forward real calls until the test passes.

## Owner or caller text missing

- Confirm consent and opt-out status, the exact owner/caller destinations, the sending number, and provider delivery status.
- Check that signup messaging tools cannot invoke customer-service lead messages.
- Retry a failed message only when the route is still correct and the recipient is authorized.
- Escalate any wrong-recipient event as a privacy incident.

## Call forwarding problem

- Select the customer’s carrier and device guide in the dashboard.
- Confirm they are forwarding unanswered calls—not all calls—to the assigned My AI PA number after approximately three rings.
- Place an answered-call test and an unanswered-call test. The answered call must stay with the business; the unanswered call must reach My AI PA.
- Show the customer how to disable forwarding before closing.

## Wrong assistant information

- Pause forwarding if the greeting, services, location, hours, or safety rules could mislead callers.
- Correct the business record first, rebuild the approved prompt, and verify the assistant-to-business mapping.
- Rerun the safe conversation evals, test call, and both message routes.
- Resume only when all delivery checks pass.

## Dashboard login problem

- Confirm the owner is using the verified email/phone for the intended business.
- Check one-time-code delivery, expiry, rate limits, and session status.
- Never send a password or one-time code to a different destination.
- Confirm the owner can see only their own status, latest lead, forwarding guide, trial state, and help button.

## Stripe payment problem

- Direct the customer to **Add card securely** in Stripe Checkout. Never collect or copy card details.
- Confirm the Checkout session belongs to the correct Stripe customer and business.
- Check webhook signature validation and the latest subscription event.
- For a decline, ask the customer to follow Stripe’s message or use another card. Do not override a failed payment manually.
- Resume service only after the signed Stripe event marks the subscription active.

## Cancellation

- Verify the account owner and show the effective cancellation date before confirming.
- Confirm future billing stops, service timing is clear, and forwarding can be disabled.
- Retain or delete information according to the approved retention and privacy-request runbooks.
- Send a confirmation that does not contain payment-card information.

## Service outage

- Confirm the scope using health, provider, database, and deployment checks.
- Post one clear internal incident update: what failed, affected customers, retries, and next action.
- Tell affected customers how calls are handled during the outage and how to disable forwarding if needed.
- Restore safely, verify with synthetic traffic, monitor, then send a concise resolution update.

## Closure standard

An issue is closed only when the customer-facing result is verified, the admin warning is resolved, no duplicate resource was created, the action is logged without secrets or private call content, and the customer receives one clear final update.
