const crypto = require("crypto");

const { redactIncidentText } = require("./incidentAlerts");
const { runProvisioningStep } = require("./provisioningState");

const PLAYBOOK_VERSION = 1;

const NO_REMEDIATION_CODES = new Set([
  "CONTROLLED_TELEGRAM_TEST",
]);

const READINESS_PROBE_CODES = new Set([
  "CONTROLLED_READINESS_REMEDIATION_TEST",
  "DATABASE_UNAVAILABLE",
]);

const TELEGRAM_RETRY_CODES = new Set([
  "TELEGRAM_OUTBOX_DELIVERY_RETRYING",
  "TELEGRAM_OUTBOX_DRAIN_FAILED",
]);

const CODE_REPAIR_CODES = new Set([
  "DATABASE_QUERY_IMPLEMENTATION_FAILED",
]);

const HUMAN_ONLY_CODES = new Set([
  "PROVIDER_ACCOUNT_FUNDING_REQUIRED",
  "CUSTOMER_PAYMENT_FAILED",
  "PAYMENT_FAILED",
  "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_AUTH_FAILED",
  "TWILIO_AUTH_FAILED",
  "TWILIO_AUTHENTICATION_FAILED",
  "PROVIDER_PERMISSION_OR_COMPLIANCE_BLOCK",
  "PROVIDER_CONFIGURATION_INVALID",
  "PROVIDER_INVENTORY_UNAVAILABLE",
  "DUPLICATE_OR_STATE_CONFLICT",
  "SIGNUP_DUPLICATE",
  "SIGNUP_PROVISIONING_FAILED",
  "SIGNUP_PROVISIONING_PENDING",
  "PROVISIONING_NOT_READY",
  "PHONE_NUMBER_PENDING",
  "CANADIAN_PHONE_REQUIRED",
  "PHONE_VALIDATION_UNAVAILABLE",
  "PHONE_NOT_OWNED",
  "VOICE_ROUTING_MISSING",
  "MAKE_SIGNUP_RESPONSE_INCOMPLETE",
  "MAKE_SIGNUP_RESPONSE_EMPTY",
  "MAKE_SIGNUP_REJECTED",
  "SMS_ROUTING_FAILED",
  "TWILIO_SMS_OPTED_OUT",
  "21608",
  "21610",
  "21268",
  "30007",
  "30034",
  "63038",
]);

const TRANSIENT_UNKNOWN_COMPLETION_CODES = new Set([
  "ABORT_ERR",
  "ABORTERROR",
  "ETIMEDOUT",
  "FETCH_TIMEOUT",
  "HTTP_TIMEOUT",
  "MAKE_SIGNUP_TIMEOUT",
  "MAKE_SIGNUP_UNREACHABLE",
  "PROVIDER_CONNECTION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "REQUEST_TIMEOUT",
]);

function safeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function safePlanText(value, maxLength = 420) {
  return redactIncidentText(value, { multiline: true, maxLength });
}

function isProbableCodeDefect(reasonCode) {
  return CODE_REPAIR_CODES.has(reasonCode);
}

function createIncidentRemediationPlan(incident = {}, options = {}) {
  const reasonCode = safeCode(incident.reasonCode || "RUNTIME_FAILURE");
  const safeAutoRepairEnabled = options.safeAutoRepairEnabled === true;
  const codeRepairEnabled = options.codeRepairEnabled === true;
  const codeRepairConfigured = options.codeRepairConfigured === true;
  const base = {
    version: PLAYBOOK_VERSION,
    reasonCode,
    confidence: "medium",
    automatic: false,
    requiresUser: true,
    action: "none",
    status: "needs_user",
    hypothesis: "The available redacted evidence identifies the failing stage, but not enough is proven to make a production change safely.",
    proposedSolution: incident.nextAction || "Inspect the exact incident and provider state before retrying or changing production resources.",
    safetyBoundary: "My AI PA will not repeat a payment, phone-number purchase, text, provider mutation, or destructive action when the previous completion state is unknown.",
  };

  if (NO_REMEDIATION_CODES.has(reasonCode)) {
    return {
      ...base,
      confidence: "high",
      requiresUser: false,
      status: "not_required",
      hypothesis: "This is a controlled operational test, not a production failure.",
      proposedSolution: "No repair is required.",
      safetyBoundary: "No production state will be changed.",
    };
  }

  if (READINESS_PROBE_CODES.has(reasonCode)) {
    const controlledTest = reasonCode === "CONTROLLED_READINESS_REMEDIATION_TEST";
    return {
      ...base,
      confidence: ["DATABASE_UNAVAILABLE", "CONTROLLED_READINESS_REMEDIATION_TEST"].includes(reasonCode) ? "high" : "medium",
      automatic: safeAutoRepairEnabled,
      requiresUser: !safeAutoRepairEnabled,
      action: "readiness_probe",
      status: safeAutoRepairEnabled ? "queued" : "needs_user",
      hypothesis: controlledTest
        ? "This is an explicitly requested incident-remediation canary. No customer operation failed; it exercises the same durable Telegram and read-only readiness path."
        : reasonCode === "DATABASE_UNAVAILABLE"
        ? "The API temporarily lost its production database connection. The failed request is not assumed to have completed."
        : "The service or one of its required dependencies stopped responding. The hosting platform may already have restarted the API.",
      proposedSolution: safeAutoRepairEnabled
        ? "My AI PA will run a read-only API/database readiness check. It will close the incident only if the exact postcondition is healthy; otherwise it will tell you which dashboard to open."
        : "Run the production readiness check and inspect Render before retrying the affected operation.",
      safetyBoundary: controlledTest
        ? "This canary only reads database health and sends its two redacted Telegram lifecycle messages. It does not replay customer work or mutate a provider."
        : "This playbook only reads service and database health. It does not replay the failed customer operation.",
    };
  }

  if (TELEGRAM_RETRY_CODES.has(reasonCode)) {
    return {
      ...base,
      confidence: "high",
      automatic: safeAutoRepairEnabled,
      requiresUser: !safeAutoRepairEnabled,
      action: "telegram_outbox_retry",
      status: safeAutoRepairEnabled ? "queued" : "needs_user",
      hypothesis: "Telegram did not confirm delivery, while the redacted alert remains preserved in My AI PA's durable outbox.",
      proposedSolution: safeAutoRepairEnabled
        ? "My AI PA will keep retrying the saved messages with bounded backoff and will report recovery after the queue is verified empty."
        : "Verify the Telegram bot settings, then drain the saved outbox without deleting it.",
      safetyBoundary: "Only already-redacted incident messages are retried. Customer operations are not replayed.",
    };
  }

  if (isProbableCodeDefect(reasonCode)) {
    const configured = codeRepairEnabled && codeRepairConfigured;
    return {
      ...base,
      confidence: "medium",
      automatic: configured,
      requiresUser: !configured,
      action: "codex_draft_repair",
      status: configured ? "queued" : "needs_user",
      hypothesis: "The failure is most consistent with an application-code or query defect rather than a provider-account action.",
      proposedSolution: configured
        ? "My AI PA will send a sanitized repair brief to an isolated Codex GitHub job. Codex may draft a patch, but independent tests must pass and the result remains a draft pull request—never an automatic production deploy."
        : "Enable the guarded Codex incident-repair workflow, or open this incident for a manual code diagnosis. No production credential should be given to the repair job.",
      safetyBoundary: "The repair agent receives no Render, Twilio, Vapi, Stripe, database, deployment, or Telegram credentials and cannot merge or deploy its own patch.",
    };
  }

  if (TRANSIENT_UNKNOWN_COMPLETION_CODES.has(reasonCode)) {
    return {
      ...base,
      confidence: "medium",
      hypothesis: "A provider or network request failed or timed out, but the provider may still have accepted it before the response was lost.",
      proposedSolution: "Reconcile the provider's current state first. Retry only after proving that no payment, message, number, assistant, or other side effect was created.",
    };
  }

  if (HUMAN_ONLY_CODES.has(reasonCode)) {
    return {
      ...base,
      confidence: "high",
      hypothesis: incident.reason || "The provider returned a known account, payment, compliance, configuration, inventory, or identity-safety block.",
      proposedSolution: incident.nextAction || "Open the named provider dashboard and complete the exact account action before asking My AI PA to verify recovery.",
    };
  }

  return base;
}

function remediationContextHash(incident, plan, generation = 1) {
  return crypto.createHash("sha256").update(JSON.stringify({
    incidentId: String(incident?.incidentId || ""),
    reasonCode: safeCode(incident?.reasonCode),
    action: String(plan?.action || "none"),
    version: Number(plan?.version || PLAYBOOK_VERSION),
    generation: Math.max(1, Number(generation || 1)),
  })).digest("hex");
}

function normalizeRemediationResult(value = {}) {
  const status = ["resolved", "recovered", "repair_dispatched", "needs_user", "failed", "in_progress"].includes(String(value.status || ""))
    ? String(value.status)
    : "failed";
  return {
    status,
    verified: value.verified === true,
    actionTaken: safePlanText(value.actionTaken || "No repair action was recorded.", 480),
    verification: safePlanText(value.verification || "No verification evidence was recorded.", 480),
    nextAction: safePlanText(value.nextAction || "Open the exact incident and review the repair result.", 480),
    referenceUrl: String(value.referenceUrl || "").trim().slice(0, 2_048),
    completedAt: new Date(value.completedAt || Date.now()).toISOString(),
  };
}

async function runIncidentRemediation({
  prisma,
  incident,
  plan,
  generation = 1,
  handlers = {},
  onTransition,
} = {}) {
  if (!plan?.automatic || !plan?.action || plan.action === "none") {
    return normalizeRemediationResult({
      status: "needs_user",
      verified: false,
      actionTaken: "My AI PA stopped before making a production change because this incident is outside the automatic-repair allowlist.",
      verification: "No mutation was attempted.",
      nextAction: plan?.proposedSolution || incident?.nextAction,
    });
  }
  const handler = handlers[plan.action];
  if (typeof handler !== "function") {
    return normalizeRemediationResult({
      status: "needs_user",
      actionTaken: `The ${plan.action} playbook is not configured on this service.`,
      verification: "No production mutation was attempted.",
      nextAction: plan.proposedSolution,
    });
  }

  const idempotencyKey = `${incident.incidentId}:${plan.action}:g${Math.max(1, Number(generation || 1))}`;
  const contextHash = remediationContextHash(incident, plan, generation);
  const executePlaybook = async () => {
    if (typeof onTransition === "function") await onTransition("repairing");
    const actionResult = normalizeRemediationResult(await handler({ incident, plan, generation }));
    if (actionResult.status === "repair_dispatched") return actionResult;
    if (typeof onTransition === "function") await onTransition("verifying");
    const verification = typeof handlers.verify === "function"
      ? await handlers.verify({ incident, plan, generation, actionResult, reconcileOnly: false })
      : actionResult;
    const normalized = normalizeRemediationResult({ ...actionResult, ...verification });
    if (["resolved", "recovered"].includes(normalized.status) && normalized.verified !== true) {
      const error = new Error("The automatic repair did not prove its required postcondition.");
      error.code = "INCIDENT_REPAIR_UNVERIFIED";
      throw error;
    }
    return normalized;
  };

  try {
    // Database recovery is a read-only probe. It must still be able to run
    // while the database-backed idempotency store is the unavailable
    // dependency, and duplicate SELECT 1 probes have no external side effect.
    if (plan.action === "readiness_probe") return executePlaybook();

    const result = await runProvisioningStep({
      prisma,
      kind: `incident-remediation-v${PLAYBOOK_VERSION}`,
      idempotencyKey,
      contextHash,
      reconcile: typeof handlers.verify === "function"
        ? async () => {
            const verification = await handlers.verify({ incident, plan, generation, reconcileOnly: true });
            if (verification?.verified !== true) return null;
            return normalizeRemediationResult({
              status: verification.status || "recovered",
              verified: true,
              actionTaken: verification.actionTaken || "The required healthy state already existed when My AI PA reconciled the incident.",
              verification: verification.verification,
              nextAction: verification.nextAction || "No action is required.",
            });
          }
        : undefined,
      execute: executePlaybook,
    });
    return normalizeRemediationResult(result);
  } catch (error) {
    if (error?.code === "PROVISIONING_ALREADY_IN_PROGRESS") {
      return normalizeRemediationResult({
        status: "in_progress",
        verified: false,
        actionTaken: "Another worker already owns this incident-remediation lease.",
        verification: "The durable claim prevented a duplicate repair attempt.",
        nextAction: "Wait for the worker that owns the current repair lease to finish.",
      });
    }
    throw error;
  }
}

function safeGitHubRepository(value) {
  const repository = String(value || "").trim();
  return /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) ? repository : "";
}

function buildCodexIncidentPayload(incident = {}, generation = 1) {
  const snapshot = incident.snapshot && typeof incident.snapshot === "object" ? incident.snapshot : {};
  const method = safeCode(snapshot.Method);
  const workflow = String(snapshot.Workflow || "").trim().toLowerCase();
  const allowedWorkflows = new Set([
    "ai call processing",
    "admin workflow",
    "application request",
    "billing and trial workflow",
    "customer dashboard",
    "customer signup",
    "text-message handoff",
  ]);
  const sanitizedRoute = String(snapshot.Route || "/unknown-route")
    .split(/[?#]/, 1)[0]
    .replace(/[^a-z0-9_./:-]+/gi, "")
    .slice(0, 160);
  return {
    incident_id: /^[a-f0-9]{24}$/i.test(String(incident.incidentId || "")) ? String(incident.incidentId).toLowerCase() : "",
    generation: Math.max(1, Math.min(999, Number(generation || 1))),
    reason_code: safeCode(incident.reasonCode),
    route: sanitizedRoute.startsWith("/") ? sanitizedRoute : "/unknown-route",
    method: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(method) ? method : "",
    workflow: allowedWorkflows.has(workflow) ? workflow : "application request",
    release: safeCode(snapshot.Release),
  };
}

function incidentRepairDispatchSignature(payload = {}, secret = "") {
  const signingSecret = String(secret || "");
  if (signingSecret.length < 32) return "";
  const canonical = JSON.stringify({
    incident_id: String(payload.incident_id || ""),
    generation: String(payload.generation || ""),
    reason_code: String(payload.reason_code || ""),
    route: String(payload.route || ""),
    method: String(payload.method || ""),
    workflow: String(payload.workflow || ""),
    release: String(payload.release || ""),
  });
  return crypto.createHmac("sha256", signingSecret).update(canonical).digest("hex");
}

function codexIncidentRunTitle(incidentId, generation = 1) {
  const safeIncidentId = /^[a-f0-9]{24}$/i.test(String(incidentId || ""))
    ? String(incidentId).toLowerCase()
    : "";
  if (!safeIncidentId) return "";
  return `Incident ${safeIncidentId} generation ${Math.max(1, Math.min(999, Number(generation || 1)))}`;
}

async function findCodexIncidentRepairRun({
  incident,
  generation = 1,
  token,
  repository,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const safeToken = String(token || "").trim();
  const safeRepository = safeGitHubRepository(repository);
  const displayTitle = codexIncidentRunTitle(incident?.incidentId, generation);
  if (!safeToken || !safeRepository || !displayTitle) return null;
  const response = await fetchImpl(
    `https://api.github.com/repos/${safeRepository}/actions/workflows/codex-incident-repair.yml/runs?event=workflow_dispatch&per_page=30`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${safeToken}`,
        "User-Agent": "my-ai-pa-incident-remediator",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: fetchImpl === fetch && typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
    }
  );
  if (!response.ok) {
    const error = new Error(`GitHub incident-repair reconciliation failed (${response.status}).`);
    error.code = "GITHUB_INCIDENT_REPAIR_RECONCILIATION_FAILED";
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  const run = (Array.isArray(data?.workflow_runs) ? data.workflow_runs : [])
    .find((entry) => entry?.display_title === displayTitle && entry?.event === "workflow_dispatch");
  if (!run) return null;
  const runUrl = String(run.html_url || `https://github.com/${safeRepository}/actions/workflows/codex-incident-repair.yml`);
  const completedAt = new Date(run.updated_at || run.run_started_at || run.created_at || 0).getTime();
  const completionReportGraceMs = 10 * 60 * 1000;
  if (
    String(run.status || "").toLowerCase() === "completed"
    && Number.isFinite(completedAt)
    && Number(now) - completedAt >= completionReportGraceMs
  ) {
    return normalizeRemediationResult({
      status: "needs_user",
      verified: true,
      actionTaken: "My AI PA found the exact completed GitHub repair run and did not start a duplicate job, but its signed completion callback did not update this incident within the safety window.",
      verification: `GitHub reports the guarded workflow concluded ${safeCode(run.conclusion || "unknown").toLowerCase()}. No production fix is being claimed.`,
      nextAction: "Open the exact GitHub Actions run, review the validated draft or failed stage, and restore the incident-result callback before retrying.",
      referenceUrl: runUrl,
    });
  }
  return normalizeRemediationResult({
    status: "repair_dispatched",
    verified: true,
    actionTaken: "My AI PA reconciled the prior guarded code-repair dispatch instead of starting a duplicate job.",
    verification: "GitHub already has the exact incident and occurrence generation in the guarded repair workflow.",
    nextAction: "Wait for the workflow's durable Telegram completion report. No production deployment will happen automatically.",
    referenceUrl: runUrl,
  });
}

async function dispatchCodexIncidentRepair({
  incident,
  generation = 1,
  token,
  repository,
  dispatchSecret,
  fetchImpl = fetch,
} = {}) {
  const safeToken = String(token || "").trim();
  const safeRepository = safeGitHubRepository(repository);
  const safeDispatchSecret = String(dispatchSecret || "");
  if (!safeToken || !safeRepository || safeDispatchSecret.length < 32) {
    return normalizeRemediationResult({
      status: "needs_user",
      actionTaken: "The guarded Codex repair job was not dispatched because its dedicated GitHub credential or repository setting is missing.",
      verification: "No GitHub workflow was started and no production state changed.",
      nextAction: "Add the dedicated GitHub incident-repair token in Render and the OpenAI API key in GitHub Actions, then enable INCIDENT_CODE_REPAIR_ENABLED.",
    });
  }
  const payload = buildCodexIncidentPayload(incident, generation);
  if (!payload.incident_id) throw new TypeError("A valid incident ID is required for a Codex repair dispatch.");
  const authorization = incidentRepairDispatchSignature(payload, safeDispatchSecret);
  const response = await fetchImpl(`https://api.github.com/repos/${safeRepository}/actions/workflows/codex-incident-repair.yml/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${safeToken}`,
      "Content-Type": "application/json",
      "User-Agent": "my-ai-pa-incident-remediator",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? "")])),
        authorization,
      },
    }),
    signal: fetchImpl === fetch && typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
  });
  if (response.status !== 204) {
    const error = new Error(`GitHub did not accept the guarded incident repair dispatch (${response.status}).`);
    error.code = response.status === 401 || response.status === 403
      ? "GITHUB_INCIDENT_REPAIR_AUTH_FAILED"
      : "GITHUB_INCIDENT_REPAIR_DISPATCH_FAILED";
    error.statusCode = 502;
    throw error;
  }
  return normalizeRemediationResult({
    status: "repair_dispatched",
    verified: false,
    actionTaken: "A sanitized repair brief was sent to an isolated Codex GitHub job.",
    verification: "GitHub accepted the workflow dispatch. No patch or fix exists yet; a later workflow report must confirm whether independent tests passed and a draft pull request was created.",
    nextAction: "Wait for the follow-up Telegram report from the GitHub repair workflow. No production deployment will happen automatically.",
    referenceUrl: `https://github.com/${safeRepository}/actions/workflows/codex-incident-repair.yml`,
  });
}

module.exports = {
  CODE_REPAIR_CODES,
  HUMAN_ONLY_CODES,
  PLAYBOOK_VERSION,
  READINESS_PROBE_CODES,
  TELEGRAM_RETRY_CODES,
  TRANSIENT_UNKNOWN_COMPLETION_CODES,
  buildCodexIncidentPayload,
  codexIncidentRunTitle,
  createIncidentRemediationPlan,
  dispatchCodexIncidentRepair,
  findCodexIncidentRepairRun,
  incidentRepairDispatchSignature,
  isProbableCodeDefect,
  normalizeRemediationResult,
  remediationContextHash,
  runIncidentRemediation,
  safeGitHubRepository,
};
