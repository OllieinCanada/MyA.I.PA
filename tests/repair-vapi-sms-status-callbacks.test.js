const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CALLBACK_ENV_NAME,
  CALLBACK_URL,
  CONFIRMATION_PHRASE,
  createVapiClient,
  inspectReadback,
  isManagedSummaryTool,
  parseArgs,
  repairStatusCallbacks,
  replaceStatusCallback,
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
  assert.equal(report.counts.planned, 1);
  assert.equal(client.patchCalls.length, 0);
  assert.doesNotMatch(serialized, /tool-sensitive|send_call_summaries|private-auth-token|9055551234|AC-not-for-output/);
  assert.deepEqual(Object.keys(report).sort(), [
    "appliedToolHashes",
    "beforeConfigurationHashes",
    "callbackUrlHash",
    "counts",
    "desiredConfigurationHashes",
    "failedToolHashes",
    "managedToolHashes",
    "mode",
    "plannedToolHashes",
    "rolledBackToolHashes",
    "verifiedToolHashes",
  ].sort());
});

test("apply requires the exact confirmation before making a network call", async () => {
  let listed = false;
  const client = {
    async listTools() { listed = true; return []; },
    async getTool() {},
    async patchToolEnvironment() {},
  };
  await assert.rejects(
    repairStatusCallbacks({ client, apply: true, confirmation: "yes" }),
    new RegExp(CONFIRMATION_PHRASE)
  );
  assert.equal(listed, false);
});

test("apply patches only environment variables and verifies exact readback", async () => {
  const tool = managedTool();
  const client = mockClient([tool]);
  const report = await repairStatusCallbacks({
    client,
    apply: true,
    confirmation: CONFIRMATION_PHRASE,
  });
  assert.equal(report.mode, "apply");
  assert.deepEqual(report.counts, {
    listed: 3,
    managed: 1,
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
});

test("an already-correct tool is verified without any write", async () => {
  const client = mockClient([managedTool("tool-correct", CALLBACK_URL)]);
  const report = await repairStatusCallbacks({
    client,
    apply: true,
    confirmation: CONFIRMATION_PHRASE,
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
    await repairStatusCallbacks({ client, apply: true, confirmation: CONFIRMATION_PHRASE });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.safeReport.mode, "apply-failed");
  assert.equal(caught.safeReport.counts.rolledBack, 1);
  assert.equal(caught.safeReport.counts.failed, 1);
  assert.deepEqual(client.states.get(tool.id).environmentVariables, tool.environmentVariables);
  assert.doesNotMatch(JSON.stringify(caught.safeReport), /tool-readback|private-auth-token|9055551234/);
});

test("a mid-run write failure rolls back every attempted managed tool", async () => {
  const first = managedTool("tool-first");
  const second = managedTool("tool-second");
  second.function.name = "send_call_summaries_5678_cafebabe_v2";
  const client = mockClient([first, second], { failPatchAt: 2 });
  let caught;
  try {
    await repairStatusCallbacks({ client, apply: true, confirmation: CONFIRMATION_PHRASE });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.safeReport.counts.applied, 1);
  assert.equal(caught.safeReport.counts.rolledBack, 2);
  assert.equal(caught.safeReport.counts.failed, 1);
  assert.deepEqual(client.states.get(first.id).environmentVariables, first.environmentVariables);
  assert.deepEqual(client.states.get(second.id).environmentVariables, second.environmentVariables);
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
  assert.deepEqual(parseArgs([]), { apply: false, confirmation: "" });
  assert.deepEqual(parseArgs(["--apply", `--confirm=${CONFIRMATION_PHRASE}`]), {
    apply: true,
    confirmation: CONFIRMATION_PHRASE,
  });
  assert.throws(() => parseArgs(["--callback=https://evil.example"]), /unsupported/i);
});
