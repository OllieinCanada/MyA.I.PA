// Local-only module audit. No provider credentials, external traffic, or production writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const { runAgentTextTest, getAgentTestDeliveryUpdate } = require("../server/signupAgentTesting");
const { deliverSignupCompletion } = require("../server/signupCompletion");
const { classifyOperationalError } = require("../server/operationalErrorClassifier");
const { dispatchSignupSms } = require("../server/signupSmsDispatch");
function dispatchFixture() {
  const rows = new Map(); let tail = Promise.resolve();
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { data: structuredClone(rows.get(where.key)) } : null; },
    async upsert({ where, update, create }) { const data = rows.has(where.key) ? update.data : create.data; rows.set(where.key, structuredClone(data)); return { data }; },
  };
  return { runtimeStore, $transaction(work) { const job = tail.then(() => work({ runtimeStore, $queryRaw: async () => [] })); tail = job.catch(() => {}); return job; } };
}
const guardedSender = (prisma, sendSms) => request => dispatchSignupSms({ prisma, identity: "synthetic-audit-business", purpose: "agent-test", request, sendSms });
const groups = {
  security: ["signup-captcha", "signup-business-safety", "signup-provisioning", "signup-provisioning-context"],
  verification: ["pending-signup-verifications", "signup-sms-verification", "signup-status-api", "signup-supersession-reconciliation"],
  make: ["make-signup-webhook", "repair-make-signup-provisioning", "intake-recovery-replay", "intake-recovery-safety"],
  providerResources: ["provider-read", "provisioning-state", "signup-provider-recovery", "signup-legacy-resource-safety", "signup-assistant-verification", "signup-recovery-hardening"],
  textingAndReadiness: ["vapi-isolated-sms-provisioning", "signup-agent-testing", "twilio-sms", "sms-suppression", "signup-completion"],
  billing: ["stripe-trial-billing", "trial-usage-policy", "trial-signup-selection", "trial-gate-ownership"],
  forwarding: ["call-forwarding-security", "call-forwarding-lifecycle", "twilio-call-verification", "signup-verification-progress"],
  alerts: ["runtime-alerts", "operational-error-classifier", "production-monitor-safety", "telegram-outbox", "signup-alerts"],
  callbacks: ["twilio-webhook-replay", "twilio-webhook-oauth", "vapi-webhook-auth", "signup-verification-channel"],
};
function agent() { return { businessName: "Synthetic Audit Business", ownerPhone: "+19055550123", twilioPhoneNumber: "+12895550123",
  vapiAssistantId: "synthetic-assistant", smsRoutingStatus: "healthy", agentContentStatus: "verified", agentContentFingerprint: "test-content", agentContentVerifiedAt: new Date().toISOString() }; }
async function observations() {
  const findings = [];
  // Exercise the durable sender wired into both live agent-test entry points.
  let accepted = 0;
  const ownerPrisma = dispatchFixture(), customerPrisma = dispatchFixture(), concurrentPrisma = dispatchFixture();
  const signup = agent();
  const persist = (fields) => Object.assign(signup, fields);
  try { await runAgentTextTest({ signup, persist, sendSms: guardedSender(ownerPrisma, async () => { accepted++; throw Object.assign(Error("lost response after acceptance"), { code: "UND_ERR_SOCKET" }); }) }); } catch (_) {}
  await runAgentTextTest({ signup, persist, sendSms: guardedSender(ownerPrisma, async () => { accepted++; return { sid: "SMsynthetic", status: "queued" }; }) }).catch(error => { assert.equal(error.code, "PROVISIONING_RECONCILIATION_REQUIRED"); });
  findings.push({ module: "owner-test-SMS", case: "provider accepts message then response disappears", status: accepted > 1 ? "weak_point" : "protected", simulatedProviderAcceptances: accepted });
  const customer = agent(); let customerAcceptances = 0;
  const persistCustomer = (fields) => Object.assign(customer, fields);
  await runAgentTextTest({ signup: customer, persist: persistCustomer, sendSms: guardedSender(customerPrisma, async () => ({ sid: "SMownerfixture", status: "queued" })) });
  Object.assign(customer, getAgentTestDeliveryUpdate({ signup: customer, messageSid: "SMownerfixture", status: "delivered" }));
  try { await runAgentTextTest({ signup: customer, persist: persistCustomer, sendSms: guardedSender(customerPrisma, async () => { customerAcceptances++; throw Object.assign(Error("lost accepted customer-copy response"), { code: "UND_ERR_SOCKET" }); }) }); } catch (_) {}
  await runAgentTextTest({ signup: customer, persist: persistCustomer, sendSms: guardedSender(customerPrisma, async () => { customerAcceptances++; return { sid: "SMcustomerfixture", status: "queued" }; }) }).catch(error => { assert.equal(error.code, "PROVISIONING_RECONCILIATION_REQUIRED"); });
  findings.push({ module: "customer-copy-test-SMS", case: "accepted response lost after confirmed owner delivery", status: customerAcceptances > 1 ? "weak_point" : "protected", simulatedProviderAcceptances: customerAcceptances });
  const shared = agent(); let concurrent = 0;
  await Promise.allSettled([1, 2].map(() => runAgentTextTest({ signup: shared, persist: (fields) => Object.assign(shared, fields), sendSms: guardedSender(concurrentPrisma, async () => { concurrent++; await new Promise((r) => setTimeout(r, 5)); return { sid: `SMsynthetic${concurrent}`, status: "queued" }; }) })));
  findings.push({ module: "owner-test-SMS", case: "simultaneous invocations on same saved signup", status: concurrent > 1 ? "weak_point" : "protected", sends: concurrent, scope: "helper-level; enclosing live entry-point locks require separate verification" });
  let finalAcceptances = 0;
  const input = { prisma: dispatchFixture(), dispatchIdentity: "synthetic-business-a", ownerPhone: "+19055550123", assignedPhone: "+12895550123" };
  const first = await deliverSignupCompletion({ ...input, sendSms: async () => { finalAcceptances++; throw Object.assign(Error("lost accepted message response"), { code: "UND_ERR_SOCKET" }); } });
  const second = await deliverSignupCompletion({ ...input, priorStatus: first.status, sendSms: async () => { finalAcceptances++; return { sid: "SMsynthetic", status: "queued" }; } });
  findings.push({ module: "final-setup-message", case: "lost accepted response followed by retry", status: finalAcceptances > 1 ? "weak_point" : "protected", simulatedProviderAcceptances: finalAcceptances });
  const receipt = await deliverSignupCompletion({ ...input, prisma: dispatchFixture(), sendSms: async () => ({ sid: "SMreceipt", status: "queued" }) });
  findings.push({ module: "final-setup-message", case: "retains SID and delivery status", status: receipt.receipts?.sms?.sid ? "protected" : "weak_point", reportedStatus: receipt.status, providerStatus: receipt.receipts?.sms?.status, note: "Acceptance is retained, not delivery proof" });
  const classified = classifyOperationalError(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }), { provider: "vapi" });
  findings.push({ module: "alert-classifier", case: "UND_ERR_SOCKET during response body", status: classified.category === "network" ? "protected" : "weak_point", category: classified.category });
  const source = fs.readFileSync("server/index.js", "utf8");
  for (const name of ["fetchVapiCollection", "requestVapiResource"]) {
    const start = source.indexOf(`async function ${name}(`);
    const end = source.indexOf("\nasync function ", start + 1);
    const body = source.slice(start, end);
    findings.push({ module: name, case: "bounded read/body retry helper is actually wired", status: body.includes("fetchProviderReadText(") ? "protected" : "weak_point", evidence: "source inspection of GET/body retry call site; mutation requests remain single-attempt" });
  }
  return findings;
}
async function worker(file) {
  const child = fork(path.resolve("tests/helpers/signup-recovery-fault-worker.js"), [file], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error("Worker startup timed out")); }, 10000);
    child.once("message", (message) => { clearTimeout(timer); resolve(message.port); });
    child.once("error", reject);
  });
  return { child, exited, url: `http://127.0.0.1:${port}/stage` };
}
async function crashCases(directory) {
  const cases = [];
  for (const kind of ["twilio-number", "vapi-assistant", "vapi-import"]) {
    for (const fault of ["before-provider", "after-provider", "after-commit"]) {
      const file = path.join(directory, `${kind}-${fault}.json`);
      fs.writeFileSync(file, JSON.stringify({ kind, fault, rows: {}, creates: 0, provider: null }));
      const first = await worker(file);
      await fetch(first.url, { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => {});
      assert.equal(await first.exited, 86);
      const state = JSON.parse(fs.readFileSync(file)); state.fault = "none";
      fs.writeFileSync(file, JSON.stringify(state));
      const restarted = await worker(file);
      try {
        const immediately = await (await fetch(restarted.url, { method: "POST" })).json();
        if (fault !== "after-commit") assert.equal(immediately.code, "PROVISIONING_ALREADY_IN_PROGRESS");
        // Advance ONLY the fixture's lease; do not wait five minutes or alter any production clock.
        const expired = JSON.parse(fs.readFileSync(file));
        for (const row of Object.values(expired.rows)) if (row.status === "processing") row.leaseExpiresAt = new Date(0).toISOString();
        fs.writeFileSync(file, JSON.stringify(expired));
        const recovered = await (await fetch(restarted.url, { method: "POST" })).json();
        const end = JSON.parse(fs.readFileSync(file));
        assert.ok(end.creates <= 1);
        if (fault === "before-provider") assert.equal(recovered.code, "PROVISIONING_RECONCILIATION_REQUIRED");
        else assert.equal(recovered.result.id, end.provider.id);
        cases.push({ module: kind, fault, duplicateResources: false, creates: end.creates,
          status: fault === "before-provider" ? "safe_but_stuck" : "recovered", result: recovered.code || "existing_resource_reused" });
      } finally { restarted.child.kill(); await restarted.exited; }
    }
  }
  return cases;
}
async function main() {
  const output = path.resolve("diagnostics/signup-failure-recovery-audit"); fs.mkdirSync(output, { recursive: true });
  const suites = [];
  for (const [module, files] of Object.entries(groups)) {
    const existing = files.map((name) => `tests/${name}.test.js`).filter((file) => fs.existsSync(file));
    const result = spawnSync(process.execPath, ["--test", ...existing], { encoding: "utf8", timeout: 120000 });
    fs.writeFileSync(path.join(output, `${module}.log`), (result.stdout || "") + (result.stderr || ""));
    suites.push({ module, files: existing, pass: result.status === 0 && !result.error,
      missingTestFiles: files.filter((name) => !fs.existsSync(`tests/${name}.test.js`)), testCount: Number(result.stdout?.match(/(?:tests |# tests )(\d+)/)?.[1] || 0) });
    console.log(JSON.stringify({ module, pass: result.status === 0, files: existing.length }));
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-fault-audit-"));
  let crashes;
  try { crashes = await crashCases(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  const report = { generatedAt: new Date().toISOString(), suites, faultObservations: await observations(), processCrashCases: crashes,
    liveSideEffects: 0, productionHealthyProven: false,
    limits: ["Crash tests restart an actual local HTTP process around production provisioning-state code with a file-backed fixture store, not PostgreSQL or the full Render app.",
      "Existing intake replay drill wraps simulated billing and texting in a lock; this does not prove the corresponding live entry points are locked.",
      "Real carrier delivery, voice recordings, Make queue operation, Stripe charges, distributed PostgreSQL locks, and deploy rollback require isolated staging evidence."] };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (suites.some((x) => !x.pass)) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
