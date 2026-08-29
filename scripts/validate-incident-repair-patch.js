const fs = require("fs");
const path = require("path");

const MAX_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_CHANGED_FILES = 24;
const MAX_CHANGED_LINES = 5_000;
const ALLOWED_PREFIXES = ["server/", "src/", "tests/"];
const BLOCKED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "render.yaml",
]);
const WINDOWS_RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function normalizePatchPath(value) {
  const filePath = String(value || "").trim().replace(/\\/g, "/");
  if (
    !filePath
    || filePath.length > 240
    || filePath.startsWith("/")
    || !/^[A-Za-z0-9._/-]+$/.test(filePath)
    || filePath.includes("//")
  ) return "";
  const segments = filePath.split("/");
  if (segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || segment.length > 100
    || !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(segment)
    || segment.endsWith(".")
    || WINDOWS_RESERVED_BASENAMES.test(segment)
  ))) return "";
  return filePath;
}

function validateIncidentRepairPatch(content) {
  const inputBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "utf8");
  const patch = inputBuffer.toString("utf8");
  if (!Buffer.from(patch, "utf8").equals(inputBuffer) || patch.includes("\u0000") || patch.includes("\ufffd")) {
    throw new Error("The incident patch must be canonical UTF-8 text without NUL bytes.");
  }
  if (!patch.trim()) throw new Error("Codex produced no patch.");
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error("The incident patch exceeds the 2 MB safety limit.");
  const files = [];
  let changedLines = 0;
  let current = null;

  const validatePath = (value) => {
    const filePath = normalizePatchPath(value);
    if (!filePath || BLOCKED_FILES.has(filePath) || !ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
      throw new Error(`Incident repair path is outside the allowlist: ${filePath || "invalid"}`);
    }
    if (!/\.(?:css|js|json|jsx|mjs|ts|tsx)$/.test(filePath)) {
      throw new Error(`Incident repair file type is not allowed: ${filePath}`);
    }
    return filePath;
  };

  const finishSection = () => {
    if (!current) return;
    if (!current.oldHeader || !current.newHeader || !current.hasHunk) {
      throw new Error(`Incident repair diff is incomplete for ${current.path}.`);
    }
  };

  for (const line of patch.replace(/\r?\n$/, "").split(/\r?\n/)) {
    if (line.startsWith("diff ")) {
      const match = line.match(/^diff --git a\/([^\s"'`]+) b\/([^\s"'`]+)$/);
      if (!match) throw new Error("Only strict unquoted git diff sections are allowed.");
      finishSection();
      const from = validatePath(match[1]);
      const to = validatePath(match[2]);
      if (from !== to) throw new Error("Renames and copies are not allowed in incident repairs.");
      current = {
        path: to,
        newFile: false,
        oldHeader: false,
        newHeader: false,
        hasHunk: false,
        inHunk: false,
      };
      files.push(to);
      continue;
    }
    if (!current) {
      if (line.trim()) throw new Error("Unexpected content appeared before the first git diff section.");
      continue;
    }
    if (/^(?:GIT binary patch|Binary files |Submodule |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename (?:from|to) |copy (?:from|to) )/.test(line)) {
      throw new Error("Binary, submodule, mode, rename, copy, and deletion changes are not allowed.");
    }
    if (line.startsWith("new file mode ")) {
      if (line !== "new file mode 100644" || current.oldHeader || current.hasHunk) {
        throw new Error("Only regular 100644 source or test files may be added.");
      }
      current.newFile = true;
      continue;
    }
    if (line.startsWith("index ")) {
      if (!/^index [0-9a-f]+\.\.[0-9a-f]+(?: 100644)?$/i.test(line)) {
        throw new Error("The patch contains an unsafe index or file mode.");
      }
      continue;
    }
    if (!current.inHunk && line.startsWith("--- ")) {
      const expected = current.newFile ? "/dev/null" : `a/${current.path}`;
      if (line !== `--- ${expected}` || current.oldHeader) throw new Error("The old-file patch header is unsafe or duplicated.");
      current.oldHeader = true;
      continue;
    }
    if (!current.inHunk && line.startsWith("+++ ")) {
      if (line !== `+++ b/${current.path}` || !current.oldHeader || current.newHeader) {
        throw new Error("The new-file patch header is unsafe or duplicated.");
      }
      current.newHeader = true;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!current.oldHeader || !current.newHeader || !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
        throw new Error("The patch contains an invalid hunk header.");
      }
      current.hasHunk = true;
      current.inHunk = true;
      continue;
    }
    if (current.inHunk) {
      if (line === "\\ No newline at end of file" || line.startsWith(" ")) continue;
      if (line.startsWith("+") || line.startsWith("-")) {
        changedLines += 1;
        continue;
      }
      throw new Error(`Unexpected content appeared inside the patch for ${current.path}.`);
    }
    if (line.trim()) throw new Error(`Unexpected patch metadata appeared for ${current.path}.`);
  }
  finishSection();
  const uniqueFiles = [...new Set(files)];
  if (!uniqueFiles.length) throw new Error("The patch did not contain a recognized file diff.");
  if (uniqueFiles.length !== files.length) throw new Error("A file may appear in only one incident-repair diff section.");
  if (new Set(uniqueFiles.map((filePath) => filePath.toLowerCase())).size !== uniqueFiles.length) {
    throw new Error("Incident repair paths must also be unique when compared case-insensitively.");
  }
  if (uniqueFiles.length > MAX_CHANGED_FILES) throw new Error("The incident patch changes too many files.");
  if (changedLines > MAX_CHANGED_LINES) throw new Error("The incident patch changes too many lines.");
  return { files: uniqueFiles, changedLines, bytes: Buffer.byteLength(patch) };
}

function main() {
  const patchPath = path.resolve(process.argv[2] || "diagnostics/incident-repair/incident.patch");
  const result = validateIncidentRepairPatch(fs.readFileSync(patchPath));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Incident repair patch rejected: ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_PREFIXES,
  MAX_CHANGED_FILES,
  MAX_CHANGED_LINES,
  MAX_PATCH_BYTES,
  normalizePatchPath,
  validateIncidentRepairPatch,
};
