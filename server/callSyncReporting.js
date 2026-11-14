// Reporting only. Never grants a business route, dispatch admission or completion.
const fs = require('node:fs');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const proofs = new WeakMap();
const categories = ['verified_simulation', 'signup_intake', 'unresolved_routing'];
const id = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

function parseSimulationEvidence(data) {
  if (data?.schemaVersion !== 1 || data.reportingOnly !== true || !Array.isArray(data.sources)
    || !data.sources.length || data.sources.length > 100 || !Array.isArray(data.calls)
    || !data.calls.length || data.calls.length > 500) throw Error('SIMULATION_REPORT_EVIDENCE_INVALID');
  const sources = new Set(data.sources.map(s => s.sha256));
  if (sources.size !== data.sources.length || [...sources].some(s => !HASH.test(s))) throw Error('SIMULATION_REPORT_EVIDENCE_INVALID');
  const entries = new Map();
  for (const row of data.calls) {
    if (!UUID.test(row?.callId || '') || row.type !== 'vapi.websocketCall'
      || !['tester', 'target'].includes(row.role) || !sources.has(row.sourceSha256)
      || entries.has(row.callId)) throw Error('SIMULATION_REPORT_EVIDENCE_INVALID');
    entries.set(row.callId, row.type);
  }
  // Only an operator-controlled, source-reviewed file may attest historical
  // simulations. Its format/digest links are not a signature or provider proof.
  const proof = Object.freeze({ status: 'loaded', count: entries.size });
  proofs.set(proof, entries);
  return proof;
}

function readSimulationEvidence(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('INVALID_FILE');
    return parseSimulationEvidence(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    return Object.freeze({ status: error.code === 'ENOENT' ? 'absent' : 'invalid', count: 0 });
  }
}

function classifyCallSyncExclusion(call, code, { signupIntake = {}, simulationEvidence } = {}) {
  // Even a known source must not hide a conflict, malformed ID or incomplete read.
  if (!['VAPI_BUSINESS_ROUTE_REQUIRED', 'VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER'].includes(code)) return 'unresolved_routing';
  const rawIds = [call?.assistantId, call?.assistant?.id, call?.phoneNumberId, call?.phoneNumber?.id];
  if (rawIds.some(v => v != null && typeof v !== 'string')) return 'unresolved_routing';
  const assistantIds = [call?.assistantId, call?.assistant?.id].map(id).filter(Boolean);
  const phoneIds = [call?.phoneNumberId, call?.phoneNumber?.id].map(id).filter(Boolean);
  if (code === 'VAPI_BUSINESS_ROUTE_REQUIRED' && !assistantIds.length && !phoneIds.length
    && call?.type === 'vapi.websocketCall' && proofs.get(simulationEvidence)?.get(call.id) === call.type) return 'verified_simulation';
  const assistant = id(signupIntake.assistantId), phone = id(signupIntake.phoneNumberId);
  if (call?.type === 'inboundPhoneCall' && assistant && phone && assistantIds.length && phoneIds.length
    && assistantIds.every(v => v === assistant) && phoneIds.every(v => v === phone)) return 'signup_intake';
  return 'unresolved_routing';
}

function summarizeCallSyncReporting(rows, simulationEvidence) {
  const counts = Object.fromEntries(categories.map(c => [c, 0]));
  for (const row of rows) counts[categories.includes(row.reportingCategory) ? row.reportingCategory : 'unresolved_routing']++;
  return { scope: 'routing_exclusions_only', counts, total: rows.length,
    simulationEvidenceStatus: ['loaded', 'absent', 'invalid'].includes(simulationEvidence?.status) ? simulationEvidence.status : 'absent',
    grantsRouting: false, completionEvidence: false };
}
module.exports = { parseSimulationEvidence, readSimulationEvidence, classifyCallSyncExclusion, summarizeCallSyncReporting };
