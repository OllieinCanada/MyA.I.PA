const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { template, prepare, main, localPath } = require('../scripts/prepare-isolated-launch-tests');
const release = 'a'.repeat(40), now = Date.parse('2026-11-02T00:00:00.000Z');
function complete() {
  const value = template(release);
  value.environment.appOrigin = 'http://127.0.0.1:9876';
  for (const object of [value.environment, value.resources, value.participants, value.review]) for (const key of Object.keys(object)) if (key.endsWith('Ref')) object[key] = 'ref-' + key.toLowerCase();
  Object.assign(value.bounds, { startsAt: new Date(now + 60000).toISOString(), endsAt: new Date(now + 16 * 60000).toISOString(), cleanupDueAt: new Date(now + 30 * 60000).toISOString(), budgetUsdCents: 0, maxStripeTestObjects: 30 });
  return value;
}
test('pending template exposes exact missing decisions and never authorizes execution', () => {
  const result = prepare(template(release), { now });
  assert.equal(result.metadataComplete, false); assert.ok(result.missing.includes('bounds.budgetUsdCents'));
  assert.ok(result.missing.includes('participants.telegramRecipientRef'));
  assert.equal(result.executionAllowed, false); assert.equal(result.readyToShip, false);
});
test('even complete metadata is preparation, not authenticated approval or physical proof', () => {
  const result = prepare(complete(), { now });
  assert.equal(result.metadataComplete, true); assert.equal(result.executionAllowed, false);
  assert.equal(result.approvalAuthenticated, false); assert.equal(result.environmentOwnershipVerified, false);
  assert.equal(result.effects.credentialsLoaded, 0); assert.equal(result.effects.stripeObjectsCreated, 0);
});
test('live/shared environments, activation and contact attempts fail closed', () => {
  for (const change of [v => v.executionAuthorized = true, v => v.executionAuthorized = 'false', v => v.environment.productionShared = true, v => v.environment.stripeMode = 'live', v => v.environment.workersEnabled = true, v => v.bounds.customerTexts = 1, v => v.bounds.stopStartMessages = 1, v => v.bounds.customerCalls = 1, v => v.bounds.maxPrivateAlertMessages = 3]) {
    const value = complete(); change(value); assert.throws(() => prepare(value, { now }));
  }
});
test('production origins, credentials, raw contacts and arbitrary extra fields are not accepted', () => {
  for (const origin of ['https://api.myaipa.ca/', 'https://www.myaipa.ca/', 'http://external.example.test/', 'https://user:password@isolated.example.test/', 'https://isolated.example.test/?secret=x']) {
    const value = complete(); value.environment.appOrigin = origin; assert.throws(() => prepare(value, { now }));
  }
  for (const input of ['sk_test_PRIVATE', 'whsec_PRIVATE', '+15555550123', 'person@example.invalid', { ref: 'nested' }]) {
    const value = complete(); value.participants.emailRecipientRef = input; assert.throws(() => prepare(value, { now }));
  }
  const value = complete(); value.credentials = 'forbidden'; assert.throws(() => prepare(value, { now }));
});
test('tenant collision, malformed release/window and unbounded cost cannot look review-ready', () => {
  for (const change of [v => v.resources.tenantBRef = v.resources.tenantARef, v => v.releaseCommit = [release], v => v.bounds.startsAt = [v.bounds.startsAt], v => v.bounds.endsAt = new Date(now + 3600000).toISOString(), v => v.bounds.startsAt = new Date(now - 1).toISOString(), v => v.bounds.cleanupDueAt = new Date(now + 7200000).toISOString(), v => v.bounds.budgetUsdCents = 501, v => v.bounds.budgetUsdCents = '0', v => v.bounds.maxStripeTestObjects = 0, v => v.bounds.maxStripeTestObjects = 101]) {
    const value = complete(); change(value); assert.throws(() => prepare(value, { now }));
  }
});
test('preparation output retains input digest and missing fields, not private reference values', () => {
  const value = complete(); value.review.ownerScopeRef = 'ref-private-approval-reference';
  const result = prepare(value, { now }), text = JSON.stringify(result);
  assert.match(result.metadataSha256, /^[a-f0-9]{64}$/); assert.ok(!text.includes('ref-private-approval-reference'));
  assert.ok(result.separateUnresolvedGates.some(x => x.includes('163')));
});
test('CLI creates only a new offline plan and cannot overwrite or accept execution flags', () => {
  const parent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'launch-plan-fixture-'));
  try {
    const out = path.join(root, 'new'); const result = main(['--template', '--commit=' + release, '--out-dir=' + out]);
    assert.equal(result.executionAllowed, false); assert.ok(fs.existsSync(path.join(out, 'pending-input.json')));
    const before = fs.readFileSync(path.join(out, 'plan.json'), 'utf8');
    assert.throws(() => main(['--template', '--commit=' + release, '--out-dir=' + out]));
    for (const flag of ['--execute', '--apply']) assert.throws(() => main(['--template', '--commit=' + release, '--out-dir=' + path.join(root, 'other'), flag]));
    assert.equal(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'), before);
  } finally { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(parent)); fs.rmSync(root, { recursive: true, force: true }); }
});

test('UNC, device, ADS and relative metadata paths are rejected before any filesystem call', () => {
  let calls = 0; const io = new Proxy({}, { get: () => () => { calls++; throw Error('filesystem must not be reached'); } });
  const options = { io, platform: 'win32', pathApi: path.win32 };
  const bad = ['\\\\server\\share\\new', '//server/share/new', '\\\\?\\C:\\new', '\\\\.\\C:\\new', 'C:/safe/file:stream', 'C:/safe/NUL.txt', 'C:/safe/COM1', 'C:relative', '\\relative', 'relative', 'C:/safe/name.'];
  for (const value of bad) {
    assert.throws(() => main(['--template', '--commit=' + release, '--out-dir=' + value], options));
    assert.throws(() => main(['--input=' + value, '--out-dir=D:/safe/new'], options));
  }
  assert.equal(calls, 0);
  assert.equal(localPath('D:/safe/new', { platform: 'win32', pathApi: path.win32 }), 'D:\\safe\\new');
});

test('output ancestor junctions stop sequential inspection before entering the redirected child', () => {
  const seen = [], io = { lstatSync: target => { seen.push(target); return { isDirectory: () => true, isSymbolicLink: () => target === 'D:\\redirected' }; } };
  assert.throws(() => main(['--template', '--commit=' + release, '--out-dir=D:/redirected/child/new'], { io, platform: 'win32', pathApi: path.win32 }), /ANCESTOR_REDIRECTED/);
  assert.deepEqual(seen, ['D:\\', 'D:\\redirected']);
});

test('input ancestor junctions stop before the final input is touched, with no real share probe', () => {
  const seen = [], io = { lstatSync: target => {
    seen.push(target); if (target === 'D:\\safe\\new') throw Object.assign(Error('absent'), { code: 'ENOENT' });
    return { isDirectory: () => true, isSymbolicLink: () => target === 'D:\\private' };
  } };
  assert.throws(() => main(['--input=D:/private/child/input.json', '--out-dir=D:/safe/new'], { io, platform: 'win32', pathApi: path.win32 }), /ANCESTOR_REDIRECTED/);
  assert.equal(seen.includes('D:\\private\\child'), false); assert.equal(seen.includes('D:\\private\\child\\input.json'), false);
});

test('the input CLI uses an explicit bounded plain file and preserves it without echoing references', () => {
  const parent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'launch-input-fixture-'));
  try {
    const input = path.join(root, 'input.json'), out = path.join(root, 'new'), bytes = JSON.stringify(template(release));
    fs.writeFileSync(input, bytes);
    assert.equal(main(['--input=' + input, '--out-dir=' + out]).executionAllowed, false);
    assert.equal(fs.readFileSync(input, 'utf8'), bytes);
  } finally { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(parent)); fs.rmSync(root, { recursive: true, force: true }); }
});
