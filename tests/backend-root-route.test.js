const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBackendRootPage } = require("../server/backendRootPage");

test("backend root explains the service instead of returning Cannot GET", () => {
  const body = buildBackendRootPage();
  assert.match(body, /My AI PA service is online/i);
  assert.match(body, /secure backend and Stripe integration/i);
  assert.match(body, /https:\/\/www\.myaipa\.ca\//i);
  assert.doesNotMatch(body, /Cannot GET/i);
});
