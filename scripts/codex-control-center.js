const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HUB_ROOT = path.resolve(__dirname, "..");
const DESKTOP_ROOT = path.dirname(HUB_ROOT);
const CONFIG_PATH = path.join(HUB_ROOT, "config", "codex-control-center.json");
const APPROVAL_JSON_PATH = path.join(HUB_ROOT, "ops", "APPROVAL_QUEUE.json");
const APPROVAL_MD_PATH = path.join(HUB_ROOT, "ops", "APPROVAL_QUEUE.md");
const DASHBOARD_MD_PATH = path.join(HUB_ROOT, "ops", "CODEX_CONTROL_CENTER.md");
const DASHBOARD_JSON_PATH = path.join(HUB_ROOT, "data", "codex-control-center.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function expandProjectRoot(value) {
  return String(value || "")
    .replaceAll("${HUB_ROOT}", HUB_ROOT)
    .replaceAll("${DESKTOP_ROOT}", DESKTOP_ROOT)
    .replaceAll("/", path.sep);
}

function normalizeTaskCode(value) {
  return Number(value) >>> 0;
}

function decodeTaskResult(value) {
  const code = normalizeTaskCode(value);
  const known = {
    0: { label: "success", health: "healthy" },
    267011: { label: "not yet run", health: "ready" },
    267014: { label: "terminated before handoff", health: "attention" },
    3221225477: { label: "native process crash", health: "attention" },
  };
  return known[code] || { label: `exit ${code}`, health: code === 0 ? "healthy" : "attention" };
}

function getScheduledTaskStatuses(taskNames) {
  if (process.platform !== "win32") return [];
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(HUB_ROOT, "scripts", "get-codex-task-status.ps1"),
    "-HubRoot",
    HUB_ROOT,
  ], { cwd: HUB_ROOT, encoding: "utf8", timeout: 30000 });

  if (result.error || result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function gitState(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) return { state: "missing", detail: "Project root is unavailable." };
  const result = spawnSync("git", ["-C", projectRoot, "status", "--porcelain=v1"], {
    encoding: "utf8",
    timeout: 12000,
  });
  if (result.error || result.status !== 0) {
    return { state: "unknown", detail: (result.stderr || result.error?.message || "Git status failed").trim() };
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  return lines.length
    ? { state: "dirty", detail: `${lines.length} existing change(s); automation must safe-skip.` }
    : { state: "clean", detail: "Clean worktree." };
}

function latestHistoryState(relativePath) {
  const historyPath = path.join(HUB_ROOT, relativePath || "");
  if (!relativePath || !fs.existsSync(historyPath)) return { state: "no history", historyPath };
  const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1) || "";
  const phase = /phase=([^ ]+)/.exec(last)?.[1] || "unknown";
  const exitCode = Number(/exit=(-?\d+)/.exec(last)?.[1] ?? NaN);
  const summaryPath = /summary=(.+)$/.exec(last)?.[1] || "";
  let state = phase.startsWith("attempt-") ? "running or interrupted" : phase;
  if (phase === "end" && exitCode === 0) {
    state = "verified handoff";
    if (summaryPath && fs.existsSync(summaryPath)) {
      const summary = fs.readFileSync(summaryPath, "utf8");
      if (/Status:\s*skipped/i.test(summary)) state = "safe skip verified";
      if (/Status:\s*ready/i.test(summary)) state = "runner validated";
    }
  }
  return {
    state,
    phase,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    summaryPath,
    historyPath,
  };
}

function envKeyConfigured(key) {
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(HUB_ROOT, filename);
    if (!fs.existsSync(filePath)) continue;
    const line = fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));
    if (line && line.slice(line.indexOf("=") + 1).trim()) return true;
  }
  return Boolean(process.env[key]);
}

function validateControlConfig(config, approvalQueue) {
  const errors = [];
  const active = config?.wip?.active || [];
  const limit = Number(config?.wip?.limit || 0);
  if (!Number.isInteger(limit) || limit < 1) errors.push("WIP limit must be a positive integer.");
  if (active.length > limit) errors.push(`Active WIP ${active.length} exceeds limit ${limit}.`);

  const laneCounts = new Map();
  for (const item of active) laneCounts.set(item.lane, (laneCounts.get(item.lane) || 0) + 1);
  for (const [lane, laneLimit] of Object.entries(config?.wip?.laneLimits || {})) {
    if ((laneCounts.get(lane) || 0) > laneLimit) errors.push(`Active ${lane} WIP exceeds lane limit ${laneLimit}.`);
  }

  const taskNames = (config.scheduledTasks || []).map((task) => task.name);
  if (new Set(taskNames).size !== taskNames.length) errors.push("Scheduled task names must be unique.");

  const expectedHeadings = ["Outcome", "Changed", "Verification", "Approval needed", "Next task", "External actions"];
  if (JSON.stringify(config.handoffHeadings) !== JSON.stringify(expectedHeadings)) {
    errors.push("Handoff headings do not match the required standard.");
  }

  const approvalIds = new Set();
  for (const item of approvalQueue?.items || []) {
    if (!item.id || approvalIds.has(item.id)) errors.push(`Approval item id is missing or duplicated: ${item.id || "(missing)"}.`);
    approvalIds.add(item.id);
    if (!item.summary || !item.status || !item.source) errors.push(`Approval item ${item.id} is incomplete.`);
  }
  const serializedQueue = JSON.stringify(approvalQueue);
  if (/X_BEARER_TOKEN\s*=\s*[^"\\]/.test(serializedQueue)) errors.push("The approval queue must not contain an X bearer-token value.");
  return errors;
}

function markdownEscape(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function renderApprovalQueue(queue, generatedAt) {
  const lines = [
    "# Unified approval queue",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This is the single private queue for decisions or actions that require Oliver. It contains no credential values.",
    "",
  ];
  for (const item of queue.items || []) {
    lines.push(`## ${item.priority.toUpperCase()} — ${item.workstream}`);
    lines.push("");
    lines.push(`- [ ] ${item.summary}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Source: ${item.source}`);
    lines.push("- Required:");
    for (const approval of item.approvals || []) lines.push(`  - ${approval}`);
    if (item.secretHandling) lines.push(`- Secret handling: ${item.secretHandling}; never include the value in chat or reports.`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderDashboard(snapshot) {
  const { generatedAt, config, approvals, tasks, xTokenConfigured, errors } = snapshot;
  const lines = [
    "# Codex control centre",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Executive status",
    "",
    `- Active WIP: ${config.wip.active.length}/${config.wip.limit}`,
    `- Approval/user-action items: ${approvals.items.length}`,
    `- X job-finder credential: ${xTokenConfigured ? "configured locally" : "missing — add X_BEARER_TOKEN to .env.local; never paste it into chat"}`,
    `- Policy validation: ${errors.length ? `${errors.length} problem(s)` : "passed"}`,
    "",
    "## Active WIP",
    "",
    "| Lane | Workstream | Definition of done |",
    "| --- | --- | --- |",
  ];
  for (const item of config.wip.active) {
    lines.push(`| ${markdownEscape(item.lane)} | ${markdownEscape(item.workstream)} | ${markdownEscape(item.definitionOfDone)} |`);
  }
  lines.push("", "## Queued or blocked", "", "| Lane | Workstream | Blocker |", "| --- | --- | --- |");
  for (const item of config.wip.queued || []) {
    lines.push(`| ${markdownEscape(item.lane)} | ${markdownEscape(item.workstream)} | ${markdownEscape(item.blockedBy)} |`);
  }
  lines.push("", "## Automation health", "", "Historical scheduler results remain visible until Windows records the next scheduled run; Current runner is the latest direct validation.", "", "| Workstream | Task | Scheduler history | Project | Current runner | Next run |", "| --- | --- | --- | --- | --- | --- |");
  for (const task of tasks) {
    lines.push(`| ${markdownEscape(task.workstream)} | ${markdownEscape(task.name)} | ${markdownEscape(task.schedulerLabel)} | ${markdownEscape(task.project.state)} | ${markdownEscape(task.history.state)} | ${markdownEscape(task.nextRun || "unknown")} |`);
  }
  lines.push("", "## Approval queue", "");
  for (const item of approvals.items) lines.push(`- [ ] **${item.priority} · ${item.workstream}:** ${item.summary}`);
  lines.push("", "Full queue: `ops/APPROVAL_QUEUE.md`", "", "## Automatic work", "");
  for (const item of config.automaticActions) lines.push(`- ${item}`);
  lines.push("", "## Always requires approval", "");
  for (const item of config.approvalRequiredActions) lines.push(`- ${item}`);
  lines.push("", "## Standard handoff", "");
  for (const heading of config.handoffHeadings) lines.push(`- ${heading}`);
  if (errors.length) {
    lines.push("", "## Control-centre validation problems", "");
    for (const error of errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function buildSnapshot(config, approvals) {
  const statuses = getScheduledTaskStatuses((config.scheduledTasks || []).map((task) => task.name));
  const statusByName = new Map(statuses.map((status) => [status.name, status]));
  const projectStates = new Map();
  const tasks = (config.scheduledTasks || []).map((task) => {
    const scheduler = statusByName.get(task.name);
    const decoded = scheduler?.installed ? decodeTaskResult(scheduler.lastResult) : { label: "not installed", health: "attention" };
    const projectRoot = expandProjectRoot(task.projectRoot);
    if (!projectStates.has(projectRoot)) projectStates.set(projectRoot, gitState(projectRoot));
    return {
      ...task,
      scheduler: scheduler || { installed: false },
      schedulerLabel: scheduler?.installed ? `${scheduler.state}; ${decoded.label}` : "not installed",
      schedulerHealth: decoded.health,
      nextRun: scheduler?.nextRun || "",
      project: projectStates.get(projectRoot),
      history: latestHistoryState(task.history),
    };
  });
  const generatedAt = new Date().toISOString();
  const errors = validateControlConfig(config, approvals);
  return { generatedAt, config, approvals, tasks, xTokenConfigured: envKeyConfigured("X_BEARER_TOKEN"), errors };
}

function buildStaticSnapshot(config, approvals, previousSnapshot = {}) {
  return {
    generatedAt: new Date().toISOString(),
    config,
    approvals,
    tasks: Array.isArray(previousSnapshot.tasks) ? previousSnapshot.tasks : [],
    xTokenConfigured: envKeyConfigured("X_BEARER_TOKEN"),
    errors: validateControlConfig(config, approvals),
    statusRefresh: "skipped; retained last-known automation health",
  };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const staticOnly = process.argv.includes("--static");
  const config = readJson(CONFIG_PATH);
  const approvals = readJson(APPROVAL_JSON_PATH);
  if (checkOnly) {
    const errors = validateControlConfig(config, approvals);
    console.log(`Codex control-centre validation: ${errors.length ? `${errors.length} problem(s)` : "passed"}`);
    for (const error of errors) console.error(`- ${error}`);
    if (errors.length) process.exitCode = 1;
    return;
  }
  let previousSnapshot = {};
  if (staticOnly && fs.existsSync(DASHBOARD_JSON_PATH)) {
    try {
      previousSnapshot = readJson(DASHBOARD_JSON_PATH);
    } catch {
      previousSnapshot = {};
    }
  }
  const snapshot = staticOnly
    ? buildStaticSnapshot(config, approvals, previousSnapshot)
    : buildSnapshot(config, approvals);

  ensureParent(APPROVAL_MD_PATH);
  ensureParent(DASHBOARD_MD_PATH);
  ensureParent(DASHBOARD_JSON_PATH);
  fs.writeFileSync(APPROVAL_MD_PATH, renderApprovalQueue(approvals, snapshot.generatedAt));
  fs.writeFileSync(DASHBOARD_MD_PATH, renderDashboard(snapshot));
  fs.writeFileSync(DASHBOARD_JSON_PATH, JSON.stringify(snapshot, null, 2));

  console.log(`Codex control centre: ${DASHBOARD_MD_PATH}`);
  console.log(`Unified approval queue: ${APPROVAL_MD_PATH}`);
  console.log(`Active WIP: ${config.wip.active.length}/${config.wip.limit}`);
  if (staticOnly) console.log("Automation health: retained from the last live refresh");
  console.log(`X bearer token: ${snapshot.xTokenConfigured ? "configured locally" : "missing; local .env.local action required"}`);
  console.log(`Validation: ${snapshot.errors.length ? `${snapshot.errors.length} problem(s)` : "passed"}`);
  for (const error of snapshot.errors) console.error(`- ${error}`);
}

if (require.main === module) main();

module.exports = {
  decodeTaskResult,
  renderApprovalQueue,
  renderDashboard,
  buildStaticSnapshot,
  validateControlConfig,
};
