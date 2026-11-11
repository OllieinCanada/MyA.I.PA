# Guarded number fallback recovery

This is an explicit admin preparation, not an automatic retry. Releasing it does
not amend a signup, purchase a number, send a practice text, activate a trial or
use a reserve. Existing normal signup behavior is unchanged.

## Required evidence

- One exact verified `setup_error` signup, with no saved phone, assistant, import
  or billing identifiers, and a valid signed context bound to that attempt.
- A locked strict area-code policy with approved regional overlays.
- Exactly one failed number attempt, at least 30 minutes old, whose original and
  latest code are both `LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE`. This error
  occurs before the purchase POST. Timeouts and unknown outcomes remain blocked.
- No downstream assistant/import stage, even a failed one.
- Successful complete Twilio and Vapi inventories, with no resource marker for
  this exact business. Existing resources need reconciliation, not another buy.
- An intact, unexpired encrypted intake copy.

## Procedure after exact-head release approval

1. Inspect the signup's exact provider failure. Do not infer stockout from a
   generic Make error or from current inventory alone.
2. Run `scripts/prepare-signup-number-fallback.js --attempt=signup_<exact-id>`
   through the existing `run-with-render-env.js --keys=ADMIN_PASSWORD` wrapper.
   It defaults to dry run and returns the current context hash and regional order.
3. With explicit recovery authorization, pass `--apply`, that exact
   `--expected-context-hash`, and
   `--confirm=PREPARE_NUMBER_FALLBACK_RECOVERY`. It atomically locks and rereads
   the context, paid stages and intake, refusing intervening changes. A unique
   immutable recovery journal retains the full original context, receipt and
   encrypted intake. The amendment preserves business facts, account identity,
   signup attempt and deterministic provider names. Old signatures no longer
   match. Repeat amendments cannot rearm it. No purchase occurs in this step.
4. Separately resume the existing signup using the existing guarded recovery
   operation, with authorization for normal purchase/setup/practice-message
   effects. Do not create a new signup. The normal lease allows one dispatch.
   If its result is uncertain, stop and reconcile; never reset/delete evidence.
5. Verify exact number/assistant/import relationships, practice-message delivery
   and final setup state. Queued is not delivered, and setup readiness does not
   prove a successful physical call. Verify all five reserves remain unused.

The purchase function now checks every bounded inventory page immediately before
purchase. Exactly one healthy matching owned number is reused; malformed,
duplicate, hostile or truncated inventory blocks purchases. Held reserves never
match deterministic signup resource names and are never selected. Fallback
improves availability but does not guarantee stock.

## No-provider verification

Focused tests cover authentication/origin/confirmation guards, dry run, preserved
history, identity/signature binding, encrypted replay, concurrent callers, stale
snapshots, rollback, existing resources, reserved numbers, unknown outcomes and
pagination. Quality CI additionally uses disposable loopback PostgreSQL for real
transaction locking and rollback. No test uses production provider writes.
