const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRuntimeIncident,
  notifyRuntimeIncident,
  resetRuntimeAlertDedupeForTests,
  safeRuntimePath,
} = require("../server/runtimeAlerts");

test("runtime incident snapshot omits query strings and redacts unsafe error details", () => {
  const incident = buildRuntimeIncident(
    new Error("Request for private@example.com at +1 905-555-0123 failed with token=secret-value"),
    {
      area: "signup request",
      method: "POST",
      path: "/api/signup/12345678901234567890?token=secret-value",
      status: 500,
    }
  );
  const serialized = JSON.stringify(incident);
  assert.equal(safeRuntimePath("/api/calls/12345?token=abc"), "/api/calls/:id");
  assert.doesNotMatch(serialized, /private@example\.com|905-555-0123|secret-value/);
  assert.match(incident.reason, /root cause is not yet independently confirmed/i);
});

test("runtime alerts deduplicate the same failure without hiding a different route", async () => {
  resetRuntimeAlertDedupeForTests();
  const calls = [];
  const options = {
    token: "test-token",
    chatId: "test-chat",
    now: 100_000,
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  const first = await notifyRuntimeIncident(Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" }), {
    area: "customer dashboard",
    method: "GET",
    path: "/api/customer/dashboard",
    adminUrl: "https://www.myaipa.ca/#/admin?tab=attention",
  }, options);
  const duplicate = await notifyRuntimeIncident(Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" }), {
    area: "customer dashboard",
    method: "GET",
    path: "/api/customer/dashboard",
  }, options);
  const different = await notifyRuntimeIncident(Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" }), {
    area: "customer dashboard",
    method: "GET",
    path: "/api/customer/calls",
  }, options);

  assert.equal(first.sent, true);
  assert.equal(duplicate.reason, "duplicate_incident");
  assert.equal(different.sent, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /WHAT FAILED/);
});

test("different exceptions on the same route do not suppress one another", async () => {
  resetRuntimeAlertDedupeForTests();
  const calls = [];
  const options = {
    token: "test-token",
    chatId: "test-chat",
    now: 200_000,
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  const context = { area: "signup request", method: "POST", path: "/api/signup", status: 500 };
  const first = await notifyRuntimeIncident(new Error("Database connection failed"), context, options);
  const second = await notifyRuntimeIncident(new Error("Email provider failed"), context, options);
  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(calls.length, 2);
});
