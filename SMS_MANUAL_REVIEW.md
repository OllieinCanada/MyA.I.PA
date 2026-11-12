# Manual review before notification texts

## Local automatic-confirmation candidate (not released)

The owner has clarified that ordinary confirmation texts must not require admin
approval. `automaticCallNotifications.js` and
`getAutomaticVapiCompositeToolDefinition()` prepare that replacement. The existing
manual tool builder remains unchanged for an explicit, separately verified
migration; deploying backend code alone must not silently rewrite live tools.

The candidate is now a synchronous Function tool named `confirm_call_request`
using the existing authenticated `/api/webhooks/voice` route. It uses the live
`message.artifact` plus explicit `toolCallList`; it never polls `GET /call` or
requires undocumented `tool_calls` inside OpenAI-formatted messages. Vapi's
[official server-message schema](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/ServerMessageToolCalls.ts)
explicitly describes this artifact as live. Either documented native messages
or OpenAI-formatted messages work; when both exist, neither can hide a refusal.

`SMS_AUTOMATIC_DISPATCH_ENABLED=true` and the exact assistant allowlist in
`SMS_AUTOMATIC_ASSISTANT_IDS` remain required and default inactive. The existing
saved active voice-route snapshot must contain reviewed `automaticSms` policy
`{version: 1, ownerEnabled: boolean}`. The backend selects its exact open signup
and business, uses the saved snapshot's pricing policy, and verifies owner and
caller routing. Model arguments cannot choose the sender, owner, tenant or
approval. Inline trial assistants use their saved route without requiring a
provider assistantId that Vapi does not promise for inline assistants.

Fresh explicit approval admits the existing locked draft/one-time send/receipt
workflow without an admin approval. The legacy generic notification branch is
not used: it creates a lead handoff, not this customer confirmation. The Function
response returns HTTP 200 with one result/error matching each toolCallId.

Observed refusals, missing evidence, mismatched arguments, missing intake,
opt-outs and cancelled drafts block admission. Unknown provider outcomes remain
held without resubmission. Missing live history does not trigger manual review
as a hidden fallback, or fall back to a stale persisted artifact.

Before release: run fresh CI including the real-PostgreSQL webhook/concurrency
case and HTTP-level no-send cases. Before live enablement: review exact assistant
Function-tool migration, webhook secret, prompt replacement, saved automaticSms
policy, backend sender account and rollback. Confirm the target assistant's live
artifact configuration in a separately approved provider check. The contract is
documented; this is not a claim that a new live call has been tested. Unknown
caller ID still fails closed; alternate-number confirmation needs separate
evidence-backed support. There is no longer an arbitrary four-tool limit.

This is not a provider guarantee of complete or correctly ordered speech. A
withdrawal absent from the observed snapshot, or received after admission, may be
too late. Approval of this candidate is not permission to claim that limitation
is eliminated. No live settings, calls or real texts are changed by local tests.

The remainder below describes the currently deployed manual-review release,
not a requirement for the replacement automatic workflow.

Classic Vapi calls cannot certify that the latest caller speech has reached the
backend. A spoken approval now saves draft texts; it cannot grant send admission.
For example, a delayed “wait” after a spoken “yes” may still leave a draft, but
phone execution makes **zero messaging-provider submissions**.

## Behavior

- Managed phone tools save owner/caller drafts at the existing authenticated
  integration endpoint with `action: draft`. Their generated code contains no
  provider-create request, provider credentials or claim operation. New isolated
  payloads omit provider credentials. Publication checks reject retained
  credentials and backends that do not report `mode: draft_only`.
- The integration endpoint rejects every legacy `claim`, regardless of flags or
  tool-supplied approval. It may record a token-bound completion for an old,
  already-admitted operation when the legacy flag permits it. Existing in-flight
  submissions cannot be recalled by deploying this change.
- Admin → **Text approvals** displays each exact recipient, sender and full
  message. Reviewing a checkbox and choosing **Approve this text** records the
  displayed revision and content hash. Approval itself sends nothing.
- **Send this approved text** is a separate deliberate action and is available
  only when `SMS_MANUAL_DISPATCH_ENABLED=true`. This new flag defaults OFF and
  has not been changed in any external environment. The old dispatch flag cannot
  enable manual sends or restore phone claims.
- Admin mutations require existing admin authentication, a trusted Origin,
  JSON content and a custom review header. The request cannot override saved
  recipient, sender, body, approval or routing settings. Approval records the
  existing admin actor hash, not a caller-supplied identity.
- Each owner/caller text requires its own explicit review. Changed content or
  recipient invalidates approval. A new sender has a new draft identity and
  cannot inherit another draft's approval. Repeated identical saves preserve
  the same revision and do not extend the 24-hour review deadline.
- Approval, cancellation, revisions and per-text send admission serialize under
  the same PostgreSQL draft lock. Admission also takes the existing duplicate
  claim lock in that same transaction; provider I/O occurs after commit.
- A cancellation committed before admission blocks sending and latches against
  stale saves. After admission, cancellation cannot retract the text. The UI
  explains this cutoff and never claims latest spoken consent.
- The sender checks suppression immediately before its provider POST. A STOP
  or voice withdrawal not yet observed cannot be guaranteed to prevent sending.
  Human review is an independent decision, not proof of caller speech consent.
- Provider requests use backend credentials, a fixed Twilio origin, no redirect
  following, a bounded request timeout, and no automatic retry. Responses without
  a valid provider SID remain unconfirmed. Admission holds never expire.
- Unknown provider outcomes, lost completion, crashed workers and pre-existing
  legacy claims cannot obtain a fresh send grant. Conflicting old admissions
  become visible held drafts. Replayed completed results do not resubmit.
- Draft details expire after 24 hours. The existing sensitive-data cleanup job
  redacts stored message/routing content in bounded batches; it retains opaque
  draft IDs, hashes, cancellation tombstones and duplicate claims. Cleanup is
  best effort, not a promise of physical erasure at the exact expiry instant.
  Held/completed status remains available for reconciliation after expiry.
- Provider acceptance remains separate from handset delivery. This screen
  displays the create result; it does not certify delivery.

No database migration is required: drafts use the existing RuntimeStore table.
Backend manual sending uses the configured backend Twilio account. Per-tool
provider credentials are deliberately not accepted. A tenant using a different
subaccount needs a separately reviewed backend credential/routing integration;
do not reintroduce phone-tool credentials as a shortcut.

## Verification

Existing confirmation, generated-plan, routing, intake, provisioning, receipt and
admission regressions were updated for draft-only phone behavior. The previous
seven ordering counterexamples now require zero provider submissions. Separate
backend-helper tests continue to check duplicate/uncertain-outcome behavior;
they are not evidence that a phone tool can send.

- `npm run test:sms-approvals`: draft/approval/no-send regressions.
- `npm run test:sms-approvals:ui`: exact-content display, explicit approval,
  live-disabled behavior, stale-result handling and no automatic mutation retry.
- The existing SMS PostgreSQL workflow now additionally runs
  `tests/sms-notification-drafts-postgres.test.js` with
  `RUN_SMS_MANUAL_APPROVAL_POSTGRES=1` against its exact disposable loopback DB.
  It covers approval without sends, concurrent admission, revision changes,
  cancellation across clients, an accepted-but-lost fake provider response,
  disabled gates and content redaction without deleting claims.
- The original ten-case process-loss drill remains a low-level claim/sender
  regression with a private synthetic adapter. It no longer treats the blocked
  production phone claim route as an authorized sender.

Locally: 290 backend checks and 4 frontend component checks passed, including
the actual LiquidJS corpus. One real-PostgreSQL test group was skipped because
this executor lacks PostgreSQL/Docker. The admin dashboard bundled successfully;
syntax, whitespace and tracked/untracked secret checks passed. Full release CI
and the new real database cases have not run for this local patch.

Browser visual checks were attempted but not completed: system Chromium failed
to create a required socket (Operation not permitted), and the Playwright browser
download was invalid. Component tests passed, but desktop/mobile visual layout
is not claimed as verified. This is not release or deployment approval.

## Proposed external changes — not applied

1. Publish this reviewed patch on a new branch and open a draft PR to run CI only.
   No merge, deployment, calls, provider mutations or SMS are included.
2. Separately approve any merge/backend/frontend deployment after exact-head
   CI, the real PostgreSQL cases and browser review pass. Keep both dispatch
   flags OFF during rollout; read back deployed code and readiness.
3. Separately review exact affected assistant/tool IDs and versions before
   replacing live tool code/prompts or removing their provider credentials.
   Old publishing routines with retained credentials fail closed and require
   that explicit migration. Deploying backend source alone does not update
   Vapi tools, and publishing frontend assets alone does not deploy the backend.
4. Any live manual-dispatch enablement, paid test or real text requires its own
   explicit approval. Do not enable the flag merely to prove readiness.

No branch was pushed, PR opened, provider contacted, external setting changed,
call placed, or real SMS sent during implementation. Signup verification and
unrelated notification workflows are outside this managed-call change.
