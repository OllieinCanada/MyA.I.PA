const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeTaskResult,
  buildStaticSnapshot,
  renderApprovalQueue,
  validateControlConfig,
} = require("../scripts/codex-control-center");

function validConfig() {
  return {
    wip: {
      limit: 2,
      laneLimits: { build: 1, growth: 1 },
      active: [
        { id: "build", lane: "build" },
        { id: "growth", lane: "growth" },
      ],
    },
    scheduledTasks: [{ name: "Task A" }, { name: "Task B" }],
    handoffHeadings: [
      "Outcome",
      "Changed",
      "Verification",
      "Approval needed",
      "Next task",
      "External actions",
    ],
  };
}

function validQueue() {
  return {
    items: [
      {
        id: "approval-1",
        workstream: "Personal Brand",
        priority: "high",
        summary: "Approve one private draft.",
        status: "waiting_for_oliver",
        source: "ops/source.md",
        approvals: ["Exact text"],
      },
    ],
  };
}

test("known Windows task results are decoded into useful states", () => {
  assert.deepEqual(decodeTaskResult(0), { label: "success", health: "healthy" });
  assert.deepEqual(decodeTaskResult(267011), { label: "not yet run", health: "ready" });
  assert.deepEqual(decodeTaskResult(267014), { label: "terminated before handoff", health: "attention" });
  assert.deepEqual(decodeTaskResult(-1073741819), { label: "native process crash", health: "attention" });
});

test("two-item WIP with one item per lane passes validation", () => {
  assert.deepEqual(validateControlConfig(validConfig(), validQueue()), []);
});

test("WIP overflow and lane overflow fail validation", () => {
  const config = validConfig();
  config.wip.active.push({ id: "second-build", lane: "build" });
  const errors = validateControlConfig(config, validQueue());
  assert.equal(errors.some((error) => error.includes("exceeds limit")), true);
  assert.equal(errors.some((error) => error.includes("build WIP")), true);
});

test("approval markdown describes local-only secret handling without a secret value", () => {
  const queue = validQueue();
  queue.items.push({
    id: "x-token",
    workstream: "X Job Finder",
    priority: "medium",
    summary: "Configure X_BEARER_TOKEN locally.",
    status: "user_action",
    source: "config/x-job-finder.json",
    approvals: ["Use .env.local"],
    secretHandling: "local-only",
  });
  const markdown = renderApprovalQueue(queue, "2026-08-23T00:00:00.000Z");
  assert.match(markdown, /never include the value in chat or reports/);
  assert.doesNotMatch(markdown, /X_BEARER_TOKEN\s*=/);
});

test("static refresh keeps last-known task health while updating control data", () => {
  const tasks = [{ name: "Task A", schedulerLabel: "Ready; success" }];
  const snapshot = buildStaticSnapshot(validConfig(), validQueue(), { tasks });
  assert.deepEqual(snapshot.tasks, tasks);
  assert.equal(snapshot.config.wip.active.length, 2);
  assert.equal(snapshot.approvals.items.length, 1);
  assert.match(snapshot.statusRefresh, /last-known automation health/);
  assert.deepEqual(snapshot.errors, []);
});
