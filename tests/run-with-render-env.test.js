const assert = require("assert");
const test = require("node:test");

const {
  envValue,
  fetchRenderEnv,
  isUsableSecret,
  parseArgs,
  stripYamlValue,
} = require("../scripts/run-with-render-env");

test("parses required and optional Render env keys without including the child command", () => {
  const { options, commandArgs } = parseArgs([
    "--keys=VAPI_API_KEY,TWILIO_AUTH_TOKEN",
    "--optional-keys",
    "TWILIO_API_KEY_SID",
    "--",
    "node",
    "scripts/audit-vapi-2026-readiness.js",
  ]);

  assert.deepEqual(options.keys, ["VAPI_API_KEY", "TWILIO_AUTH_TOKEN"]);
  assert.deepEqual(options.optionalKeys, ["TWILIO_API_KEY_SID"]);
  assert.deepEqual(commandArgs, ["node", "scripts/audit-vapi-2026-readiness.js"]);
});

test("recognizes redacted or placeholder values as unusable", () => {
  assert.equal(isUsableSecret("real-value"), true);
  assert.equal(isUsableSecret("[redacted]"), false);
  assert.equal(isUsableSecret("******"), false);
  assert.equal(isUsableSecret("change-me"), false);
  assert.equal(isUsableSecret(""), false);
});

test("fetches only selected Render env vars and never returns missing optional values", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const key = decodeURIComponent(url.split("/").at(-1));
    const values = {
      REQUIRED_ONE: { envVar: { value: "required-secret" } },
      OPTIONAL_ONE: { value: "optional-secret" },
      OPTIONAL_MISSING: { value: "" },
    };
    return {
      ok: Boolean(values[key]),
      status: values[key] ? 200 : 404,
      json: async () => values[key] || null,
    };
  };

  const env = await fetchRenderEnv({
    serviceId: "srv-test",
    keys: ["REQUIRED_ONE"],
    optionalKeys: ["OPTIONAL_ONE", "OPTIONAL_MISSING"],
    credentials: { host: "https://api.render.com/v1", key: "render-secret" },
    fetchImpl,
  });

  assert.equal(requested.length, 3);
  assert.deepEqual(env, {
    REQUIRED_ONE: "required-secret",
    OPTIONAL_ONE: "optional-secret",
  });
});

test("normalizes quoted YAML values and Render env payload shapes", () => {
  assert.equal(stripYamlValue("'abc'"), "abc");
  assert.equal(stripYamlValue('"abc"'), "abc");
  assert.equal(envValue({ envVar: { value: "nested" } }), "nested");
  assert.equal(envValue({ value: "flat" }), "flat");
});
