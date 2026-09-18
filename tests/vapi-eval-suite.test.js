const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const suite = require("../config/vapi-agent-evals.json");
const { evalRunIdFromCreateResponse } = require("../scripts/setup-vapi-evals");

function byKey(key) {
  const value = suite.evals.find((item) => item.key === key);
  assert.ok(value, `Missing eval ${key}`);
  return value;
}

test("shipping Vapi suite contains 20 distinct safe conversation evaluations", () => {
  const keys = suite.evals.map((item) => item.key);
  const names = suite.evals.map((item) => item.name);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(names).size, names.length);
  assert.equal(suite.evals.filter((item) => item.safeToRun !== false).length, 20);
  assert.equal(suite.defaults.judgeModel, "gpt-4o");
  assert.equal(suite.targetAssistantIdDefault, "");
  assert.equal(suite.recommendedTargetPhoneLast4, "");
});

test("updated intake evaluations explicitly handle recording consent", () => {
  for (const key of [
    "positive-social-routing",
    "social-response-repair-routing",
    "pricing-boundary-before-intake",
    "installation-estimate-routing",
    "ev-installation-qualified-intake",
    "respectful-ai-disclosure",
    "commercial-downtime-priority",
  ]) {
    const messages = byKey(key).messages;
    assert.match(JSON.stringify(messages), /recorded|recording/i, key);
    if (key !== "social-response-repair-routing") {
      assert.ok(messages.some((message) => message.role === "user" && /yes|okay|consent/i.test(message.content || "")), key);
    }
  }
});

test("pricing boundary eval never tells the assistant to invent a dollar amount", () => {
  const evalText = JSON.stringify(byKey("pricing-boundary-before-intake"));
  assert.doesNotMatch(evalText, /\$\s*\d/);
  assert.match(evalText, /does not invent or promise a price/i);
});

test("commercial downtime eval enforces one question and no arrival guarantee", () => {
  const evalText = JSON.stringify(byKey("commercial-downtime-priority"));
  assert.match(evalText, /no more than one concise next question/i);
  assert.match(evalText, /does not guarantee/i);
});

test("Vapi create-run responses use the returned evalRunId instead of a recent cached run", () => {
  assert.equal(evalRunIdFromCreateResponse({ evalRunId: "fresh-run" }), "fresh-run");
  assert.equal(evalRunIdFromCreateResponse({ runId: "legacy-run" }), "legacy-run");
});

test("local evaluation previews work without a target but live sync remains blocked", () => {
  const script = path.resolve(__dirname, "../scripts/setup-vapi-evals.js");
  const env = {
    ...process.env,
    VAPI_EVAL_TARGET_ASSISTANT_ID: "",
    VAPI_EVAL_TARGET_PHONE: "",
    VAPI_EVAL_SUITE_FILE: path.resolve(__dirname, "../config/vapi-agent-evals.json"),
    VAPI_API_KEY: "",
  };
  for (const flag of ["--dry-run", "--list"]) {
    const result = spawnSync(process.execPath, [script, flag], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not selected \(required before live evaluation\)/);
    assert.match(result.stdout, /MyAIPA Vapi Regression Suite/);
  }
  const live = spawnSync(process.execPath, [script, "--sync"], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(live.status, 1);
  assert.match(live.stderr, /Set VAPI_EVAL_TARGET_ASSISTANT_ID/);
});
