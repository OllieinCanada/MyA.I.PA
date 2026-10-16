const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchProviderReadText } = require("../server/providerRead");
test("retries a read interrupted during body consumption", async () => {
  let calls = 0;
  const result = await fetchProviderReadText("https://example.com", {}, {
    sleep: async () => {}, fetchImpl: async () => ({ text: async () => {
      if (++calls === 1) throw new TypeError("terminated", { cause: { code: "ECONNRESET" } });
      return "[]";
    } })
  });
  assert.equal(result.text, "[]");assert.equal(calls, 2);
});
test("persistent failure stops after three reads", async () => {
  let calls = 0;
  await assert.rejects(fetchProviderReadText("https://example.com", {}, {
    sleep: async () => {}, fetchImpl: async () => { calls++;throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); }
  }));
  assert.equal(calls, 3);
});
test("never retries mutations or unknown implementation failures", async () => {
  let calls = 0;const fetchImpl = async () => { calls++;throw new Error("bug"); };
  await assert.rejects(fetchProviderReadText("https://example.com", { method: "POST" }, { fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(fetchProviderReadText("https://example.com", {}, { fetchImpl }));
  assert.equal(calls, 1);
});

const reply = (status, text = String(status), retryAfter) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: name => name === 'retry-after' ? retryAfter : null },
  text: async () => text,
});

test('retries a temporary Vapi HTTP 500 on the same GET and returns its recovered body', async () => {
  const requests = [], waits = [];
  const options = { headers: { Authorization: 'Bearer test-only' } };
  const result = await fetchProviderReadText('https://api.vapi.ai/call/test-only', options, {
    sleep: async ms => { waits.push(ms); },
    fetchImpl: async (url, request) => {
      requests.push({ url, headers: request.headers, method: request.method });
      return requests.length === 1 ? reply(500, '{"error":"temporary"}') : reply(200, '{"id":"test-only"}');
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.text, '{"id":"test-only"}');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(waits, [250]);
});

test('persistent transient HTTP failures stop after three reads and preserve the final provider response', async () => {
  for (const status of [500, 502, 503, 504]) {
    let calls = 0;
    const waits = [];
    const last = reply(status, 'final provider error');
    const result = await fetchProviderReadText('https://example.com/read', {}, {
      sleep: async ms => { waits.push(ms); },
      fetchImpl: async () => { calls++; return calls === 3 ? last : reply(status, 'earlier error'); },
    });
    assert.equal(calls, 3);
    assert.equal(result.response, last);
    assert.equal(result.text, 'final provider error');
    assert.deepEqual(waits, [250, 500]);
  }
});

test('authentication, missing resources, rate limits, and non-transient HTTP errors are not blindly retried', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 501]) {
    let calls = 0;
    const result = await fetchProviderReadText('https://example.com/read', {}, {
      sleep: async () => { assert.fail('Unexpected retry'); },
      fetchImpl: async () => { calls++; return reply(status); },
    });
    assert.equal(calls, 1);
    assert.equal(result.response.status, status);
  }
});

test('network failures and server errors share the same three-read budget', async () => {
  let calls = 0;
  const result = await fetchProviderReadText('https://example.com/read', {}, {
    sleep: async () => {}, fetchImpl: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return reply(503, 'still unavailable');
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.response.status, 503);
});

test('honours bounded Retry-After seconds and dates, but defers long cooldowns without retrying early', async () => {
  const time = Date.parse('2026-10-16T16:00:00Z');
  for (const value of ['2', new Date(time + 2000).toUTCString()]) {
    const waits = []; let calls = 0;
    await fetchProviderReadText('https://example.com/read', {}, {
      now: () => time, sleep: async ms => { waits.push(ms); },
      fetchImpl: async () => ++calls === 1 ? reply(503, 'busy', value) : reply(200),
    });
    assert.deepEqual(waits, [2000]);
  }
  let calls = 0;
  const result = await fetchProviderReadText('https://example.com/read', {}, {
    sleep: async () => assert.fail('Must not sleep through a long cooldown'),
    fetchImpl: async () => { calls++; return reply(503, 'busy', '120'); },
  });
  assert.equal(calls, 1);
  assert.equal(result.response.status, 503);
});

test('all mutation methods are rejected before any HTTP request', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    await assert.rejects(fetchProviderReadText('https://example.com/read', { method }, {
      fetchImpl: async () => assert.fail('Mutation reached provider'),
    }), /body-free GET/);
  }
});

test('actual Vapi call-list and call-detail readers use HTTP retries and retain final rejection details', async () => {
  const source = require('node:fs').readFileSync(require.resolve('../server/index'), 'utf8');
  const vm = require('node:vm');
  for (const name of ['fetchVapiCalls', 'fetchVapiCallDetail']) {
    const start = source.indexOf(`async function ${name}(`), end = source.indexOf('\nasync function ', start + 1);
    let calls = 0;
    let failing = false;
    const fetchImpl = async () => {
      calls++;
      return failing || calls === 1 ? reply(500, '{"message":"provider failure detail"}')
        : reply(200, name === 'fetchVapiCalls' ? '[]' : '{"id":"test-only"}');
    };
    const context = { URL, VAPI_CALL_LIMIT: 50, VAPI_API_KEY: 'fixture', VAPI_API_BASE_URL: 'https://fixture.invalid',
      parseJsonObject: JSON.parse,
      createProviderHttpError: ({ status, data }) => Object.assign(new Error(data.message), { providerStatus: status }),
      fetchProviderReadText: (url, options) => fetchProviderReadText(url, options, { fetchImpl, sleep: async () => {} }),
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}; this.subject = ${name};`, context);
    await context.subject(name === 'fetchVapiCalls' ? {} : 'test-only');
    assert.equal(calls, 2);
    calls = 0; failing = true;
    await assert.rejects(context.subject(name === 'fetchVapiCalls' ? {} : 'test-only'), error => error.providerStatus === 500 && error.message === 'provider failure detail');
    assert.equal(calls, 3);
  }
});
