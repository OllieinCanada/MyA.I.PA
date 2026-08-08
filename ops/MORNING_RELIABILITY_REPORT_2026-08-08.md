# My AI PA overnight reliability report

Prepared: August 8, 2026  
Scope: local changes, read-only provider audits, and controlled test calls only  
Live deployment: not changed

## Plain-English result

The product code is healthy enough for a controlled pilot, but it is not ready for an unrestricted public launch. The complete local release gate passed. First Class Rentals correctly handles almost every simulated tenant situation, and the newest successful 4508 call now says one closing and hangs up by itself. Two spoken classifications still need to be promoted from the local candidate to the live First Class assistant: an unusable essential stove must be called urgent, and an active-fire response must explicitly remind the caller that the demo cannot dispatch help.

The biggest remaining risks are operational: six Vapi telephone lines still lack a verified customer mapping, legal facts and counsel approval are incomplete, bot protection is disabled, backup restoration has not been proven, and a current end-to-end 4508 call has not yet proven both the owner and caller text deliveries together.

## What passed

- The full local release gate passed: 177 backend/provider tests and 39 frontend tests.
- The production React build compiled successfully.
- The tracked-file secret scan passed.
- The production dependency audit found zero known vulnerabilities.
- Legal-draft, operations, Render-blueprint, Prisma-schema, and backend-deployment validators passed.
- Dean's private-demo chat suite passed all 7 identity, consent, privacy, neutrality, safety, and official-delivery checks.
- First Class passed 28 of 30 live chat scenarios:
  - all tested routine routes passed;
  - seven of eight urgent routes used the required spoken urgent wording;
  - six of seven emergency routes included every required safety boundary;
  - the active-fire route still told the caller to leave and call 911, but omitted the explicit no-dispatch disclaimer.
- The strengthened local First Class prompt passed all 5 prompt-policy tests. The shared call-audit analyser passed all 6 behaviour tests.
- SMS protections passed in the full backend suite, including protected owner routing, suppression, fail-closed consent checks, owner/customer failure isolation, stable idempotency keys, duplicate webhook rejection, and cross-business routing detection.
- Read-only routing inspection confirmed 4508 uses the First Class assistant, the protected 4508 sender, Dave's owner destination ending 7422, and customer delivery based on the confirmed caller number.
- Previous controlled delivery evidence still proves one owner text to 7422 and one customer text to the controlled 5488 caller reached Twilio status `delivered`.
- Browser review covered the two private demos, the trade hub, and five trade pages at phone, iPad-landscape, and desktop widths with no document-level horizontal overflow or missing page landmarks. Fresh-build First Class phone and iPad screenshots were also visually inspected after the readability changes.

## What changed locally

- Added one privacy-minimized 60-day playbook audit instead of storing a second copy of sensitive transcripts.
- Added a shared call-quality playbook covering remembered fields, short turns, safety negatives, trusted caller numbers, tool-result truthfulness, and deterministic closing.
- Expanded First Class tests to every listed fire, electrical, gas, carbon-monoxide, violence, medical, flooding, plumbing, heating, access, appliance, cooling, and routine pathway.
- Strengthened the local First Class prompt so deterministic urgent phrases are acknowledged aloud before intake continues.
- Changed controlled PSTN smoke testing so it can call only one owned demo line at a time; this prevents the two test numbers from calling each other simultaneously.
- Corrected Dean's political-neutrality test to accept recording consent before asking the political question and to handle typographic apostrophes.
- Increased small First Class demo text and action targets, set correct page titles, and reset scroll position when either private demo opens.

## What the recent calls showed

### First Class Rentals — 4508

- The newest successful call lasted 60 seconds and ended with `assistant-said-end-call-phrase`; the caller no longer had to disconnect it.
- Average response delay was about 2.96 seconds. About 1.31 seconds came from endpoint detection, so waiting to decide the caller had finished speaking is the main latency target—not network transport.
- Two immediately preceding calls averaged about 2.74 and 3.49 seconds per response and were ended by the caller.
- Older calls showed repeated intake questions, occasional “First Cloud Rentals” name drift, and long 172–243 second conversations. The new local tests directly cover these failures.

### Dean private demo — 7487

- The latest usable call lasted 54 seconds, averaged about 1.41 seconds per response, and was ended by the caller after a garbled/truncated closing.
- The prior usable call averaged about 2.75 seconds and was also ended by the caller.
- The retained audit found notification-tool failure evidence in both assessable Dean calls. The current chat-level policy is now 7 of 7, but no real office delivery was enabled or attempted.

### Controlled telephone smoke attempts

- The new single-target test is safer than the old simultaneous test.
- The most recent controlled attempts for both lines ended at zero seconds with Vapi's `worker-not-available` error. Twilio also showed busy zero-duration legs during the paired attempt. No assistant prompt change can repair provider worker availability.

## What still needs Oliver's input

1. Approve applying the already-tested First Class prompt update to live 4508. It changes only the two weak safety/urgent acknowledgements; it does not alter SMS destinations.
2. After that live change, place one short inbound 4508 call with an essential-stove or no-heat report, approve the text handoff, and confirm that both the caller and Dave receive exactly one text.
3. Decide whether each unmapped line ending 7487, 0318, 2271, 8678, 5417, and 3161 should be mapped to a real customer or decommissioned. The audit will not guess ownership.
4. Supply the legal entity facts, appoint the Privacy Officer, confirm the monitored privacy email, and arrange qualified Canadian counsel review.
5. Provide or create Cloudflare Turnstile keys before publicly promoting signup.
6. Approve backup storage and access so an isolated restore drill can be completed.
7. Configure `RENDER_SERVICE_ID` if automated Render-setting verification is desired from the local credential audit.

## Boundaries preserved

- No production assistant was changed.
- No website was deployed or pushed.
- No real renter, constituent, owner, or customer was texted during this pass.
- No transcript, recording, full caller number, raw provider key, or unhashed call identifier was added to the repository.
- Unrelated personal and job-application files were not edited or staged.
