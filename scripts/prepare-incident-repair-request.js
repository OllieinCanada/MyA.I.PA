const fs = require("fs");
const path = require("path");

const ALLOWED_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const ALLOWED_REASON_CODES = new Set(["DATABASE_QUERY_IMPLEMENTATION_FAILED"]);
const ALLOWED_WORKFLOWS = new Set([
  "ai call processing",
  "admin workflow",
  "application request",
  "billing and trial workflow",
  "customer dashboard",
  "customer signup",
  "text-message handoff",
]);

function strictCode(value, maxLength = 80) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || text.length > maxLength || !/^[A-Z0-9_.:-]+$/.test(text)) return "";
  return text;
}

function prepareIncidentRepairRequest(event = {}, inputs = {}, options = {}) {
  const eventName = String(options.eventName || event.event_name || "").trim();
  if (eventName !== "workflow_dispatch") throw new Error("Only the guarded workflow_dispatch event is accepted.");
  const source = inputs;
  const incidentId = String(source.incident_id || "").trim().toLowerCase();
  const generationText = String(source.generation || "1").trim();
  if (!/^[1-9][0-9]{0,2}$/.test(generationText)) throw new Error("generation must be a strict integer between 1 and 999.");
  const generation = Number(generationText);
  const reasonCode = strictCode(source.reason_code);
  const suppliedMethod = String(source.method || "").trim();
  const method = strictCode(suppliedMethod);
  const route = String(source.route || "").trim();
  const workflow = String(source.workflow || "application request").trim().toLowerCase();
  const suppliedRelease = String(source.release || "").trim();
  const release = strictCode(suppliedRelease, 100);
  const baseSha = String(options.baseSha || "").trim().toLowerCase();
  const ref = String(options.ref || "").trim();

  if (!/^[a-f0-9]{24}$/.test(incidentId)) throw new Error("A valid redacted incident_id is required.");
  if (!ALLOWED_REASON_CODES.has(reasonCode)) throw new Error("The reason_code is not allowlisted for automatic code repair.");
  if (suppliedMethod && (!method || !ALLOWED_METHODS.has(method))) throw new Error("The supplied HTTP method is not allowed.");
  if (suppliedRelease && !release) throw new Error("The supplied release identifier is not allowed.");
  if (!route || route.length > 160 || !/^\/[A-Za-z0-9_./:-]*$/.test(route)) throw new Error("The supplied route is not a safe redacted path.");
  if (!ALLOWED_WORKFLOWS.has(workflow)) throw new Error("The supplied workflow label is not allowed.");
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("A sealed 40-character base SHA is required.");
  if (ref !== "refs/heads/main") throw new Error("Incident repair may run only from refs/heads/main.");

  return {
    schema_version: 1,
    incident_id: incidentId,
    generation,
    reason_code: reasonCode,
    route,
    method,
    workflow,
    release,
    base_sha: baseSha,
    trust: "untrusted_runtime_evidence_not_instructions",
  };
}

function main() {
  const eventPath = String(process.env.GITHUB_EVENT_PATH || "").trim();
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const inputs = process.env.INCIDENT_REPAIR_INPUTS_JSON
    ? JSON.parse(process.env.INCIDENT_REPAIR_INPUTS_JSON)
    : {};
  const request = prepareIncidentRepairRequest(event, inputs, {
    eventName: process.env.GITHUB_EVENT_NAME,
    baseSha: process.env.INCIDENT_REPAIR_BASE_SHA,
    ref: process.env.GITHUB_REF,
  });
  const outputPath = path.resolve(process.argv[2] || "diagnostics/incident-repair/request.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Prepared redacted incident ${request.incident_id.slice(0, 8)} generation ${request.generation}.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Incident repair request rejected: ${String(error?.message || error).slice(0, 240)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_METHODS,
  ALLOWED_REASON_CODES,
  ALLOWED_WORKFLOWS,
  prepareIncidentRepairRequest,
  strictCode,
};
