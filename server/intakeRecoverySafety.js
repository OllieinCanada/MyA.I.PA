const crypto = require("node:crypto");
const { canonical, recoveryIdentity, readRecoveryCopy, recordRecoveryOperation } = require("./intakeRecoveryJournal");
const { assertSignupOpen } = require("./signupBusinessIdentity");
const { claimProvisioningStep, completeProvisioningStep, failProvisioningStep } = require("./provisioningState");
const fail = (code) => Object.assign(new Error(code), { code, statusCode: 409 });
const sameIdentity = (a, b) => ["eventKey", "businessKey", "payloadHash"].every((key) => a?.[key] === b?.[key]);

// Adapter may be backed by Make API or MCP. It must read authoritative state,
// not a previously captured screenshot or caller-supplied processing status.
async function deleteStagingDuplicate({ prisma, secret, adapter, target, candidateId, survivorId, expectedIdentity, confirmation }) {
  if (target?.environment !== "staging" || !target.hookId || !target.scenarioId || target.hookId === target.productionHookId || target.scenarioId === target.productionScenarioId || !target.productionHookId || !target.productionScenarioId) throw fail("QUEUE_ISOLATED_STAGING_REQUIRED");
  if (confirmation !== `DELETE_STAGING_DUPLICATE:${candidateId}` || !candidateId || !survivorId || candidateId === survivorId) throw fail("QUEUE_EXACT_ITEM_CONFIRMATION_REQUIRED");
  const saved = await readRecoveryCopy({ prisma, secret, eventKey: expectedIdentity?.eventKey });
  if (!sameIdentity(saved.identity, expectedIdentity)) throw fail("QUEUE_SAVED_IDENTITY_MISMATCH");
  // One event gets one deletion decision. Never let two operators choose
  // opposite survivors, even after a timeout or expired lease.
  const decisionHash = crypto.createHash("sha256").update(JSON.stringify([target.hookId, target.scenarioId, candidateId, survivorId])).digest("hex");
  const claim = await claimProvisioningStep({ prisma, kind: "intake-queue-delete", idempotencyKey: saved.identity.eventKey, contextHash: decisionHash });
  if (!claim.claimed || claim.data.attempts !== 1) throw fail("QUEUE_RECOVERY_ALREADY_ATTEMPTED");
  try {
    const result = await performDeletion();
    await completeProvisioningStep({ prisma, key: claim.key, claimToken: claim.claimToken, result });
    return result;
  } catch (error) {
    await failProvisioningStep({ prisma, key: claim.key, claimToken: claim.claimToken, error }).catch(() => {});
    throw error;
  }
  async function performDeletion() {
  async function inspect() {
    const state = await adapter.state(target);
    if (String(state?.hookId) !== String(target.hookId) || String(state?.scenarioId) !== String(target.scenarioId) || state.active !== false || state.runningExecutions !== 0) throw fail("QUEUE_PROCESSING_NOT_PAUSED");
    const [candidate, survivor] = await Promise.all([adapter.item(target, candidateId), adapter.item(target, survivorId)]);
    for (const [item, id] of [[candidate, candidateId], [survivor, survivorId]]) {
      if (!item || String(item.id) !== String(id) || item.processing !== false) throw fail("QUEUE_ITEM_NOT_WAITING");
      if (!sameIdentity(recoveryIdentity(item.payload), saved.identity)) throw fail("QUEUE_PAYLOAD_NOT_EXACT_DUPLICATE");
    }
    const attempt = await prisma.signupAttempt.findUnique({ where: { eventKey: saved.identity.eventKey } });
    assertSignupOpen(attempt || {});
    const registry = await prisma.runtimeStore.findUnique({ where: { key: `signup-business:${saved.identity.businessKey}` } });
    if (registry?.data?.closed) throw fail("SIGNUP_CLOSED");
  }
  await inspect();
  const operationId = crypto.randomUUID();
  // Includes an immutable fingerprint of the exact candidate/survivor/target.
  const auditIdentity = { ...saved.identity, queueDecisionHash: crypto.createHash("sha256").update(JSON.stringify([target.hookId, target.scenarioId, candidateId, survivorId])).digest("hex") };
  await recordRecoveryOperation({ prisma, identity: auditIdentity, operationId, kind: "queue-delete", status: "started" });
  try {
    // Re-read immediately before deleting. Never bulk-delete, never retry an
    // ambiguous delete automatically. Keep the recovery copy either way.
    await inspect();
    const result = await adapter.deleteOne(target, candidateId);
    if (result?.deleted !== candidateId || result?.error) throw fail("QUEUE_DELETE_NOT_CONFIRMED");
    const [removed, survivor, state] = await Promise.all([adapter.item(target, candidateId), adapter.item(target, survivorId), adapter.state(target)]);
    if (removed !== null || !survivor || survivor.processing !== false || !sameIdentity(recoveryIdentity(survivor.payload), saved.identity) || state.active !== false || state.runningExecutions !== 0) throw fail("QUEUE_DELETE_READBACK_UNCERTAIN");
    await recordRecoveryOperation({ prisma, identity: auditIdentity, operationId, kind: "queue-delete", status: "verified" });
    return { verified: true, deletedItems: 1, recoveryCopyRetained: true, operationId };
  } catch (error) {
    await recordRecoveryOperation({ prisma, identity: auditIdentity, operationId, kind: "queue-delete", status: "uncertain" }).catch(() => {});
    throw error;
  }
  }
}

// Only explicitly declared JSON pointers may differ. Do not scrub whole mapper,
// authentication, or setting objects: that would hide operational drift.
function compareRecoveryEnvironments({ staging, production, differences = [] }) {
  const permitted = new Map();
  for (const item of differences) {
    if (!item?.path?.startsWith("/") || !item.reason || item.staging === undefined || item.production === undefined || permitted.has(item.path)
      || /\/(releaseCommit|module|version|sequential|confidential|dataloss|onerror|errorHandlers)(\/|$)/i.test(item.path)
      || (item.staging !== null && typeof item.staging === "object") || (item.production !== null && typeof item.production === "object")) throw fail("PARITY_EXCEPTION_INVALID");
    permitted.set(item.path, item);
  }
  const used = new Set();
  const drift = [];
  function visit(a, b, pointer = "") {
    if (permitted.has(pointer)) {
      const rule = permitted.get(pointer);
      if (JSON.stringify(a) !== JSON.stringify(rule.staging) || JSON.stringify(b) !== JSON.stringify(rule.production)) drift.push(pointer);
      used.add(pointer);
      return;
    }
    if (JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))) return;
    if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    } else drift.push(pointer || "/");
  }
  // Release identifiers and behavior must be supplied, not inferred as equal
  // from missing snapshots. Never print secrets or differing values.
  if (!staging?.releaseCommit || !production?.releaseCommit || !staging?.blueprint?.flow || !production?.blueprint?.flow || !staging?.settings || !production?.settings) throw fail("PARITY_SNAPSHOTS_INCOMPLETE");
  visit(staging, production);
  for (const pointer of permitted.keys()) if (!used.has(pointer)) drift.push(pointer);
  return { pass: drift.length === 0, driftPaths: [...new Set(drift)], allowedDifferences: permitted.size, secretValuesExposed: false };
}

function assessIntakeResources({ expected, evidence, now = Date.now(), maxAgeMs = 5 * 60 * 1000 }) {
  const issues = [];
  if (!expected?.businessKey || !expected.eventKey || !Array.isArray(expected.textPurposes) || new Set(expected.textPurposes).size !== expected.textPurposes.length || !Number.isInteger(expected.billingCount) || expected.billingCount < 0 || !Number.isInteger(expected.chargeCount) || expected.chargeCount < 0) throw fail("RESOURCE_EXPECTATIONS_REQUIRED");
  const kinds = ["crm", "twilioNumber", "vapiAssistant", "vapiPhone", "billing", "charges", "texts"];
  const records = {};
  for (const kind of kinds) {
    const collection = evidence?.[kind];
    if (collection?.complete !== true || collection.businessKey !== expected.businessKey || !Array.isArray(collection.records) || !Number.isFinite(Date.parse(collection.checkedAt)) || now - Date.parse(collection.checkedAt) > maxAgeMs || Date.parse(collection.checkedAt) > now + 5000) {
      issues.push(`${kind}:evidence_missing_or_stale`); records[kind] = []; continue;
    }
    records[kind] = collection.records;
    if (collection.records.some((item) => !item.id || item.businessKey !== expected.businessKey) || new Set(collection.records.map((item) => item.id)).size !== collection.records.length) issues.push(`${kind}:ownership_or_identifiers_invalid`);
    const wanted = kind === "billing" ? expected.billingCount : kind === "charges" ? expected.chargeCount : kind === "texts" ? expected.textPurposes.length : 1;
    if (collection.records.length !== wanted) issues.push(`${kind}:unexpected_count`);
  }
  const phone = records.vapiPhone[0];
  if (!phone || phone.assistantId !== records.vapiAssistant[0]?.id || !phone.number || phone.number !== records.twilioNumber[0]?.number || phone.businessId !== records.crm[0]?.id || !records.twilioNumber[0]?.routesToVapi) issues.push("phone:binding_mismatch");
  for (const purpose of expected.textPurposes) {
    const matches = records.texts.filter((item) => item.purpose === purpose && item.eventKey === expected.eventKey);
    if (matches.length !== 1 || matches[0]?.status !== "delivered") issues.push(`texts:${purpose}:not_delivered_once`);
  }
  return { pass: issues.length === 0, issues, counts: Object.fromEntries(kinds.map((kind) => [kind, records[kind].length])), scope: "Fresh complete provider inventories and CRM evidence; not cached setup receipts." };
}
async function collectIntakeResources({ expected, collectors, now = Date.now() }) {
  const kinds = ["crm", "twilioNumber", "vapiAssistant", "vapiPhone", "billing", "charges", "texts"];
  const evidence = {};
  // Collectors must exhaust pagination, scope by exact business/setup identity,
  // and verify provider delivery/status, not return cached success receipts.
  await Promise.all(kinds.map(async (kind) => {
    if (typeof collectors?.[kind] !== "function") return;
    try { evidence[kind] = await collectors[kind](expected); }
    catch (_) { evidence[kind] = { complete: false }; }
  }));
  return assessIntakeResources({ expected, evidence, now });
}
module.exports = { deleteStagingDuplicate, compareRecoveryEnvironments, assessIntakeResources, collectIntakeResources };
