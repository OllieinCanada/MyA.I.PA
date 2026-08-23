const fs = require("fs");
const path = require("path");

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return process.argv[index + 1];
}

function matchNumber(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Recovery file is missing ${label}`);
  return Number(match[1].replace(/,/g, ""));
}

function main() {
  const projectRoot = path.resolve(argument("--project-root"));
  const runId = argument("--run-id");
  const runLabel = argument("--run-label");
  const started = argument("--started");
  const eventLog = path.resolve(argument("--event-log"));
  const summaryPath = path.resolve(argument("--summary"));
  const recoveryPath = path.join(
    projectRoot,
    "linkedin-outreach-tracker",
    "networking_recovery_2026-08-22.md",
  );

  const recovery = fs.readFileSync(recoveryPath, "utf8");
  const connectionCount = matchNumber(
    recovery,
    /- ([\d,]+) first-degree connections were visible on LinkedIn\./,
    "connection count",
  );
  const pendingCount = matchNumber(
    recovery,
    /- Current verified count: ([\d,]+)\./,
    "pending invitation count",
  );
  const priorities = [...recovery.matchAll(/^### (P\d) — ([^—\r\n]+) —/gm)].map(
    ([, priority, person]) => ({ priority, person: person.trim() }),
  );
  const approvalCount = (
    recovery.match(/^- \[ \] /gm) || []
  ).length;
  const finished = new Date().toISOString();

  const events = [
    {
      type: "turn.started",
      timestamp: started,
      run_id: runId,
      mode: "local-networking-maintenance",
    },
    {
      type: "item.completed",
      timestamp: finished,
      item: {
        type: "networking_snapshot",
        connections: connectionCount,
        pending_invitations: pendingCount,
        queued_priorities: priorities,
        approvals_waiting: approvalCount,
        external_actions: 0,
      },
    },
    {
      type: "turn.completed",
      timestamp: finished,
      run_id: runId,
      external_actions: 0,
    },
  ];

  fs.mkdirSync(path.dirname(eventLog), { recursive: true });
  fs.writeFileSync(
    eventLog,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );

  const priorityLines = priorities.length
    ? priorities.map((item) => `- ${item.priority}: ${item.person}`).join("\n")
    : "- No actionable people are queued.";
  const summary = `# LinkedIn networking recovery maintenance\n\n` +
    `- Run: ${runId}\n` +
    `- Trigger: ${runLabel}\n` +
    `- Started: ${started}\n` +
    `- Last verified connections: ${connectionCount.toLocaleString("en-CA")}\n` +
    `- Last verified pending invitations: ${pendingCount}\n` +
    `- Approval decisions waiting: ${approvalCount}\n` +
    `- External LinkedIn actions: none\n\n` +
    `## Current queue\n\n${priorityLines}\n\n` +
    `No new dated LinkedIn evidence was available to this local-only block. ` +
    `The pending-invitation pause remains active, and the exact drafts in the recovery file remain approval-gated.\n`;
  fs.writeFileSync(summaryPath, summary, "utf8");

  process.stdout.write(
    `LinkedIn maintenance completed: ${pendingCount} pending, ${priorities.length} priority people, ${approvalCount} approvals waiting.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
