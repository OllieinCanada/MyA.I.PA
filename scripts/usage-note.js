const fs = require("fs");
const path = require("path");
const { ensureDir, rootPath } = require("./_helpers");

const usageDir = rootPath("diagnostics", "usage");
const usagePath = path.join(usageDir, "codex-usage-notes.json");

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function readHistory() {
  if (!fs.existsSync(usagePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(usagePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(history) {
  ensureDir(usageDir);
  fs.writeFileSync(usagePath, `${JSON.stringify(history, null, 2)}\n`);
}

function parsePercent(name) {
  const raw = getArg(name);
  if (!raw) return null;
  const value = Number(String(raw).replace("%", ""));
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`--${name} must be a number from 0 to 100.`);
  }
  return value;
}

function formatDelta(value) {
  if (value == null) return "n/a";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function summarize(history) {
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];

  console.log("Codex usage notes");
  console.log("=================");
  if (!latest) {
    console.log("No usage notes yet.");
    console.log("Add one with: npm run usage:note -- --five-hour=9 --weekly=64 --task=\"signup work\"");
    return;
  }

  console.log(`Latest: ${new Date(latest.createdAt).toLocaleString()}`);
  console.log(`5-hour remaining: ${latest.fiveHourRemaining}%`);
  console.log(`Weekly remaining: ${latest.weeklyRemaining}%`);
  if (latest.task) console.log(`Task: ${latest.task}`);

  if (previous) {
    const fiveHourDelta = latest.fiveHourRemaining - previous.fiveHourRemaining;
    const weeklyDelta = latest.weeklyRemaining - previous.weeklyRemaining;
    console.log("");
    console.log(`Since previous note:`);
    console.log(`5-hour change: ${formatDelta(fiveHourDelta)}`);
    console.log(`Weekly change: ${formatDelta(weeklyDelta)}`);
    if (fiveHourDelta < 0) console.log(`5-hour used: ${Math.abs(Math.round(fiveHourDelta * 10) / 10)}%`);
    if (weeklyDelta < 0) console.log(`Weekly used: ${Math.abs(Math.round(weeklyDelta * 10) / 10)}%`);
  }

  console.log("");
  if (latest.fiveHourRemaining <= 10) {
    console.log("Recommendation: 5-hour usage is very low. Use scripts, keep prompts tight, and avoid broad refactors until reset.");
  } else if (latest.fiveHourRemaining <= 25) {
    console.log("Recommendation: 5-hour usage is getting low. Prefer diagnostics/deploy scripts over manual investigation.");
  } else {
    console.log("Recommendation: usage looks okay. Still use scripts for repeatable work.");
  }

  console.log("");
  console.log(`History saved at: ${usagePath}`);
}

function listHistory(history) {
  if (!history.length) {
    summarize(history);
    return;
  }

  console.log("Codex usage history");
  console.log("===================");
  for (const item of history.slice(-20)) {
    const date = new Date(item.createdAt).toLocaleString();
    const task = item.task ? ` | ${item.task}` : "";
    console.log(`${date} | 5-hour ${item.fiveHourRemaining}% | weekly ${item.weeklyRemaining}%${task}`);
  }
}

function main() {
  const shouldList = process.argv.includes("--list");
  const history = readHistory();

  if (shouldList) {
    listHistory(history);
    return;
  }

  const fiveHourRemaining = parsePercent("five-hour");
  const weeklyRemaining = parsePercent("weekly");
  const task = getArg("task");

  if (fiveHourRemaining == null || weeklyRemaining == null) {
    summarize(history);
    return;
  }

  const entry = {
    createdAt: new Date().toISOString(),
    fiveHourRemaining,
    weeklyRemaining,
    task,
  };

  history.push(entry);
  writeHistory(history);
  summarize(history);
}

main();
