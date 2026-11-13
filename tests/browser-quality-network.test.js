const test = require('node:test');
const assert = require('node:assert/strict');
const { decision, installNetworkIsolation } = require('../scripts/browser-quality-network');
const local = 'http://127.0.0.1:4179';
test('only static loopback reads and explicitly allowed static assets can reach the network', () => {
  assert.equal(decision(local + '/static/main.js', 'GET', local), 'local_static');
  assert.equal(decision('https://fonts.googleapis.com/css2?family=Inter', 'GET', local), 'readonly_asset');
  assert.equal(decision('https://www.myaipa.ca/photo.png', 'POST', local), 'reject_write');
  assert.equal(decision('https://api.vapi.ai/call', 'POST', local), 'reject_write');
  assert.equal(decision('https://api.twilio.com/2010/Accounts', 'GET', local), 'offline_external');
});
test('all application writes are rejected regardless of origin except explicit local telemetry fixtures', () => {
  for (const origin of [local, 'https://api.myaipa.ca']) {
    assert.equal(decision(origin + '/api/integrations/signup-complete', 'POST', local), 'reject_write');
    assert.equal(decision(origin + '/api/payments/create-checkout-session', 'POST', local), 'reject_write');
    assert.equal(decision(origin + '/api/signup/form-observation', 'POST', local), 'observation_fixture');
    assert.equal(decision(origin + '/api/signup/form-observation/fd_fixture', 'PUT', local), 'observation_fixture');
    assert.equal(decision(origin + '/api/signup/form-observation/fd_fixture', 'DELETE', local), 'reject_write');
    assert.equal(decision(origin + '/api/client-errors', 'POST', local), 'client_error_fixture');
  }
  assert.equal(decision('https://unrecognized.invalid/api/signup/form-observation', 'POST', local), 'reject_write');
});
test('browser interception fulfills telemetry locally and blocks consequential requests before forwarding', async () => {
  let handle, socketHandler; const context = { route: async (_pattern, fn) => { handle = fn; },
    routeWebSocket: async (_pattern, fn) => { socketHandler = fn; } };
  const evidence = { unexpectedWrites: [], blockedSockets: 0 }; await installNetworkIsolation(context, local, evidence);
  let forwarded = 0, response;
  function route(url, method) { return { request: () => ({ url: () => url, method: () => method, headers: () => ({}),
    resourceType: () => 'fetch', postDataJSON: () => ({expectedRevision: 0, sequence: 1}) }),
    continue: () => { forwarded++; }, fulfill: value => { response = value; } }; }
  await handle(route('https://api.myaipa.ca/api/signup/form-observation', 'POST'));
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).offlineFixture, true); assert.equal(forwarded, 0);
  await handle(route('https://api.myaipa.ca/api/integrations/signup-complete', 'POST'));
  assert.equal(response.status, 403); assert.equal(forwarded, 0); assert.equal(evidence.unexpectedWrites.length, 1);
  let closed = false; socketHandler({close() {closed = true;}}); assert.equal(closed, true);
});
test('client error telemetry stays local and is expected only for the declared negative resource test', async () => {
  for (const expectedResourceFailure of [false, true]) {
    let handle, response;
    const context = { route: async (_pattern, fn) => { handle = fn; }, routeWebSocket: async () => {} };
    const evidence = { unexpectedWrites: [], blockedSockets: 0 };
    await installNetworkIsolation(context, local, evidence, { expectedResourceFailure });
    let type = 'resource_error';
    const route = { request: () => ({ url: () => 'https://api.myaipa.ca/api/client-errors', method: () => 'POST',
      headers: () => ({}), postDataJSON: () => ({ type, message: 'api_key=synthetic-private-value' }) }),
      continue: () => assert.fail('Telemetry must never reach production'), fulfill: value => { response = value; } };
    await handle(route); assert.equal(response.status, 202); assert.equal(JSON.parse(response.body).accepted, false);
    assert.equal(evidence.clientErrors[0].expectedNegativeTest, expectedResourceFailure);
    assert.ok(!evidence.clientErrors[0].message.includes('synthetic-private-value'));
    type = 'uncaught_error'; await handle(route); assert.equal(evidence.clientErrors[1].expectedNegativeTest, false);
  }
});
