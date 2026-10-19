# Durable verified signup

Contact confirmation now commits three things in one PostgreSQL transaction:
verified contact, the signup attempt's queued state, and a RuntimeStore job
(`signup-setup-job:v1:<server-owned-event-key>`). The confirmation page returns
without waiting for Make. A failed queue write rolls back verification, so the
same link can be retried. Preview GET/HEAD requests never enqueue work.

The normal backend worker starts on application startup and checks every 15
seconds. It claims up to three jobs with per-job advisory locks, a two-minute
lease and a 20-second heartbeat. Multiple processes may run; only the lease
owner can save checkpoints or complete a job. No new database migration or
production environment variable is required. The existing provisioning signing
secret must be at least 24 characters. Checkpoints containing provider results
or forwarding tokens are AES-256-GCM encrypted and bound to the job key.

Before dispatching Make, the worker durably marks the handoff as dispatched.
Fetch **and response-body consumption** share one error boundary. A lost response
saves the original transport code (for example UND_ERR_SOCKET) in the recovery
journal. It never authorizes another Make POST. An expired worker or interrupted
response can only read the saved completed provisioning context, check exact
business ownership and verify the live Vapi phone/assistant binding. A delayed
result is checked with bounded backoff (ten handoff reconciliation attempts,
five attempts for other job failures). Exhaustion preserves the job, marks the
signup as needing attention and notifies operations. It does not purchase,
resend messages, change billing, or relax ownership checks to recover.

An accepted handoff is encrypted as a checkpoint. Later finalization resumes
from that checkpoint, reusing durable SMS and trial idempotency and the same
forwarding URL. Owner/customer delivery reports still run through the existing
durable Twilio inbox; trial activation and the final setup text remain gated by
confirmed sample delivery. No automated customer test call is introduced.

## Isolated verification

- `npm run test:signup-setup-jobs`: queue, socket-body failure and public API tests.
- `npm run test:signup-setup:postgres`: real PostgreSQL, real application HTTP
  routes, two competing processes and full process restarts. Requires
  SIGNUP_RECOVERY_DRILL_DATABASE_URL pointing to a loopback database named
  myaipa_recovery_drill_*. Refuses other targets. Providers are fakes, not live
  Make/Twilio/Vapi/Stripe services. Synthetic provider counts are asserted.
- `npm run test:signup-recovery:postgres`: existing module/SMS/inbox crash drill.
- `npm run test:signup-recovery:postgres:local`: Windows Docker-free fallback.
  Downloads a pinned SHA-512-verified PostgreSQL runtime into a new temporary
  directory, binds only loopback with a random password, applies the schema to
  a new disposable database, runs both drills, then stops/removes that runtime.
  It does not connect to the project's production DATABASE_URL.

CI runs both PostgreSQL drills and retains their JSON evidence. These checks
prove application recovery under simulated provider failures, not third-party
uptime or actual carrier delivery. A separate controlled live acceptance check
is still needed after deployment.
