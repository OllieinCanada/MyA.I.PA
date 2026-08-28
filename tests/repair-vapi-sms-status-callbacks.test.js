const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CALLBACK_ENV_NAME,
  CALLBACK_URL,
  CANARY_CONFIRMATION_PHRASE,
  CONFIRMATION_PHRASE,
  clientControlledProjection,
  createVapiClient,
  inspectConcurrency,
  inspectReadback,
  inspectRollbackReadback,
  isManagedSummaryTool,
  parseArgs,
  repairStatusCallbacks,
  replaceStatusCallback,
  shortHash,
} = require("../scripts/repair-vapi-sms-status-callbacks");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function managedTool(id = "tool-sensitive-9055551234", callback = "") {
  return {
    id,
    orgId: "org-sensitive",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    latestVersion: "v1",
    type: "code",
    function: {
      name: "send_call_summaries_1234_deadbeef_v2",
      description: "Send the two summaries.",
      parameters: { type: "object", properties: { summary: { type: "string" } } },
    },
    code: "return true;",
    environmentVariables: [
      { name: "TWILIO_ACCOUNT_SID", value: "AC-not-for-output" },
      { name: "TWILIO_AUTH_TOKEN", value: "private-auth-token" },
      { name: "DEFAULT_OWNER_TO_NUMBER", value: "+19055551234" },
      ...(callback ? [{ name: CALLBACK_ENV_NAME, value: callback }] : []),
    ],
    messages: [{ type: "request-start", content: "Got it.", blocking: false }],
    rejectionPlan: { conditions: [{ type: "group", conditions: [] }] },
    timeoutSeconds: 20,
  };
}

function mockClient(initialTools, { readbackTransform, failPatchAt = 0 } = {}) {
  const states = new Map(initialTools.map((tool) => [tool.id, clone(tool)]));
  const patchCalls = [];
  let patchCount = 0;
  let getCount = 0;
  return {
    states,
    patchCalls,
    async listTools() {
      return {
        data: [
          ...initialTools.map((tool) => ({ id: tool.id, function: { name: tool.function.name } })),
          { id: "dynamic-tool", function: { name: "send_call_summaries_dynamic" } },
          { id: "unrelated-tool", function: { name: "calendar_lookup" } },
        ],
      };
    },
    async getTool(id) {
      getCount += 1;
      const value = clone(states.get(id));
      return readbackTransform ? readbackTransform(value, { id, getCount, patchCount }) : value;
    },
    async patchToolEnvironment(id, environmentVariables) {
      patchCount += 1;
      patchCalls.push({ id, environmentVariables: clone(environmentVariables) });
      if (failPatchAt && patchCount === failPatchAt) throw new Error("private provider failure");
      const current = states.get(id);
      states.set(id, {
        ...current,
        updatedAt: `2026-08-28T00:00:0${patchCount}.000Z`,
        latestVersion: `v${patchCount + 1}`,
        environmentVariables: clone(environmentVariables),
      });
      return clone(states.get(id));
    },
  };
}

test("managed targeting accepts only isolated send_call_summaries tools", () => {
  assert.equal(isManagedSummaryTool(managedTool()), true);
  assert.equal(isManagedSummaryTool({ function: { name: "send_call_summaries_dynamic" } }), false);
  assert.equal(isManagedSummaryTool({ function: { name: "send_call_summaries_unmanaged" } }), false);
  assert.equal(isManagedSummaryTool({ function: { name: "calendar_lookup_1234_deadbeef_v2" } }), false);
});

test("callback replacement changes only the named environment variable", () => {
  const original = managedTool("tool-1", "https://old.example.test/status").environmentVariables;
  const desired = replaceStatusCallback(original);
  assert.deepEqual(desired, original.map((entry) => entry.name === CALLBACK_ENV_NAME
    ? { ...entry, value: CALLBACK_URL }
    : entry));
  assert.notStrictEqual(desired, original);
  assert.equal(original.find((entry) => entry.name === CALLBACK_ENV_NAME).value, "https://old.example.test/status");
});

test("callback replacement fails closed for duplicate or masked values", () => {
  assert.throws(() => replaceStatusCallback([
    { name: CALLBACK_ENV_NAME, value: "" },
    { name: CALLBACK_ENV_NAME, value: "" },
  ]), /duplicate status-callback/i);
  assert.throws(() => replaceStatusCallback([
    { name: "TWILIO_AUTH_TOKEN", value: "********private" },
  ]), /masked value/i);
  assert.throws(() => replaceStatusCallback(null), /no readable environment-variable array/i);
});

test("dry-run inventories hashes without patching or leaking tool data", async () => {
  const tool = managedTool();
  const client = mockClient([tool]);
  const report = await repairStatusCallbacks({ client });
  const serialized = JSON.stringify(report);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.counts.listed, 3);
  assert.equal(report.counts.managed, 1);
  assert.equal(report.counts.selected, 1);
  assert.equal(report.counts.planned, 1);
  assert.equal(report.publicationRequired, true);
  assert.equal(report.liveImpactConfirmed, false);
  assert.equal(client.patchCalls.length, 0);
  assert.doesNotMatch(serialized, /tool-sensitive|send_call_summaries|private-auth-token|9055551234|AC-not-for-output/);
  assert.deepEqual(Object.keys(report).sort(), [
    "appliedToolHashes",
    "beforeConfigurationHashes",
    "callbackUrlHash",
    "concurrencyHashes",
    "counts",
    "desiredConfigurationHashes",
    "failedToolHashes",
    "liveImpactConfirmed",
    "managedToolHashes",
    "mode",
    "plannedToolHashes",
    "publicationRequired",
    "rolledBackToolHashes",
    "selectedToolHashes",
    "verifiedToolHashes",
  ].sort());
});

test("batch apply is disabled before making a network call", async () => {
  let listed = false;
  const client = {
    async listTools() { listed = true; return []; },
    async getTool() {},
    async patchToolEnvironment() {},
  };
  await assert.rejects(
    repairStatusCallbacks({ client, apply: true, confirmation: CONFIRMATION_PHRASE }),
    /Batch apply is disabled/i
  );
  assert.equal(listed, false);
});

test("apply patches only environment variables and verifies exact readback", async () => {
  const tool = managedTool();
  const client = mockClient([tool]);
  const report = await repairStatusCallbacks({
    client,
    apply: true,
    confirmation: CANARY_CONFIRMATION_PHRASE,
    canaryToolHash: shortHash(tool.id),
  });
  assert.equal(report.mode, "stage-canary-draft");
  assert.equal(report.publicationRequired, true);
  assert.equal(report.liveImpactConfirmed, false);
  assert.deepEqual(report.counts, {
    listed: 3,
    managed: 1,
    selected: 1,
    alreadyCorrect: 0,
    planned: 1,
    applied: 1,
    verified: 1,
    rolledBack: 0,
    failed: 0,
  });
  assert.equal(client.patchCalls.length, 1);
  const patchedEnvironment = client.patchCalls[0].environmentVariables;
  assert.equal(patchedEnvironment.find((entry) => entry.name === CALLBACK_ENV_NAME).value, CALLBACK_URL);
  assert.equal(patchedEnvironment.find((entry) => entry.name === "TWILIO_AUTH_TOKEN").value, "private-auth-token");
  const after = client.states.get(tool.id);
  const readback = inspectReadback(tool, after, patchedEnvironment);
  assert.equal(readback.ok, true);
  assert.equal(after.code, tool.code);
  assert.deepEqual(after.function, tool.function);
  assert.deepEqual(after.messages, tool.messages);
  assert.deepEqual(after.rejectionPlan, tool.rejectionPlan);
  assert.equal(after.timeoutSeconds, tool.timeoutSeconds);
  assert.notEqual(after.latestVersion, tool.latestVersion);
  assert.notEqual(after.updatedAt, tool.updatedAt);
});

test("semantic verification ignores server metadata but concurrency guard does not", () => {
  const original = managedTool("tool-versioned");
  const desiredEnvironment = replaceStatusCallback(original.environmentVariables);
  const readback = {
    ...original,
    updatedAt: "2026-08-28T12:00:00.000Z",
    latestVersion: "v99",
    environmentVariables: [...desiredEnvironment].reverse(),
  };
  assert.deepEqual(clientControlledProjection(readback), clientControlledProjection({
    ...original,
    environmentVariables: desiredEnvironment,
  }));
  assert.equal(inspectReadback(original, readback, desiredEnvironment).ok, true);
  assert.equal(inspectConcurrency(original, readback).ok, false);
  const timestampOnly = { ...original, updatedAt: "2026-08-28T13:00:00.000Z" };
  assert.equal(inspectConcurrency(original, timestampOnly).checks.updatedAtUnchanged, false);
  assert.equal(inspectConcurrency(original, timestampOnly).checks.latestVersionUnchanged, true);
});

test("rollback verification requires the exact original callback state", () => {
  const original = managedTool("tool-original-callback", "https://old.example.test/status");
  const restored = {
    ...clone(original),
    updatedAt: "2026-08-28T12:00:00.000Z",
    latestVersion: "v5",
  };
  assert.equal(inspectRollbackReadback(original, restored).ok, true);
  restored.environmentVariables = restored.environmentVariables.map((entry) => entry.name === CALLBACK_ENV_NAME
    ? { ...entry, value: "" }
    : entry);
  assert.equal(inspectRollbackReadback(original, restored).checks.originalCallbackExact, false);

  const originalEmpty = managedTool("tool-original-empty");
  originalEmpty.environmentVariables.push({ name: CALLBACK_ENV_NAME, value: "" });
  const restoredEmpty = { ...clone(originalEmpty), latestVersion: "v8", updatedAt: "2026-08-28T14:00:00.000Z" };
  assert.equal(inspectRollbackReadback(originalEmpty, restoredEmpty).ok, true);
});

test("an already-correct tool is verified without any write", async () => {
  const client = mockClient([managedTool("tool-correct", CALLBACK_URL)]);
  const report = await repairStatusCallbacks({
    client,
    apply: true,
    confirmation: CANARY_CONFIRMATION_PHRASE,
    canaryToolHash: shortHash("tool-correct"),
  });
  assert.equal(report.counts.alreadyCorrect, 1);
  assert.equal(report.counts.planned, 0);
  assert.equal(client.patchCalls.length, 0);
});

test("unexpected readback mutation fails and restores the original environment", async () => {
  const tool = managedTool("tool-readback");
  let injected = false;
  const client = mockClient([tool], {
    readbackTransform(value, state) {
      if (!injected && state.patchCount === 1) {
        injected = true;
        return { ...value, code: "unexpected mutation" };
      }
      return value;
    },
  });
  let caught;
  try {
    await repairStatusCallbacks({
      client,
      apply: true,
      confirmation: CANARY_CONFIRMATION_PHRASE,
      canaryToolHash: shortHash(tool.id),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.safeReport.mode, "stage-canary-draft-failed");
  assert.equal(caught.safeReport.publicationRequired, true);
  assert.equal(caught.safeReport.liveImpactConfirmed, false);
  assert.equal(caught.safeReport.counts.rolledBack, 1);
  assert.equal(caught.safeReport.counts.failed, 1);
  assert.deepEqual(client.states.get(tool.id).environmentVariables, tool.environmentVariables);
  assert.doesNotMatch(JSON.stringify(caught.safeReport), /tool-readback|private-auth-token|9055551234/);
});

test("batch apply remains refused with multiple managed tools and performs no writes", async () => {
  const first = managedTool("tool-first");
  const second = managedTool("tool-second");
  second.function.name = "send_call_summaries_5678_cafebabe_v2";
  const client = mockClient([first, second]);
  await assert.rejects(
    repairStatusCallbacks({ client, apply: true, confirmation: CONFIRMATION_PHRASE }),
    /Batch apply is disabled/i
  );
  assert.equal(client.patchCalls.length, 0);
});

test("just-in-time version guard blocks a stale write without attempting rollback", async () => {
  const tool = managedTool("tool-concurrent");
  const client = mockClient([tool], {
    readbackTransform(value, state) {
      if (state.getCount === 2 && state.patchCount === 0) {
        return { ...value, latestVersion: "v-concurrent" };
      }
      return value;
    },
  });
  let caught;
  try {
    await repairStatusCallbacks({
      client,
      apply: true,
      confirmation: CANARY_CONFIRMATION_PHRASE,
      canaryToolHash: shortHash(tool.id),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.safeReport.counts.applied, 0);
  assert.equal(caught.safeReport.counts.rolledBack, 0);
  assert.equal(caught.safeReport.counts.failed, 1);
  assert.equal(client.patchCalls.length, 0);
});

test("single-tool canary requires its own confirmation and updates only the selected hash", async () => {
  const first = managedTool("tool-canary-first");
  const second = managedTool("tool-canary-second");
  second.function.name = "send_call_summaries_5678_cafebabe_v2";
  const targetHash = shortHash(second.id);
  const rejectedClient = mockClient([first, second]);
  await assert.rejects(
    repairStatusCallbacks({
      client: rejectedClient,
      apply: true,
      confirmation: CONFIRMATION_PHRASE,
      canaryToolHash: targetHash,
    }),
    new RegExp(CANARY_CONFIRMATION_PHRASE)
  );
  assert.equal(rejectedClient.patchCalls.length, 0);

  const client = mockClient([first, second]);
  const report = await repairStatusCallbacks({
    client,
    apply: true,
    confirmation: CANARY_CONFIRMATION_PHRASE,
    canaryToolHash: targetHash,
  });
  assert.equal(report.mode, "stage-canary-draft");
  assert.equal(report.publicationRequired, true);
  assert.equal(report.liveImpactConfirmed, false);
  assert.equal(report.counts.managed, 2);
  assert.equal(report.counts.selected, 1);
  assert.equal(report.counts.applied, 1);
  assert.deepEqual(report.selectedToolHashes, [targetHash]);
  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].id, second.id);
  assert.doesNotMatch(JSON.stringify(report), /tool-canary|send_call_summaries/);
});

test("invalid canary hashes fail before inventory access", async () => {
  let listed = false;
  const client = {
    async listTools() { listed = true; return []; },
    async getTool() {},
    async patchToolEnvironment() {},
  };
  await assert.rejects(
    repairStatusCallbacks({
      client,
      apply: true,
      confirmation: CANARY_CONFIRMATION_PHRASE,
      canaryToolHash: "not-a-hash",
    }),
    /12-character tool hash/i
  );
  assert.equal(listed, false);
});

test("Vapi client sends an environment-only PATCH and never includes provider response text in errors", async () => {
  const calls = [];
  const client = createVapiClient({
    apiKey: "private-vapi-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() { return "{}"; },
      };
    },
  });
  await client.patchToolEnvironment("tool-secret-id", [{ name: CALLBACK_ENV_NAME, value: CALLBACK_URL }]);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    environmentVariables: [{ name: CALLBACK_ENV_NAME, value: CALLBACK_URL }],
  });
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)), ["environmentVariables"]);

  const failing = createVapiClient({
    apiKey: "private-vapi-key",
    fetchImpl: async () => ({
      ok: false,
      status: 402,
      async text() { return JSON.stringify({ message: "private billing body" }); },
    }),
  });
  await assert.rejects(
    failing.getTool("tool-secret-id"),
    (error) => error.message === "Vapi tool readback failed with HTTP 402."
  );
});

test("argument parser rejects unsupported switches", () => {
  assert.deepEqual(parseArgs([]), { apply: false, confirmation: "", canaryToolHash: "" });
  assert.deepEqual(parseArgs(["--apply", `--confirm=${CONFIRMATION_PHRASE}`]), {
    apply: true,
    confirmation: CONFIRMATION_PHRASE,
    canaryToolHash: "",
  });
  assert.deepEqual(parseArgs([
    "--apply",
    `--canary-tool-hash=${"a".repeat(12)}`,
    `--confirm=${CANARY_CONFIRMATION_PHRASE}`,
  ]), {
    apply: true,
    confirmation: CANARY_CONFIRMATION_PHRASE,
    canaryToolHash: "a".repeat(12),
  });
  assert.throws(() => parseArgs(["--callback=https://evil.example"]), /unsupported/i);
  assert.throws(() => parseArgs(["--apply", "--apply"]), /duplicate/i);
});
