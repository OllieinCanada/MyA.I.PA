# Morning shipping to-do — August 9, 2026

Completed checks have been removed. The supporting evidence is in `ops/MORNING_RELIABILITY_REPORT_2026-08-09.md`.

## First controlled action

- [ ] Review and approve the tested First Class prompt-only update for line 4508.
- [ ] Apply it to 4508 without changing the protected sender or Dave's owner destination.
- [ ] Make one inbound 4508 proof call and verify: correct assistant, remembered details, urgent/safety wording, exactly one owner text, exactly one caller text, persisted call, exactly one closing, and automatic hang-up.
- [ ] If any proof item fails, revert the live prompt and keep the isolated route unchanged.

## Telephone ownership and routing

- [ ] Decide the customer or purpose for lines ending 7487, 0318, 2271, 8678, 5417, and 3161.
- [ ] Map each retained line to one business and one owner destination, or explicitly authorize decommissioning it.
- [ ] Do not release 3161 solely from inactivity until it crosses the 90-day rule and ownership is checked again.

## Before public signup or a paid pilot

- [ ] Add Cloudflare Turnstile keys and test valid, missing, expired, invalid, and replayed challenges.
- [ ] Complete two authorized disposable signup-to-cancellation sandbox lifecycles.
- [ ] Complete legal entity, Privacy Officer, privacy contact, province, and qualified Canadian counsel review.
- [ ] Confirm provider retention, deletion, processing location, DPA, subprocessor, and incident terms.
- [ ] Approve backup storage, then complete an encrypted backup and isolated restore drill.
- [ ] Schedule monitoring outside the production service and prove a real failure alert.
- [ ] Complete and sign an incident tabletop exercise.

## Maintenance work

- [ ] Repeat the full phone/iPad/desktop screenshot capture after browser automation is stable or after any UI change.
- [ ] Plan the Create React App/Browserslist refresh and Prisma 7 configuration migration without mixing either into the controlled pilot fix.

## Release rule

Keep the overnight commits local until Oliver separately authorizes a push and deployment. Do not describe SMS as fully proven until the same controlled 4508 call produces both the intended owner and caller deliveries exactly once.
