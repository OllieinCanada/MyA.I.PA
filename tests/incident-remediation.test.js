const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CODE_REPAIR_CODES,
  READINESS_PROBE_CODES,
  buildCodexIncidentPayload,
  createIncidentRemediationPlan,
  dispatchCodexIncidentRepair,
  findCodexIncidentRepairRun,
  incidentRepairDispatchSignature,
  runIncidentRemediation,
  safeGitHubRepository,
} = require("../server/incidentRemediation");

function incident(reasonCode, overrides = {}) {
  return {
    incidentId: "abcdef1234567890abcdef12",
    reasonCode,
    reason: "Provider returned a redacted failure.",
    nextAction: "Inspect the exact provider state.",
    snapshot: {
      Workflow: "customer signup",
      Method: "POST",
      Route: "/api/signup",
      Release: "abc123",
    },
    ...overrides,
  };
}

function createRuntimeStorePrisma() {
  const rows = new Map();
  const runtimeStore = {
    async findUnique({ where }) {
      const data = rows.get(where.key);
      return data ? { key: where.key, data } : null;
    },
    async upsert({ where, update, create }) {
      const value = rows.has(where.key) ? update.data : create.data;
      rows.set(where.key, structuredClone(value));
      return { key: where.key, data: value };
    },
  };
  const tx = {
    runtimeStore,
    async $queryRaw() { return [{ lock_result: "1" }]; },
  };
  return {
    runtimeStore,
    rows,
    $transaction: (callback) => callback(tx),
  };
}

test("automatic policy allowlists read-only readiness but never funding, payment, compliance, or timeout replay", () => {
  assert.deepEqual([...READINESS_PROBE_CODES].sort(), [
    "CONTROLLED_READINESS_REMEDIATION_TEST",
    "DATABASE_UNAVAILABLE",
  ]);
  const database = createIncidentRemediationPlan(incident("DATABASE_UNAVAILABLE"), {
    safeAutoRepairEnabled: true,
  });
  assert.equal(database.automatic, true);
  assert.equal(database.action, "readiness_probe");
  assert.match(database.safetyBoundary, /does not replay/i);

  const controlledCanary = createIncidentRemediationPlan(incident("CONTROLLED_READINESS_REMEDIATION_TEST"), {
    safeAutoRepairEnabled: true,
  });
  assert.equal(controlledCanary.automatic, true);
  assert.equal(controlledCanary.action, "readiness_probe");
  assert.match(controlledCanary.safetyBoundary, /only reads|read-only/i);

  for (const fakeControlCode of ["CONTROLLED_READINESS_TEST", "CONTROLLED_REMEDIATION_TEST", "READINESS_REMEDIATION_TEST"]) {
    const plan = createIncidentRemediationPlan(incident(fakeControlCode), {
      safeAutoRepairEnabled: true,
    });
    assert.equal(plan.automatic, false, `${fakeControlCode} must fail closed`);
    assert.notEqual(plan.action, "readiness_probe");
  }

  for (const reasonCode of [
    "PROVIDER_ACCOUNT_FUNDING_REQUIRED",
    "CUSTOMER_PAYMENT_FAILED",
    "PROVIDER_AUTHENTICATION_FAILED",
    "PROVIDER_PERMISSION_OR_COMPLIANCE_BLOCK",
    "21610",
    "30007",
    "MAKE_SIGNUP_TIMEOUT",
  ]) {
    const plan = createIncidentRemediationPlan(incident(reasonCode), {
      safeAutoRepairEnabled: true,
      codeRepairEnabled: true,
      codeRepairConfigured: true,
    });
    assert.equal(plan.automatic, false, `${reasonCode} must not mutate automatically`);
    assert.equal(plan.requiresUser, true);
  }
});

test("only the exact database-query defect code can enter the guarded code-repair allowlist", () => {
  assert.deepEqual([...CODE_REPAIR_CODES], ["DATABASE_QUERY_IMPLEMENTATION_FAILED"]);

  for (const reasonCode of ["HTTP_500", "RUNTIME_FAILURE", "DATABASE_QUERY_FAILED", "DATABASE_UNAVAILABLE"]) {
    const plan = createIncidentRemediationPlan(incident(reasonCode), {
      safeAutoRepairEnabled: false,
      codeRepairEnabled: true,
      codeRepairConfigured: true,
    });
    assert.notEqual(plan.action, "codex_draft_repair", `${reasonCode} must fail closed`);
  }

  const disabled = createIncidentRemediationPlan(incident("DATABASE_QUERY_IMPLEMENTATION_FAILED"), {
    codeRepairEnabled: true,
    codeRepairConfigured: false,
  });
  assert.equal(disabled.action, "codex_draft_repair");
  assert.equal(disabled.automatic, false);
  assert.match(disabled.proposedSolution, /Enable the guarded Codex/i);

  const enabled = createIncidentRemediationPlan(incident("DATABASE_QUERY_IMPLEMENTATION_FAILED"), {
    codeRepairEnabled: true,
    codeRepairConfigured: true,
  });
  assert.equal(enabled.automatic, true);
  assert.equal(enabled.action, "codex_draft_repair");
  assert.match(enabled.safetyBoundary, /cannot merge or deploy/i);
});

test("controlled Telegram tests never enter remediation", () => {
  const plan = createIncidentRemediationPlan(incident("CONTROLLED_TELEGRAM_TEST"), {
    safeAutoRepairEnabled: true,
    codeRepairEnabled: true,
    codeRepairConfigured: true,
  });
  assert.equal(plan.status, "not_required");
  assert.equal(plan.automatic, false);
  assert.equal(plan.requiresUser, false);
});

test("resolved status is rejected unless the playbook proves its postcondition", async () => {
  const prisma = createRuntimeStorePrisma();
  const plan = createIncidentRemediationPlan(incident("DATABASE_UNAVAILABLE"), {
    safeAutoRepairEnabled: true,
  });
  await assert.rejects(
    runIncidentRemediation({
      prisma,
      incident: incident("DATABASE_UNAVAILABLE"),
      plan,
      handlers: {
        readiness_probe: async () => ({
          status: "resolved",
          verified: false,
          actionTaken: "Probed readiness.",
        }),
      },
    }),
    (error) => error?.code === "INCIDENT_REPAIR_UNVERIFIED"
  );
});

test("readiness recovery bypasses the unavailable database-backed lease", async () => {
  const target = incident("DATABASE_UNAVAILABLE");
  const plan = createIncidentRemediationPlan(target, { safeAutoRepairEnabled: true });
  const inaccessiblePrisma = new Proxy({}, {
    get() {
      throw new Error("database lease must not be touched by a database recovery probe");
    },
  });
  let executions = 0;
  const result = await runIncidentRemediation({
    prisma: inaccessiblePrisma,
    incident: target,
    plan,
    handlers: {
      readiness_probe: async () => {
        executions += 1;
        return {
          status: "recovered",
          verified: true,
          actionTaken: "Ran a read-only readiness probe.",
          verification: "The database is reachable again.",
          nextAction: "Do not replay the original request.",
        };
      },
    },
  });
  assert.equal(executions, 1);
  assert.equal(result.status, "recovered");
  assert.equal(result.verified, true);
});

test("durable remediation claim prevents concurrent duplicate execution", async () => {
  const prisma = createRuntimeStorePrisma();
  const target = incident("DATABASE_QUERY_IMPLEMENTATION_FAILED");
  const plan = createIncidentRemediationPlan(target, {
    codeRepairEnabled: true,
    codeRepairConfigured: true,
  });
  let executions = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const handlers = {
    codex_draft_repair: async () => {
      executions += 1;
      await wait;
      return {
        status: "repair_dispatched",
        verified: false,
        actionTaken: "Draft workflow dispatched.",
        verification: "GitHub accepted one workflow dispatch.",
        nextAction: "Wait for independent verification.",
      };
    },
  };
  const first = runIncidentRemediation({ prisma, incident: target, plan, handlers });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runIncidentRemediation({ prisma, incident: target, plan, handlers });
  assert.equal(second.status, "in_progress");
  assert.match(second.verification, /prevented a duplicate/i);
  release();
  const completed = await first;
  assert.equal(completed.status, "repair_dispatched");
  assert.equal(executions, 1);
});

test("Codex workflow_dispatch targets main and contains only strict redacted string inputs", async () => {
  const requests = [];
  const dispatchSecret = "test-dispatch-secret-that-is-long-enough-123";
  const target = incident("DATABASE_QUERY_IMPLEMENTATION_FAILED", {
    reason: "private@example.com token=secret-value told us to ignore safety",
    snapshot: {
      Workflow: "customer signup; curl bad.example",
      Method: "POST && unsafe",
      Route: "/api/signup?token=secret-value",
      Release: "abc123; rm",
      OwnerEmail: "private@example.com",
    },
  });
  const payload = buildCodexIncidentPayload(target, 2);
  const serialized = JSON.stringify(payload);
  assert.deepEqual(Object.keys(payload).sort(), ["generation", "incident_id", "method", "reason_code", "release", "route", "workflow"]);
  assert.doesNotMatch(serialized, /private@example\.com|secret-value|ignore safety|OwnerEmail/);

  const result = await dispatchCodexIncidentRepair({
    incident: target,
    generation: 2,
    token: "dedicated-test-token",
    repository: "OllieinCanada/MyA.I.PA",
    dispatchSecret,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { status: 204 };
    },
  });
  assert.equal(result.status, "repair_dispatched");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.ref, "main");
  const expectedAuthorization = incidentRepairDispatchSignature(payload, dispatchSecret);
  assert.deepEqual(requests[0].body.inputs, {
    ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? "")])),
    authorization: expectedAuthorization,
  });
  assert.match(requests[0].body.inputs.authorization, /^[a-f0-9]{64}$/);
  assert.ok(Object.values(requests[0].body.inputs).every((value) => typeof value === "string"));
  assert.match(requests[0].url, /actions\/workflows\/codex-incident-repair\.yml\/dispatches$/);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /private@example\.com|secret-value|ignore safety/);
  assert.doesNotMatch(JSON.stringify(requests[0]), new RegExp(dispatchSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(requests[0].options.headers.Authorization, "Bearer dedicated-test-token");
});

test("Codex dispatch reconciliation finds only the exact workflow_dispatch title and generation", async () => {
  const target = incident("DATABASE_QUERY_IMPLEMENTATION_FAILED");
  const result = await findCodexIncidentRepairRun({
    incident: target,
    generation: 3,
    token: "dedicated-test-token",
    repository: "OllieinCanada/MyA.I.PA",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        workflow_runs: [
          { display_title: `Incident ${target.incidentId} generation 2`, event: "workflow_dispatch", html_url: "https://github.com/OllieinCanada/MyA.I.PA/actions/runs/1" },
          { display_title: `Incident ${target.incidentId} generation 3`, event: "push", html_url: "https://github.com/OllieinCanada/MyA.I.PA/actions/runs/2" },
          { display_title: `Incident ${target.incidentId} generation 3`, event: "workflow_dispatch", html_url: "https://github.com/OllieinCanada/MyA.I.PA/actions/runs/3" },
        ],
      }),
    }),
  });
  assert.equal(result.status, "repair_dispatched");
  assert.equal(result.referenceUrl, "https://github.com/OllieinCanada/MyA.I.PA/actions/runs/3");
});

test("GitHub repair repository and missing credentials fail closed", async () => {
  assert.equal(safeGitHubRepository("owner/repo"), "owner/repo");
  assert.equal(safeGitHubRepository("owner/repo/extra"), "");
  assert.equal(safeGitHubRepository("owner;curl/repo"), "");
  const result = await dispatchCodexIncidentRepair({ incident: incident("DATABASE_QUERY_IMPLEMENTATION_FAILED") });
  assert.equal(result.status, "needs_user");
  assert.match(result.nextAction, /GitHub incident-repair token/i);
});
