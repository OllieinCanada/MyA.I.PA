// Fixed synthetic dependency probes. No credentials, provider URLs or external listeners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

function loadPackage(filename, name, version) {
  assert.ok(path.isAbsolute(filename));
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), 'package.json'), 'utf8'));
  assert.equal(metadata.name, name); assert.equal(metadata.version, version);
  return require(filename);
}

function braceProbe(filename, version) {
  const expand = loadPackage(filename, 'brace-expansion', version);
  assert.deepEqual(expand('job-{east,west}-{1..2}'), ['job-east-1', 'job-east-2', 'job-west-1', 'job-west-2']);
  assert.deepEqual(expand('job-\\{a,b\\}'), ['job-{a,b}']);
  // A tiny negative control fails older releases before larger finite probes.
  const short = expand('prefix-{a,b}', { max: 4, maxLength: 3 });
  assert.ok(short.reduce((sum, item) => sum + item.length, 0) <= 3, 'maxLength must bound total output');
  for (const pattern of ['{a,b}'.repeat(30), '{'.repeat(4000) + 'a,b' + '}'.repeat(4000),
    '{' + '{a,b}'.repeat(900) + ',z}', '{a}' + '}'.repeat(4000) + ',b}']) {
    const result = expand(pattern, { max: 4, maxLength: 32768, maxDepth: 8, maxRewrites: 8 });
    assert.ok(Array.isArray(result)); assert.ok(result.length <= 4);
    assert.ok(result.reduce((sum, item) => sum + item.length, 0) <= 32768);
  }
  return { family: 'brace-expansion', version, checks: 7, syntheticOnly: true };
}

async function redirectProbe(filename, version, scenario) {
  const redirects = loadPackage(filename, 'follow-redirects', version);
  assert.ok(['same-origin', 'object', 'array', 'cross-realm-object', 'cross-realm-array', 'post', 'limit'].includes(scenario));
  const servers = [];
  async function listen(handler) {
    const server = http.createServer(handler); servers.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return server;
  }
  const respond = (request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => response.end(JSON.stringify({ headers: request.headers, method: request.method, body })));
  };
  try {
    const target = await listen(respond), targetUrl = 'http://127.0.0.1:' + target.address().port + '/received';
    const origin = await listen((request, response) => {
      if (scenario === 'same-origin' && request.url === '/received') return respond(request, response);
      response.writeHead(302, { Location: scenario === 'limit' ? '/start' : scenario === 'same-origin' ? '/received' : targetUrl });
      response.end();
    });
    const headers = { Host: '127.0.0.1:' + origin.address().port, Authorization: 'SYNTHETIC_AUTH', Cookie: 'synthetic-cookie', 'Proxy-Authorization': 'SYNTHETIC_PROXY',
      'X-Private-Token': 'SYNTHETIC_PRIVATE', 'X-Private^Token': 'SYNTHETIC_PRIVATE_A', 'X-Private|Token': 'SYNTHETIC_PRIVATE_B', 'X-Trace-Fixture': 'keep' };
    if (scenario === 'post') { headers['Content-Length'] = '7'; headers['Content-Type'] = 'text/plain'; }
    const arrayHeaders = ['array', 'cross-realm-array', 'post'].includes(scenario);
    const sensitiveHeaders = scenario.startsWith('cross-realm')
      ? vm.runInNewContext("['X-Private-Token', 'X-Private^Token', 'X-Private|Token']")
      : ['X-Private-Token', 'X-Private^Token', 'X-Private|Token'];
    if (scenario.startsWith('cross-realm')) { assert.equal(Array.isArray(sensitiveHeaders), true); assert.equal(sensitiveHeaders instanceof Array, false); }
    const options = { method: scenario === 'post' ? 'POST' : 'GET', maxRedirects: scenario === 'limit' ? 1 : 3,
      sensitiveHeaders, headers: arrayHeaders ? Object.entries(headers).flat() : headers };
    const getResult = () => new Promise((resolve, reject) => {
      const request = redirects.http.request('http://127.0.0.1:' + origin.address().port + '/start', options, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(Error('Synthetic response limit')); });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        response.on('error', reject);
      });
      request.on('error', reject); request.setTimeout(2000, () => request.destroy(Error('Synthetic loopback timeout')));
      request.end(scenario === 'post' ? 'fixture' : undefined);
    });
    if (scenario === 'limit') await assert.rejects(getResult(), error => error.code === 'ERR_FR_TOO_MANY_REDIRECTS');
    else {
      const result = await getResult();
      if (scenario === 'same-origin') {
        for (const name of ['Authorization', 'Proxy-Authorization', 'Cookie', 'X-Private-Token', 'X-Private^Token', 'X-Private|Token']) {
          assert.equal(result.headers[name.toLowerCase()], headers[name], 'same-origin credentials must be preserved: ' + name);
        }
      } else {
        for (const name of ['authorization', 'proxy-authorization', 'cookie', 'x-private-token', 'x-private^token', 'x-private|token']) {
          assert.equal(result.headers[name], undefined, 'cross-origin credentials must be stripped: ' + name);
        }
        assert.equal(result.headers.host, '127.0.0.1:' + target.address().port);
      }
      assert.equal(result.headers['x-trace-fixture'], 'keep');
      if (scenario === 'post') {
        assert.equal(result.method, 'GET'); assert.equal(result.body, '');
        assert.equal(result.headers['content-length'], undefined); assert.equal(result.headers['content-type'], undefined);
      }
    }
    return { family: 'follow-redirects', version, scenario, loopbackOnly: true, realCredentials: false };
  } finally {
    for (const server of servers) server.closeAllConnections?.();
    await Promise.all(servers.map(server => server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve()));
  }
}

if (require.main === module) {
  const [kind, filename, version, scenario] = process.argv.slice(2);
  Promise.resolve().then(() => kind === 'brace' ? braceProbe(filename, version)
    : kind === 'redirect' ? redirectProbe(filename, version, scenario) : assert.fail('Unknown synthetic probe'))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { braceProbe, redirectProbe };
