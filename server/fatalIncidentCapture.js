const fs = require("fs");
const path = require("path");

const { redactIncidentText } = require("./incidentAlerts");

function safeFatalCode(value) {
  return String(value || "FATAL_PROCESS_ERROR")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, 80) || "FATAL_PROCESS_ERROR";
}

function buildFatalIncident(error, { origin = "uncaughtException", now = Date.now(), release = "" } = {}) {
  return {
    schemaVersion: 1,
    recordedAt: new Date(now).toISOString(),
    origin: String(origin || "uncaughtException").replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 60),
    reasonCode: safeFatalCode(error?.code),
    message: redactIncidentText(String(error?.message || "The API process stopped without a safe error message."), { maxLength: 360 }),
    release: String(release || "").replace(/[^a-z0-9_.-]+/gi, "").slice(0, 40),
  };
}

function writeFatalIncident(filePath, error, options = {}) {
  try {
    const incident = buildFatalIncident(error, options);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(incident)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return { written: true, incident };
  } catch (_captureError) {
    return { written: false, incident: null };
  }
}

function readFatalIncident(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed?.schemaVersion !== 1 || !parsed.recordedAt) return null;
    return buildFatalIncident(Object.assign(new Error(parsed.message), { code: parsed.reasonCode }), {
      origin: parsed.origin,
      now: new Date(parsed.recordedAt).getTime(),
      release: parsed.release,
    });
  } catch (_error) {
    return null;
  }
}

async function reportStoredFatalIncident({ filePath, notify }) {
  const incident = readFatalIncident(filePath);
  if (!incident || typeof notify !== "function") return { reported: false, reason: "no_stored_incident" };
  const result = await notify(incident);
  if (result?.sent === true || result?.queued === true) {
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // A duplicate on the next restart is safer than deleting an unconfirmed alert.
    }
    return { reported: true, incident, result };
  }
  return { reported: false, reason: result?.reason || "delivery_not_confirmed", incident, result };
}

function installFatalIncidentCapture({ filePath, enabled = true, release = "" } = {}) {
  if (!enabled || !filePath) return () => {};
  const listener = (error, origin) => {
    writeFatalIncident(filePath, error, { origin, release });
  };
  process.on("uncaughtExceptionMonitor", listener);
  return () => process.removeListener("uncaughtExceptionMonitor", listener);
}

module.exports = {
  buildFatalIncident,
  installFatalIncidentCapture,
  readFatalIncident,
  reportStoredFatalIncident,
  writeFatalIncident,
};
