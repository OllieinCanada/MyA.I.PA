# My AI PA overnight reliability report

Prepared: August 9, 2026  
Scope: local improvements, read-only provider audits, and credential-free or provider chat tests  
Live deployment: not changed

## Plain-English result

The local release remains healthy enough for a controlled pilot. The release gate, production build, secret scan, and production dependency audit all passed. The First Class configuration still points line 4508 to its isolated assistant and protected sender, with Dave's owner destination ending 7422. A recent owner test message is recorded as delivered.

No newer usable 4508 or 7487 telephone call appeared overnight, so there was no new real-call evidence to replace yesterday's findings. The newest usable 4508 call still has the good result: one closing phrase and an automatic assistant-ended call. The current customer number ending 7487 still lacks fresh delivery proof from the 4508 workflow, so one controlled inbound call remains necessary before calling SMS fully proven.

The local First Class candidate is stronger than the live assistant. It now has explicit recovery rules for interruptions, unclear answers, silence, corrections, notification failures, and clean call endings. These changes were tested locally but were not applied to Vapi.

## What passed

- The complete local release gate passed: 177 backend/provider tests and 39 frontend tests.
- The production React build compiled successfully.
- The tracked-file secret scan passed across 384 tracked files.
- The production dependency audit found zero known vulnerabilities.
- Legal-draft, operations, Render-blueprint, Prisma-schema, and backend-deployment validators passed.
- The expanded local First Class prompt-policy suite passed all 15 tests.
- Read-only configuration inspection confirmed line 4508 uses the First Class assistant, sender 4508, owner destination 7422, owner SMS enabled, trusted caller identification, duplicate suppression, the current notification tool code/schema, and a 20-second tool timeout.
- Current and local Twilio credentials returned HTTP 200 during the dry-run configuration check.
- A recent owner test message to 7422 has provider status `delivered`.
- No telephone number qualifies as inactive under the existing 90-day rule, so no number was released or recommended for automatic deletion.
- A fresh production build of the First Class page opened locally with the expected page title.

## What changed locally

- Added interruption recovery that remembers usable details and asks only the next missing question.
- Added one-question clarification for unclear or contradictory answers without guessing consent, phone numbers, addresses, urgency, or safety facts.
- Added bounded silence handling: one gentle retry, then a truthful connection explanation and clean ending without creating an incomplete request.
- Required notification claims to match the actual owner and customer results returned by the delivery tool.
- Strengthened live chat checks for ambiguous consent, silence-like responses, mid-intake corrections, equivalent goodbye requests, and exactly one closing phrase.
- Made visual diagnostics support one-route and one-viewport checks and fail promptly when the browser capture process stalls.

## What the current tests exposed

### First Class live assistant

The last provider chat run originally reported 28 of 34 scenarios passing. A stricter review found that the equivalent goodbye response repeated the approved closing phrase, making the effective baseline 27 of 34. The remaining gaps are:

- silence-like input does not yet use the new bounded recovery language;
- active-fire and carbon-monoxide responses give the correct leave-and-call-911 direction but omit the explicit statement that the demo cannot dispatch help;
- sewage backup, no water, and an unusable essential stove do not consistently say aloud that the matter is urgent;
- an equivalent end request can repeat the closing phrase.

These are covered by the local candidate but were deliberately not applied live overnight.

### Recent call audit

- The privacy-minimized 60-day audit covered 141 calls, totalling about 169 minutes. Only 37 had enough retained evidence for behavioural assessment.
- No newer usable 4508 or 7487 telephone call was available.
- The latest usable 4508 call still lasted about 60 seconds and ended through the assistant's closing path with no retained quality flags.
- The usable 7487 calls still contain notification-tool failure evidence, and one required the caller to disconnect after a weak closing.
- Across assessable calls, the most common retained issue is repeated questions. Missing closings, business-name drift, long monologues, caller disconnects, and tool failures occur less often.

### SMS proof

- Owner routing and a recent delivered message to 7422 are verified.
- The audit found no recent test message to the current caller ending 7487 from the 4508 workflow.
- The verification script correctly refused to substitute an older caller number, which protects against texting the wrong person.

### Telephone inventory

- Vapi lists 11 telephone numbers: 5 effectively mapped and 6 without a verified customer mapping.
- The six unmapped endings are 7487, 0318, 2271, 8678, 5417, and 3161.
- Twilio lists 12 owned numbers at an estimated number-rental total of US$13.80 per month using the fallback published local-number rate.
- None meets the current 90-day inactivity threshold. The oldest review candidate, 3161, has about 76 inactive days, so deletion would still require a business-owner decision.

## Visual-testing note

No visual code changed overnight. The fresh First Class build opened correctly, and frontend tests plus the production build passed. Both the project visual script and the in-app browser became unreliable while capturing screenshots. The diagnostic script now times out cleanly instead of hanging for several minutes, but a complete new phone/iPad/desktop screenshot set was not produced. Yesterday's 24-combination responsive review remains the latest full visual evidence because the UI itself has not changed.

## What still needs Oliver's input

1. Approve applying the tested local First Class conversation-recovery update to the live 4508 assistant.
2. After that change, make one controlled inbound 4508 call from the intended test phone and confirm exactly one owner text, exactly one caller text, persisted call details, one closing, and automatic hang-up.
3. Map, retain intentionally, or decommission the six unmapped lines ending 7487, 0318, 2271, 8678, 5417, and 3161.
4. Supply the legal entity facts, appoint the Privacy Officer, confirm the monitored privacy email, and arrange qualified Canadian counsel review.
5. Provide Cloudflare Turnstile keys before promoting public signup.
6. Approve backup storage and access for an encrypted backup and isolated restore drill.

## Boundaries preserved

- No production assistant or telephone route was changed.
- No real text message or telephone call was initiated.
- No number was bought, released, or reassigned.
- No website was pushed, merged, or deployed.
- No transcript, recording, full caller number, raw provider key, or unhashed call identifier was committed.
- Unrelated personal and job-application files were left untouched.
