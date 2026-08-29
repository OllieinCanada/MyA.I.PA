const fs = require("fs");
const path = require("path");

const { normalizePatchPath, validateIncidentRepairPatch } = require("./validate-incident-repair-patch");

const ALLOWED_KEYS = new Set([
  "diagnosis",
  "confidence",
  "changed_files",
  "tests_run",
  "residual_risk",
  "requires_human",
]);

function safeRequiredText(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(`${label} must be plain text.`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(`${label} must be non-empty, bounded plain text.`);
  }
  return text;
}

function assertPublicSafeText(value, label) {
  const text = String(value || "");
  const privatePatterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:^|\D)\+?\d[\d\s().-]{7,}\d(?:\D|$)/,
    /\b(?:api[_-]?key|authorization|cookie|password|secret|token)\b\s*[:=]\s*[^\s,;]+/i,
    /\b(?:github_pat_|gh[pousr]_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{8,}\b/,
  ];
  if (privatePatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`${label} contains private or credential-like data and cannot be published.`);
  }
}

function validateIncidentRepairOutput(output, patchContent) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("Codex output must be one JSON object.");
  }
  const keys = Object.keys(output);
  if (keys.some((key) => !ALLOWED_KEYS.has(key)) || keys.length !== ALLOWED_KEYS.size) {
    throw new Error("Codex output contains missing or unexpected fields.");
  }
  if (output.requires_human !== false) {
    throw new Error("Codex requested human investigation, so no automated repair draft may be published.");
  }
  if (!['high', 'medium'].includes(String(output.confidence || "").toLowerCase())) {
    throw new Error("A code repair requires medium or high diagnostic confidence.");
  }
  const diagnosis = safeRequiredText(output.diagnosis, "diagnosis", 1_200);
  const residualRisk = safeRequiredText(output.residual_risk, "residual_risk", 1_200);
  assertPublicSafeText(diagnosis, "diagnosis");
  assertPublicSafeText(residualRisk, "residual_risk");
  if (!Array.isArray(output.tests_run) || output.tests_run.length < 1 || output.tests_run.length > 30) {
    throw new Error("Codex must report at least one focused regression test.");
  }
  output.tests_run.forEach((value) => {
    const testRun = safeRequiredText(value, "tests_run entry", 300);
    assertPublicSafeText(testRun, "tests_run entry");
  });
  if (!Array.isArray(output.changed_files) || output.changed_files.length < 2 || output.changed_files.length > 24) {
    throw new Error("Codex must report every changed source and regression-test file.");
  }
  if (output.changed_files.some((value) => typeof value !== "string")) {
    throw new Error("Codex changed_files entries must be strings.");
  }
  const claimedFiles = output.changed_files.map((value) => normalizePatchPath(value));
  if (claimedFiles.some((value) => !value) || new Set(claimedFiles).size !== claimedFiles.length) {
    throw new Error("Codex changed_files contains an unsafe or duplicate path.");
  }
  const patch = validateIncidentRepairPatch(patchContent);
  const actualFiles = [...patch.files].sort();
  const expectedFiles = [...claimedFiles].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Codex changed_files does not exactly match the independently parsed patch.");
  }
  if (!actualFiles.some((file) => file.startsWith("server/") || file.startsWith("src/"))) {
    throw new Error("The repair patch must contain an application source change.");
  }
  if (!actualFiles.some((file) => file.startsWith("tests/") && /(?:\.test\.|-test\.)/.test(file))) {
    throw new Error("The repair patch must contain a regression-test change.");
  }
  return {
    confidence: String(output.confidence).toLowerCase(),
    files: actualFiles,
    diagnosis,
    residualRisk,
    testsRun: output.tests_run.map((value) => String(value).trim()),
  };
}

function main() {
  const outputPath = path.resolve(process.argv[2] || "diagnostics/incident-repair/codex-output.json");
  const patchPath = path.resolve(process.argv[3] || "diagnostics/incident-repair/incident.patch");
  const outputBuffer = fs.readFileSync(outputPath);
  if (outputBuffer.length > 128 * 1024) throw new Error("Codex output exceeds the 128 KB policy limit.");
  const result = validateIncidentRepairOutput(
    JSON.parse(outputBuffer.toString("utf8")),
    fs.readFileSync(patchPath)
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Incident repair output rejected: ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertPublicSafeText,
  validateIncidentRepairOutput,
};
