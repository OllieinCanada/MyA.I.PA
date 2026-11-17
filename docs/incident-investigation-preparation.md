# Incident investigation: connected candidate, disabled by default

## Current connection

The server-owned public-provider-status job now classifies only its P2028 as
PROVIDER_STATUS_SAVE_TIMEOUT, with a fixed route/fingerprint and no raw logs.
The existing incident store, recurrence history, durable dispatch claim, signed
envelope, signature cooldown and daily budget are reused. Both the existing code
repair setting and INCIDENT_INVESTIGATION_ENABLED=true are needed. The new flag
defaults false. Deployment alone does not activate investigations.

The hosted workflow attempts a start notice, runs read-only source analysis even
if that notice failed, then requires a separate accepted explanation before code
editing. The analysis output is closed enum/booleans, never executable model
instructions or proof of live root cause. It selects only the batching proposal
or human review. Separate jobs keep callback credentials out of the agent.

The authenticated notice handler independently reads the exact GitHub run/base,
incident generation, successful gate and analysis job, first attempt and a
30-minute admission window. A durable run binding and per-stage intent/CAS/receipt
stop duplicate notices across workers and restarts. Lost acknowledgements stay
unknown and never automatically resend. An initial notice failure does not block
read-only investigation, but before-edit acceptance remains mandatory.

The patch job is limited to server/providerMaintenance.js and its exact regression
test. Independent trusted validators enforce this scope. Existing clean test,
seal, draft-publication and completion-reporting stages remain. No automatic
merge, deployment, customer replay, incident closure or external-monitor change
is added. Initial/analysis/explanation/draft execution budgets are 2/8/2/15 minutes;
queue delays may exhaust the admission window. Independent full CI can take
longer. Other existing repair playbooks retain their earlier behavior.

Local tests use the actual authenticated loopback notice handler with mocked
GitHub/Telegram. Real PostgreSQL concurrency/restart/cleanup proof is configured
in a separate disposable-service CI job, not claimed from local mocks or skips.
No local PostgreSQL binary is available. No real hosted agent or message ran.

Before release: publish a draft for full CI, exact runtime-source verification and
review. Before activation: separately approve the flag, paid-agent budget and any
real notification exercise; verify dedicated GitHub/callback configuration and
Linux sandbox compatibility. Credentials/private runtime evidence must never be
published. Total outages and unsupported incidents remain outside this playbook.

## Publication scope

The earlier injected coordinator/reference tests are not part of this release.
This implementation reuses the existing runner rather than publishing a second,
unused orchestration framework. Initial validation is synthetic only; full CI
and review must qualify these exact candidate bytes before release.
