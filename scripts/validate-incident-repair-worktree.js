const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { normalizePatchPath, validateIncidentRepairPatch } = require("./validate-incident-repair-patch");

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    input: options.input,
    stdio: [options.input == null ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function validateIncidentRepairWorktree({ patchContent, cwd = process.cwd() } = {}) {
  const expected = validateIncidentRepairPatch(patchContent).files.slice().sort();
  const unstaged = git(["diff", "--name-only", "--no-ext-diff", "--no-textconv", "--", "server", "src", "tests"], { cwd }).trim();
  if (unstaged) throw new Error("The applied repair contains unstaged or post-application mutations.");

  const rows = git(["diff", "--cached", "--name-status", "--no-renames", "--", "server", "src", "tests"], { cwd })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([AM])\t(.+)$/);
      if (!match) throw new Error("The applied repair contains a deleted, renamed, copied, or otherwise unsafe path.");
      const file = normalizePatchPath(match[2]);
      if (!file) throw new Error("The applied repair contains an unsafe path.");
      return file;
    })
    .sort();
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    throw new Error("The applied worktree does not exactly match the validated incident patch.");
  }

  const summary = git(["diff", "--cached", "--summary", "--", "server", "src", "tests"], { cwd })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of summary) {
    if (!/^create mode 100644 (?:server|src|tests)\//.test(line.trim())) {
      throw new Error("The applied repair contains a mode, deletion, rename, copy, symlink, or submodule change.");
    }
  }

  for (const file of expected) {
    const absolute = path.join(cwd, ...file.split("/"));
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The applied repair path is not a regular file: ${file}`);
    const index = git(["ls-files", "-s", "--", file], { cwd }).trim();
    if (!/^100644 [0-9a-f]{40,64} 0\t/.test(index)) {
      throw new Error(`The applied repair has an unsafe Git index mode: ${file}`);
    }
  }
  git(["diff", "--cached", "--check", "--", "server", "src", "tests"], { cwd });
  return { files: expected };
}

function main() {
  const patchPath = path.resolve(process.argv[2] || "diagnostics/incident-repair/incident.patch");
  const result = validateIncidentRepairWorktree({ patchContent: fs.readFileSync(patchPath) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Applied incident repair rejected: ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  validateIncidentRepairWorktree,
};
