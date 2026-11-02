const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configureBrowserCache, canonicalLaunchOptions, initializePlaywright } = require('../scripts/playwright-paths');

const cache = 'C:\\Users\\Fixture\\AppData\\Local\\ms-playwright';
const target = 'D:\\fixture-cache\\playwright';
function options(env = {}) { return { env: { LOCALAPPDATA: 'C:\\Users\\Fixture\\AppData\\Local', ...env }, platform: 'win32', cwd: 'C:\\fixture', realpath: () => target }; }
function absent() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }

test('resolves the default Windows cache junction before Playwright is loaded', () => {
  const configuration = options();
  const browser = { launch() { return this; } };
  const runtime = initializePlaywright({ ...configuration, load() {
    assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, target);
    return { chromium: browser, firefox: browser, webkit: browser, devices: { fixture: true } };
  } });
  assert.deepEqual(runtime.devices, { fixture: true });
});
test('resolves an explicitly configured C cache without changing the original object elsewhere', () => {
  const configuration = options({ PLAYWRIGHT_BROWSERS_PATH: cache });
  assert.deepEqual(configureBrowserCache(configuration), { changed: true, original: cache, resolved: target });
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, target);
});
test('relative cache paths use INIT_CWD like Playwright', () => {
  const configuration = options({ PLAYWRIGHT_BROWSERS_PATH: '.browser-cache', INIT_CWD: 'C:\\initial' });
  configuration.realpath = value => { assert.equal(value, 'C:\\initial\\.browser-cache'); return target; };
  configureBrowserCache(configuration);
});
test('an ordinary existing Windows cache does not introduce an environment override', () => {
  const configuration = options(); configuration.realpath = value => value;
  assert.equal(configureBrowserCache(configuration).changed, false);
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, undefined);
});
test('case-only path differences do not introduce an override', () => {
  const configuration = options(); configuration.realpath = value => value.toUpperCase();
  assert.equal(configureBrowserCache(configuration).changed, false);
});
test('non-Windows cache configuration is untouched', () => {
  const configuration = options({ PLAYWRIGHT_BROWSERS_PATH: '/fixture/cache' });
  configuration.platform = 'linux'; configuration.realpath = () => assert.fail('unexpected filesystem operation');
  assert.deepEqual(configureBrowserCache(configuration), { changed: false });
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, '/fixture/cache');
});
test('the hermetic PLAYWRIGHT_BROWSERS_PATH=0 setting is preserved', () => {
  const configuration = options({ PLAYWRIGHT_BROWSERS_PATH: '0' });
  configuration.realpath = () => assert.fail('unexpected filesystem operation');
  assert.deepEqual(configureBrowserCache(configuration), { changed: false });
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, '0');
});
test('a missing ordinary cache is not created or redirected', () => {
  const configuration = { ...options(), realpath: absent, lstat: absent };
  assert.deepEqual(configureBrowserCache(configuration), { changed: false, original: cache, missing: true });
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, undefined);
});
test('a disconnected junction fails clearly rather than recreating C files', () => {
  const configuration = { ...options(), realpath: absent, lstat: () => ({ isSymbolicLink: () => true }) };
  assert.throws(() => configureBrowserCache(configuration), /Reconnect its drive/);
  assert.equal(configuration.env.PLAYWRIGHT_BROWSERS_PATH, undefined);
});
test('filesystem access failures are not swallowed or converted to missing-cache fallbacks', () => {
  const denied = new Error('denied'); denied.code = 'EACCES';
  const configuration = { ...options(), realpath: () => { throw denied; } };
  assert.throws(() => configureBrowserCache(configuration), error => error === denied);
});
test('explicit Windows executable paths are canonicalized without mutating options', () => {
  const original = { executablePath: 'C:\\cache\\chrome.exe', headless: true, timeout: 15000 };
  const normalized = canonicalLaunchOptions(original, { platform: 'win32', realpath: () => 'D:\\cache\\chrome.exe' });
  assert.deepEqual(normalized, { ...original, executablePath: 'D:\\cache\\chrome.exe' });
  assert.equal(original.executablePath, 'C:\\cache\\chrome.exe');
});
test('default launch options and non-Windows explicit executables retain their semantics', () => {
  assert.equal(canonicalLaunchOptions(undefined, { platform: 'win32' }), undefined);
  const supplied = { headless: true };
  assert.equal(canonicalLaunchOptions(supplied, { platform: 'win32' }), supplied);
  const linux = { executablePath: '/fixture/browser' };
  assert.equal(canonicalLaunchOptions(linux, { platform: 'linux', realpath: () => assert.fail() }), linux);
});
test('explicit executable resolution fails closed', () => {
  assert.throws(() => canonicalLaunchOptions({ executablePath: 'C:\\missing.exe' }, { platform: 'win32', realpath: absent }), /missing/);
});
test('launch, persistent contexts and launch servers resolve executables and preserve API receivers', () => {
  const type = {
    name() { assert.equal(this, type); return 'fixture'; },
    launch(options) { assert.equal(this, type); return options; },
    launchServer(options) { assert.equal(this, type); return options; },
    launchPersistentContext(profile, options) { assert.equal(this, type); return { profile, options }; },
  };
  const runtime = initializePlaywright({ ...options({ PLAYWRIGHT_BROWSERS_PATH: '0' }), load: () => ({ chromium: type, firefox: type, webkit: type }) });
  for (const browser of [runtime.chromium, runtime.firefox, runtime.webkit]) {
    assert.equal(browser.launch({ executablePath: cache }).executablePath, target);
    assert.equal(browser.launchServer({ executablePath: cache }).executablePath, target);
    assert.deepEqual(browser.launchPersistentContext('C:\\new-profile', { executablePath: cache }), { profile: 'C:\\new-profile', options: { executablePath: target } });
    assert.equal(browser.name(), 'fixture');
    assert.equal(browser.launch, browser.launch);
  }
});
test('all project browser entry points use the adapter rather than bypassing the cache fix', () => {
  for (const directory of ['scripts', 'tests']) {
    for (const name of fs.readdirSync(path.join(__dirname, '..', directory))) {
      if (!name.endsWith('.js') || name === 'playwright-runtime.js' || name === 'playwright-paths.test.js') continue;
      const source = fs.readFileSync(path.join(__dirname, '..', directory, name), 'utf8');
      assert.equal(/require\(['"]playwright['"]\)/.test(source), false, `${directory}/${name} bypasses the shared adapter`);
    }
  }
});
