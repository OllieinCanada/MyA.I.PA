const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const lanes = [
  { consumer: 'minimatch', location: 'node_modules/brace-expansion', version: '1.1.21', key: 'brace-expansion@^1.0.0' },
  { consumer: 'filelist/node_modules/minimatch', location: 'node_modules/filelist/node_modules/brace-expansion', version: '2.1.7', key: 'brace-expansion@^2.0.0' },
];

function consumerRequire(consumer) { return createRequire(path.join(ROOT, 'node_modules', consumer, 'package.json')); }
function isolated(kind, filename, version, scenario) {
  const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.NODE_OPTIONS = '--max-old-space-size=32';
  const result = spawnSync(process.execPath, ['--max-old-space-size=32', path.join(__dirname, 'helpers/development-security-patch-probe.js'),
    kind, filename, version, scenario || ''], { env, windowsHide: true, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined, 'bounded synthetic process must finish');
  assert.equal(result.status, 0, result.stderr || 'synthetic process failed');
  return JSON.parse(result.stdout);
}

test('compatible security pins preserve distinct brace majors and all previously approved fixes', () => {
  assert.equal(manifest.overrides['brace-expansion'], undefined, 'do not collapse mixed majors globally');
  for (const lane of lanes) {
    assert.equal(manifest.overrides[lane.key], lane.version);
    assert.equal(lock.packages[lane.location].version, lane.version);
    assert.equal(consumerRequire(lane.consumer)('brace-expansion/package.json').version, lane.version);
  }
  assert.equal(manifest.overrides['follow-redirects'], '1.16.2');
  assert.equal(lock.packages['node_modules/follow-redirects'].version, '1.16.2');
  assert.equal(require('follow-redirects/package.json').version, '1.16.2');
  assert.equal(manifest.overrides['fast-uri'], '3.1.9');
  assert.equal(lock.packages['node_modules/fast-uri'].version, '3.1.9');
  assert.equal(manifest.overrides['shell-quote'], '1.11.0');
  assert.equal(lock.packages['node_modules/shell-quote'].version, '1.11.0');
});

for (const lane of lanes) {
  test(`${lane.consumer} retains brace expansion with finite output/depth/rewrite controls`, () => {
    const local = consumerRequire(lane.consumer);
    assert.equal(isolated('brace', local.resolve('brace-expansion'), lane.version).checks, 7);
  });
  test(`${lane.consumer} still matches ordinary brace and glob patterns`, () => {
    const minimatch = consumerRequire(lane.consumer)('./');
    assert.equal(typeof minimatch, 'function');
    assert.equal(minimatch('job-east-2.txt', 'job-{east,west}-[1-3].txt'), true);
    assert.equal(minimatch('job-north-2.txt', 'job-{east,west}-[1-3].txt'), false);
    assert.equal(minimatch('dir/job.txt', 'dir/**/*.txt'), true);
  });
}

for (const scenario of ['same-origin', 'object', 'array', 'cross-realm-object', 'cross-realm-array', 'post', 'limit']) {
  test(`follow-redirects preserves safe loopback behavior: ${scenario}`, () => {
    const result = isolated('redirect', require.resolve('follow-redirects'), '1.16.2', scenario);
    assert.equal(result.loopbackOnly, true); assert.equal(result.realCredentials, false);
  });
}
