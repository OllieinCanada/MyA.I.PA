const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const STATE_BRANCH = "ops/production-monitor-state";
const STATE_FILE = "production-monitor-state.json";
const DEFAULT_LOCAL_PATH = "diagnostics/operations/production-monitor-state.json";
const PUBLIC_FINGERPRINT_SUFFIX = /^public_[a-f0-9]{32}$/;
const PUBLIC_LIFECYCLE_ID = /^public_[a-f0-9]{24}$/;

function git(args, { input, allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      input,
      stdio: [input == null ? "ignore" : "pipe", "pipe", allowFailure ? "ignore" : "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

function publicMonitorStateRecord(rawFingerprint, incident) {
  if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
    throw new Error("Monitor state contains an invalid incident record.");
  }
  const fingerprint = String(rawFingerprint || "").toLowerCase();
  if (!/^(?:check|issue):[a-z0-9_.:-]{1,193}$/.test(fingerprint) || fingerprint.length > 200) {
    throw new Error("Monitor state contains an unsafe fingerprint.");
  }
  const type = String(incident.type || "");
  if (!['check', 'operational'].includes(type)) throw new Error("Monitor state contains an invalid incident type.");
  const checkName = String(incident.checkName || "").toLowerCase();
  if (!/^[a-z0-9_.:-]{0,80}$/.test(checkName)) throw new Error("Monitor state contains an invalid check name.");
  const publicPrefix = type === "operational" ? "issue:operational_health" : `check:${checkName}`;
  if (type === "check" && (!checkName || !fingerprint.startsWith(`check:${checkName}:`))) {
    throw new Error("Monitor check state must include its exact check name.");
  }
  if (type === "operational" && (!fingerprint.startsWith("issue:") || checkName !== "operational_health")) {
    throw new Error("Operational monitor state must use the operational health check.");
  }
  const suffix = fingerprint.startsWith(`${publicPrefix}:`)
    ? fingerprint.slice(publicPrefix.length + 1)
    : "";
  const publicFingerprint = PUBLIC_FINGERPRINT_SUFFIX.test(suffix)
    ? fingerprint
    : `${publicPrefix}:public_${crypto.createHash("sha256")
      .update(`monitor-state-fingerprint-v1:${fingerprint}`)
      .digest("hex")
      .slice(0, 32)}`;
  if (typeof incident.firstDetectedAt !== "string") throw new Error("Monitor state contains an invalid timestamp.");
  const detectedAt = new Date(incident.firstDetectedAt);
  if (Number.isNaN(detectedAt.getTime()) || detectedAt.toISOString() !== incident.firstDetectedAt) {
    throw new Error("Monitor state contains an invalid timestamp.");
  }
  const lifecycleId = `public_${crypto.createHash("sha256")
    .update(`monitor-state-lifecycle-v1:${publicFingerprint}`)
    .digest("hex")
    .slice(0, 24)}`;
  if (!PUBLIC_LIFECYCLE_ID.test(lifecycleId)) throw new Error("Monitor state lifecycle ID generation failed.");
  return {
    fingerprint: publicFingerprint,
    record: {
      lifecycleId,
      type,
      checkName,
      firstDetectedAt: detectedAt.toISOString(),
    },
  };
}

function canonicalMonitorState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Monitor state must be one JSON object.");
  if (value.schemaVersion !== 2) throw new Error("Monitor state must use schema version 2.");
  if (!value.incidents || typeof value.incidents !== "object" || Array.isArray(value.incidents)) {
    throw new Error("Monitor state incidents must be one JSON object.");
  }
  const entries = Object.entries(value.incidents);
  if (entries.length > 150) throw new Error("Monitor state exceeds the 150-incident safety limit.");
  const incidents = Object.create(null);
  for (const [fingerprint, incident] of entries) {
    const publicRecord = publicMonitorStateRecord(fingerprint, incident);
    incidents[publicRecord.fingerprint] = publicRecord.record;
  }
  return `${JSON.stringify({ schemaVersion: 2, incidents }, null, 2)}\n`;
}

function fetchStateBranch() {
  try {
    execFileSync("git", [
      "ls-remote",
      "--exit-code",
      "--heads",
      "origin",
      `refs/heads/${STATE_BRANCH}`,
    ], { stdio: "ignore" });
  } catch (error) {
    if (Number(error?.status) === 2) return { fetched: false, missing: true, unavailable: false };
    return { fetched: false, missing: false, unavailable: true };
  }
  try {
    execFileSync("git", [
      "fetch",
      "--no-tags",
      "--depth=1",
      "origin",
      `+refs/heads/${STATE_BRANCH}:refs/remotes/origin/${STATE_BRANCH}`,
    ], { stdio: "ignore" });
    return { fetched: true, missing: false, unavailable: false };
  } catch (_error) {
    return { fetched: false, missing: false, unavailable: true };
  }
}

function restoreMonitorState(localPath = DEFAULT_LOCAL_PATH) {
  const resolved = path.resolve(localPath);
  let canonical = canonicalMonitorState({ schemaVersion: 2, incidents: {} });
  let warning = "";
  const branch = fetchStateBranch();
  if (branch.fetched) {
    const stored = git(["show", `refs/remotes/origin/${STATE_BRANCH}:${STATE_FILE}`], { allowFailure: true });
    if (stored) {
      try {
        canonical = canonicalMonitorState(JSON.parse(stored));
      } catch (_error) {
        warning = "monitor_state_invalid";
      }
    } else {
      warning = "monitor_state_missing";
    }
  } else if (branch.unavailable) {
    warning = "monitor_state_unavailable";
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, canonical, { encoding: "utf8", mode: 0o600 });
  return { restored: true, path: resolved, warning };
}

function persistMonitorState(localPath = DEFAULT_LOCAL_PATH) {
  const resolved = path.resolve(localPath);
  if (!fs.existsSync(resolved)) return { persisted: false, reason: "state_file_missing" };
  const raw = fs.readFileSync(resolved, "utf8");
  if (Buffer.byteLength(raw) > 128 * 1024) throw new Error("Monitor state exceeds the 128 KB safety limit.");
  const canonical = canonicalMonitorState(JSON.parse(raw));
  const branch = fetchStateBranch();
  if (branch.unavailable) throw new Error("The dedicated monitor state branch is unavailable.");
  const parent = branch.fetched ? git(["rev-parse", `refs/remotes/origin/${STATE_BRANCH}`]) : "";
  const previous = branch.fetched
    ? git(["show", `refs/remotes/origin/${STATE_BRANCH}:${STATE_FILE}`], { allowFailure: true })
    : "";
  if (previous) {
    try {
      const canonicalPrevious = canonicalMonitorState(JSON.parse(previous));
      // A legacy state file can normalize to the same lifecycle meaning while
      // still containing raw IDs. Only skip the push when the remote bytes are
      // already the strict public projection.
      if (canonicalPrevious === canonical && `${previous}\n` === canonical) {
        return { persisted: false, reason: "state_unchanged" };
      }
    } catch (_error) {
      // Preserve the remote commit as the parent, but replace its malformed state.
    }
  }
  const blob = git(["hash-object", "-w", "--stdin"], { input: canonical });
  const tree = git(["mktree"], { input: `100644 blob ${blob}\t${STATE_FILE}\n` });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "My AI PA Production Monitor",
    GIT_AUTHOR_EMAIL: "monitor-bot@users.noreply.github.com",
    GIT_COMMITTER_NAME: "My AI PA Production Monitor",
    GIT_COMMITTER_EMAIL: "monitor-bot@users.noreply.github.com",
  };
  const commit = execFileSync("git", ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], {
    encoding: "utf8",
    input: "Update production monitor lifecycle state\n",
    env,
  }).trim();
  git(["push", "origin", `${commit}:refs/heads/${STATE_BRANCH}`]);
  return { persisted: true, commit };
}

function main() {
  const command = String(process.argv[2] || "").trim().toLowerCase();
  const localPath = process.argv[3] || DEFAULT_LOCAL_PATH;
  const result = command === "restore"
    ? restoreMonitorState(localPath)
    : command === "persist"
      ? persistMonitorState(localPath)
      : (() => { throw new Error("Use restore or persist."); })();
  if (process.env.GITHUB_OUTPUT && result.warning) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `warning=${result.warning}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Production monitor state sync failed: ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  STATE_BRANCH,
  STATE_FILE,
  canonicalMonitorState,
  persistMonitorState,
  publicMonitorStateRecord,
  restoreMonitorState,
};
