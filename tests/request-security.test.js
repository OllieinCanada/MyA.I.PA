const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const express = require('express');
const Stripe = require('stripe');
const { rejectCompressedRequests } = require('../server/requestSecurity');

let server, base;
const stripe = new Stripe('sk_test_fixture_not_a_credential');
const signingSecret = 'fixture-stripe-signature-secret';
before(async () => {
  const app = express();
  app.use(rejectCompressedRequests);
  app.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    try { stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], signingSecret); res.sendStatus(204); }
    catch (_) { res.sendStatus(400); }
  });
  app.use(express.json({ limit: '8kb' }));
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.post('/json', (req, res) => res.json(req.body));
  app.post('/form', (req, res) => res.json(req.body));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('compression guard is mounted before the real Stripe raw-body parser', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.ok(source.indexOf('app.use(rejectCompressedRequests)') >= 0);
  assert.ok(source.indexOf('app.use(rejectCompressedRequests)') < source.indexOf('express.raw('));
});

test('compressed, malformed and trailing-byte bodies are rejected without killing the server', async () => {
  const body = Buffer.concat([zlib.gzipSync(Buffer.from('{"fixture":true}')), Buffer.from('invalid-tail')]);
  for (const encoding of ['gzip', 'br', 'deflate', 'gzip, identity', 'unknown']) {
    for (const route of ['/json', '/stripe', '/not-a-route']) {
      const response = await fetch(base + route, { method: 'POST', headers: {
        'content-type': 'application/json', 'content-encoding': encoding,
      }, body });
      assert.equal(response.status, 415);
      assert.equal((await response.json()).code, 'REQUEST_CONTENT_ENCODING_UNSUPPORTED');
      assert.equal((await fetch(base + '/health')).status, 200);
    }
  }
});

test('ordinary JSON, form callbacks and identity encoding still parse correctly', async () => {
  const json = await fetch(base + '/json', { method: 'POST', headers: {
    'content-type': 'application/json', 'content-encoding': 'identity',
  }, body: '{"fixture":true}' });
  assert.deepEqual(await json.json(), { fixture: true });
  const form = await fetch(base + '/form', { method: 'POST', headers: {
    'content-type': 'application/x-www-form-urlencoded',
  }, body: 'MessageStatus=delivered' });
  assert.deepEqual(await form.json(), { MessageStatus: 'delivered' });
});

test('uncompressed Stripe signature verification uses exactly the original bytes', async () => {
  const payload = '{ "id": "evt_fixture", "type": "fixture.event", "data": {} }';
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret });
  const response = await fetch(base + '/stripe', { method: 'POST', headers: {
    'content-type': 'application/json', 'stripe-signature': signature,
  }, body: payload });
  assert.equal(response.status, 204);
});
