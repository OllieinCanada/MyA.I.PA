const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INVENTORY_LIMIT,
  assistantReferences,
  auditToolPinning,
  createReadOnlyVapiClient,
  referenceKind,
} = require("../scripts/audit-vapi-sms-tool-pinning");

function managedTool(id) {
  return {
    id,
    type: "code",
    function: { name: `send_call_summaries_${id.slice(-4)}_deadbeef_v2` },
  };
}

test("classifies Latest/current/missing versions separately from numbered pins", () => {
  assert.equal(referenceKind(undefined), "latest");
  assert.equal(referenceKind("Latest"), "latest");
  assert.equal(referenceKind("current"), "latest");
  assert.equal(referenceKind("3"), "pinned");
});

test("collects legacy and version-aware references and rejects ambiguity", () => {
  assert.deepEqual(assistantReferences({
    model: {
      toolIds: ["tool-latest"],
      toolRefs: [{ toolId: "tool-pinned", version: "2" }],
    },
  }), [
    { toolId: "tool-latest", kind: "latest" },
    { toolId: "tool-pinned", kind: "pinned" },
  ]);
  assert.throws(() => assistantReferences({
    model: {
      toolIds: ["tool-1"],
      toolRefs: [{ toolId: "tool-1", version: "1" }],
    },
  }), /duplicate or ambiguous/i);
  assert.throws(() => assistantReferences({ model: { toolRefs: [{}] } }), /blank versioned/i);
});

test("returns only redacted hashes and exact pinning counts", () => {
  const report = auditToolPinning({
    toolPayload: [managedTool("managed-tool-1111"), managedTool("managed-tool-2222"), {
      id: "unrelated-tool-secret",
      type: "function",
      function: { name: "other_sensitive_tool" },
    }],
    assistantPayload: [
      { id: "assistant-private-one", model: { toolIds: ["managed-tool-1111"] } },
      { id: "assistant-private-two", model: { toolRefs: [{ toolId: "managed-tool-2222", version: "4" }] } },
      { id: "assistant-private-three", model: { toolIds: ["unrelated-tool-secret"] } },
    ],
  });
  assert.equal(report.mode, "read-only");
  assert.equal(report.liveConfigurationChanged, false);
  assert.equal(report.safeToPublishWithoutAssistantVersionChanges, false);
  assert.deepEqual(report.counts, {
    listedTools: 3,
    listedAssistants: 3,
    managedTools: 2,
    referencedManagedTools: 2,
    unreferencedManagedTools: 0,
    managedReferences: 2,
    latestReferences: 1,
    pinnedReferences: 1,
    assistantsReferencingManagedTools: 2,
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /managed-tool|assistant-private|unrelated-tool|other_sensitive/);
});

test("fails closed at inventory boundaries and on malformed identifiers", () => {
  assert.throws(() => auditToolPinning({
    toolPayload: Array.from({ length: INVENTORY_LIMIT }, (_, index) => ({ id: `tool-${index}` })),
    assistantPayload: [],
  }), /safety limit/i);
  assert.throws(() => auditToolPinning({
    toolPayload: [{ id: "same" }, { id: "same" }],
    assistantPayload: [],
  }), /duplicate identifiers/i);
  assert.throws(() => auditToolPinning({
    toolPayload: [],
    assistantPayload: [{ id: "assistant-1", model: { toolIds: "not-an-array" } }],
  }), /malformed toolIds/i);
});

test("HTTP client is GET-only and never includes provider response bodies in errors", async () => {
  const calls = [];
  const client = createReadOnlyVapiClient({
    apiKey: "private-key",
    apiBaseUrl: "https://vapi.example.test/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "provider-secret-body" }),
      };
    },
  });
  await assert.rejects(client.listTools(), (error) => {
    assert.match(error.message, /HTTP 503/);
    assert.doesNotMatch(error.message, /provider-secret-body/);
    return true;
  });
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
});
