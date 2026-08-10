# Sixty-day call playbook audit — 2026-08-08

## Scope and confidence

The audit reconciled 140 unique call records covering 169.09 minutes across nine observed assistant configurations from June 9 through August 8, 2026. The account exposed 31 recent Vapi calls and the My AI PA database supplied 109 additional non-duplicate records. Twilio separately showed 171 telephone events in the same period; those provider events are useful for activity and cost, but they do not all contain conversational evidence.

Vapi rejected direct retrieval before July 25 because of the account's current retention window. Sixty-one call records contained a stored transcript, and 39 contained enough caller and assistant turns for behavioural assessment. Conclusions about those 39 calls are evidence-backed. The remaining records are coverage evidence, not failed conversations.

Using the two known test-caller numbers supplied by Oliver, plus calls explicitly labelled as controlled tests in their transcripts, 119 records were attributable to Oliver/testing without persisting either number. Thirty-seven of the 39 behaviourally assessable conversations were in that test set, so the optimization findings predominantly reflect Oliver's own call testing rather than unrelated callers.

No raw transcript, recording, full caller number, or unhashed call identifier is stored in the generated audit report.

## Decision

Use one shared behavioural playbook plus small approved overlays for trades, rentals, product signup, and unofficial constituent demos. Do not copy one monolithic prompt to every assistant. The shared layer solves the repeated cross-agent problems; the overlay prevents irrelevant questions and unsafe promises.

The release-candidate prompt is in `config/voice-agent-playbook-v1.md`.

## Cross-agent findings

The strongest recurring opportunities in the assessable set were:

- avoid re-asking already confirmed fields;
- close once and hang up deterministically after the caller is finished;
- keep long replies below roughly 35 words and ask one question at a time;
- use trusted caller ID after permission instead of making the caller repeat the number;
- separate owner-text and caller-text results and never announce unverified delivery;
- keep exact business-name pronunciation stable;
- distinguish a reported hazard from an explicit statement that no hazard exists.

Missing evidence is also a product issue: 79 records lacked a retained transcript and 101 did not contain a caller turn the audit could assess. Retention and artifact delivery should be fixed independently from prompt tuning.

## Assistant-by-assistant plan

### My AI PA — line ending 3301

- 103 stored calls; 19 behaviourally assessable.
- Highest priority: a field-state ledger, trusted-caller-number reuse, and deterministic closing.
- Keep product explanation separate from actual signup authorization.
- Do not judge the 76 metadata-only records as conversation failures; repair transcript retention first.

### First Class Rentals Niagara — line ending 4508

- Seven calls, all assessable.
- Preserve the newest proven deterministic end-call behaviour.
- Lock and regression-test the exact spoken name “First Class Rentals Niagara”; older calls included name drift.
- Keep rental inquiry, tenant routine, tenant urgent, complaint, and emergency routes distinct.
- Treat “no smoke, gas smell, or carbon-monoxide alarm” as a negative safety answer, not an emergency.
- When the caller answers a different field, store it and re-ask only the still-missing field.

### Grimsby Electric — lines ending 1055 and 6809

- The two calls on 1055 passed the automated behavioural checks; preserve them as regression examples.
- The two longer 6809 calls need shorter turns and better memory of answered fields.
- Use the shared trade overlay and do not diagnose electrical faults.

### Controlled QA pilot — line ending 5488

- Three assessable calls showed repeat-question behaviour; one also lacked a detected close after goodbye.
- Treat this as a regression-test line, not a template to copy into production.

### Dean Allison unofficial private demo — line ending 7487

- Two assessable calls both exposed notification-tool failure; one also required the caller to end after goodbye.
- Repair delivery and closing only inside the private-demo boundary.
- Preserve political neutrality, sensitive-identifier refusal, and the statement that nothing was sent to the real office.

### Super plumbing services — line ending 7422

- One assessable call is not enough for a quality rate.
- Use the state ledger and the plumbing/HVAC safety split, then gather controlled regression evidence.

### My AI PA Agent — line ending 0318

- The single ten-second call had no detected behavioural flag, but it is too short to prove intake quality.
- Do not broaden deployment based on this sample alone.

### Signup Preview

- Nineteen call attempts existed, but only two contained caller turns; those two had no detected behavioural flag.
- The dominant need is reliable browser/audio and artifact evidence, followed by full signup-flow regression calls.

## Rollout order

1. Preserve current production configurations and snapshot prompts/tools.
2. Fix explicit business mappings for unmapped active numbers before shared changes.
3. Add reusable state-ledger, caller-ID, safety-negation, and closing tests.
4. Pilot the shared core on the controlled QA line.
5. Apply the rental overlay to 4508 and run complaint, no-heat, negative-safety, affirmative-safety, notification-failure, and goodbye tests.
6. Apply the trade overlay to one mapped trade assistant and compare completion, repeat-question, duration, delivery, and hang-up results.
7. Tune 3301 signup/product routing after transcript retention is dependable.
8. Keep the constituent demo isolated; do not roll its workflow into commercial assistants.
9. Promote only when all release gates in the playbook pass.

## How to reproduce

Run:

```text
npm run audit:vapi-call-playbooks -- --days=60 --out=diagnostics/vapi-call-playbook/audit-YYYY-MM-DD.json
```

The audit reads provider and authorized admin records, analyzes transcripts in memory, and writes only sanitized evidence. It does not modify a live assistant.
