# Morning shipping to-do — August 8, 2026

Completed checks have been removed from this list. Evidence and the full overnight result are in `ops/MORNING_RELIABILITY_REPORT_2026-08-08.md`.

## Before the next controlled pilot

- [ ] Approve the tested First Class prompt-only update for line 4508.
- [ ] Make one inbound 4508 proof call and confirm: correct assistant, correct urgent wording, one owner text, one caller text, persisted call, one closing, automatic hang-up.
- [ ] Re-run the 4508/7487 telephone smoke only after Vapi's worker capacity is available; run one target at a time.
- [ ] Map or decommission the six unknown Vapi lines: 7487, 0318, 2271, 8678, 5417, and 3161.
- [ ] Add Cloudflare Turnstile keys and test valid, missing, expired, invalid, and replayed signup challenges.
- [ ] Complete two authorized disposable signup-to-cancellation sandbox lifecycles.

## Before paid external sales

- [ ] Complete the legal-entity, Privacy Officer, contact, province, and counsel-review work.
- [ ] Verify provider retention, deletion, processing location, DPA, subprocessor, and incident terms.
- [ ] Confirm Render point-in-time recovery and complete an encrypted backup plus isolated restore drill.
- [ ] Schedule monitoring outside the production service and prove a real failure alert.
- [ ] Complete and sign an incident tabletop exercise.
- [ ] Resolve the aging Create React App/Browserslist toolchain warning through a planned migration or controlled dependency update.

## Release rule

Keep changes local until Oliver separately authorizes push and deployment. Do not call the product ready for unrestricted paid launch until the legal, mapping, bot-protection, restore, monitoring, and full-lifecycle items above have evidence.
