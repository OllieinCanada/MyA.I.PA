const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { listRuntimeIncidents } = require('../server/runtimeIncidentStore');
const { listRuntimeIncidentsDb } = require('../server/runtimeIncidentRepository');
const { WORKFLOW } = require('../server/callSyncHealth');

const NOW = new Date('2026-11-02T20:00:00.000Z');
const TTL = 7 * 24 * 60 * 60 * 1000;
const CUTOFF = NOW.getTime() - TTL;
const at = milliseconds => new Date(milliseconds).toISOString();
const id = value => value.toString(16).padStart(24, '0');

function item(number, lastDetectedAt, { status = 'needs_user', sync = false, detectedAt = lastDetectedAt } = {}) {
  return {
    id: id(number),
    detectedAt,
    diagnostics: { lastDetectedAt, occurrences: 3 },
    remediation: { status, history: [{ status, at: detectedAt }] },
    snapshot: { Workflow: sync ? WORKFLOW : 'Synthetic ordinary workflow' },
    incident: { reasonCode: 'SYNTHETIC_READ_SAFETY_TEST' },
    severity: 'critical',
    ageMinutes: 0,
  };
}

function fileFixture(t, contents) {
  const parent = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'incident-read-safety-'));
  const filename = path.join(directory, 'incidents.json');
  if (contents !== undefined) fs.writeFileSync(filename, contents);
  t.after(() => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(parent + path.sep));
    assert.ok(path.basename(target).startsWith('incident-read-safety-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { directory, filename };
}

function fileSnapshot(filename) {
  const bytes = fs.readFileSync(filename);
  const stat = fs.statSync(filename, { bigint: true });
  return {
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: stat.size,
    ino: stat.ino,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function withoutFileMutation(t, action) {
  const attempts = [];
  const methods = ['mkdirSync', 'writeFileSync', 'appendFileSync', 'writeSync',
    'renameSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'truncateSync',
    'copyFileSync', 'linkSync', 'symlinkSync', 'chmodSync', 'utimesSync'];
  const spies = methods.map(name => t.mock.method(fs, name, () => {
    attempts.push(name);
    throw Error(`Unexpected filesystem mutation: ${name}`);
  }));
  let result;
  try { result = action(); }
  finally { for (const spy of spies) spy.mock.restore(); }
  // Checking attempted calls matters: the old list path swallowed write errors.
  assert.deepEqual(attempts, [], 'listing must not even attempt a mutation');
  return result;
}

function readOnlyRepository(payloads) {
  const rows = payloads.map(payload => ({
    id: payload.id,
    lastDetectedAt: new Date(payload.diagnostics.lastDetectedAt),
    remediation: payload.remediation.status,
    payload: structuredClone(payload),
  }));
  const calls = [];
  const mutations = [];
  const runtimeIncidentRecord = {
    findMany: async query => {
      calls.push(structuredClone(query));
      let found = rows.filter(row => {
        const where = query.where || {};
        if (where.lastDetectedAt?.gte && row.lastDetectedAt < where.lastDetectedAt.gte) return false;
        if (where.payload?.path
          && where.payload.path.reduce((value, key) => value?.[key], row.payload) !== where.payload.equals) return false;
        return !where.remediation?.notIn?.includes(row.remediation);
      });
      if (query.orderBy?.lastDetectedAt === 'desc') found = found.slice().sort((a, b) => b.lastDetectedAt - a.lastDetectedAt);
      if (query.take !== undefined) found = found.slice(0, query.take);
      return structuredClone(found);
    },
  };
  for (const name of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    runtimeIncidentRecord[name] = async () => {
      mutations.push(name);
      throw Error(`Unexpected repository mutation: ${name}`);
    };
  }
  return {
    prisma: { runtimeIncidentRecord }, rows, calls, mutations,
    snapshot: () => structuredClone(rows),
  };
}

const protectedWhere = {
  payload: { path: ['snapshot', 'Workflow'], equals: WORKFLOW },
  remediation: { notIn: ['resolved', 'recovered', 'not_required'] },
};

test('file listing hides expired ordinary incidents without attempting to prune their stored history', t => {
  const old = item(1, at(CUTOFF - 1));
  const { filename } = fileFixture(t, JSON.stringify({ schemaVersion: 1, items: [old] }, null, 2) + '\n');
  const before = fileSnapshot(filename);
  withoutFileMutation(t, () => {
    for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(listRuntimeIncidents(filename, { now: NOW }), []);
  });
  assert.deepEqual(fileSnapshot(filename), before);
  assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).items[0].remediation.status, 'needs_user');
});

test('file listing preserves order, exact cutoff, refreshed detection and protected sync visibility', t => {
  const boundary = item(2, at(CUTOFF));
  const expired = item(3, at(CUTOFF - 1));
  const inside = item(4, at(CUTOFF + 1));
  const protectedOld = item(5, at(CUTOFF - TTL), { sync: true });
  const resolvedOld = item(6, at(CUTOFF - TTL), { sync: true, status: 'resolved' });
  const refreshed = item(7, at(NOW.getTime() - 1000), { detectedAt: at(CUTOFF - TTL) });
  const values = [inside, expired, boundary, protectedOld, resolvedOld, refreshed];
  const { filename } = fileFixture(t, JSON.stringify({ schemaVersion: 1, items: values }) + '\n');
  const before = fileSnapshot(filename);
  const result = withoutFileMutation(t, () => listRuntimeIncidents(filename, { now: NOW }));
  assert.deepEqual(result.map(value => value.id), [inside.id, boundary.id, protectedOld.id, refreshed.id]);
  assert.equal(result.at(-1).ageMinutes, 14 * 24 * 60);
  assert.deepEqual(result.map(({ ageMinutes, ...value }) => value),
    [inside, boundary, protectedOld, refreshed].map(({ ageMinutes, ...value }) => value));
  assert.deepEqual(fileSnapshot(filename), before);
});

test('file listing applies a caller-supplied view TTL without retaining only that view', t => {
  const boundary = item(8, at(NOW.getTime() - 1000));
  const expired = item(9, at(NOW.getTime() - 1001));
  const inside = item(10, at(NOW.getTime() - 999));
  const { filename } = fileFixture(t, JSON.stringify({ items: [boundary, expired, inside] }));
  const before = fileSnapshot(filename);
  const result = withoutFileMutation(t, () => listRuntimeIncidents(filename, { now: NOW.toISOString(), ttlMs: 1000 }));
  assert.deepEqual(result.map(value => value.id), [boundary.id, inside.id]);
  assert.deepEqual(fileSnapshot(filename), before);
});

test('file listing does not rewrite invalid entries just because they are excluded from the active view', t => {
  const current = item(11, NOW.toISOString());
  const invalidId = { ...item(12, NOW.toISOString()), id: 'invalid' };
  const invalidTime = item(13, 'not-a-date');
  const { filename } = fileFixture(t, JSON.stringify({ schemaVersion: 1, items: [invalidId, invalidTime, null, current] }));
  const before = fileSnapshot(filename);
  const result = withoutFileMutation(t, () => listRuntimeIncidents(filename, { now: NOW }));
  assert.deepEqual(result.map(value => value.id), [current.id]);
  assert.deepEqual(fileSnapshot(filename), before);
});

for (const contents of ['{malformed-json', JSON.stringify({ items: 'not-an-array' }), JSON.stringify({ items: [] })]) {
  test(`file listing leaves malformed or empty stored content untouched: ${contents}`, t => {
    const { filename } = fileFixture(t, contents);
    const before = fileSnapshot(filename);
    withoutFileMutation(t, () => {
      assert.deepEqual(listRuntimeIncidents(filename, { now: NOW }), []);
      assert.deepEqual(listRuntimeIncidents(filename, { now: NOW }), []);
    });
    assert.deepEqual(fileSnapshot(filename), before);
  });
}

test('file listing neither initializes a missing file nor creates a missing parent directory', t => {
  const { filename, directory } = fileFixture(t);
  const nested = path.join(directory, 'never-created', 'incidents.json');
  withoutFileMutation(t, () => {
    assert.deepEqual(listRuntimeIncidents(filename, { now: NOW }), []);
    assert.deepEqual(listRuntimeIncidents(nested, { now: NOW }), []);
  });
  assert.equal(fs.existsSync(filename), false);
  assert.equal(fs.existsSync(path.dirname(nested)), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('database listing hides expired ordinary rows with zero mutation methods or stored-row changes', async () => {
  const repository = readOnlyRepository([item(20, at(CUTOFF - 1))]);
  const before = repository.snapshot();
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.deepEqual(await listRuntimeIncidentsDb(repository.prisma, { now: NOW }), []);
  }
  assert.deepEqual(repository.mutations, []);
  assert.deepEqual(repository.snapshot(), before);
  assert.equal(repository.calls.length, 6);
  assert.deepEqual(repository.calls.slice(0, 2), [
    { where: { lastDetectedAt: { gte: new Date(CUTOFF) } }, orderBy: { lastDetectedAt: 'desc' }, take: 100 },
    { where: protectedWhere },
  ]);
});

test('database listing preserves cutoff and refreshed lastDetectedAt, not the age of original detection', async () => {
  const boundary = item(21, at(CUTOFF));
  const expired = item(22, at(CUTOFF - 1));
  const inside = item(23, at(CUTOFF + 1));
  const refreshed = item(24, at(NOW.getTime() - 1000), { detectedAt: at(CUTOFF - TTL) });
  const repository = readOnlyRepository([boundary, expired, inside, refreshed]);
  const before = repository.snapshot();
  const result = await listRuntimeIncidentsDb(repository.prisma, { now: NOW.toISOString() });
  assert.deepEqual(result.map(value => value.id), [refreshed.id, inside.id, boundary.id]);
  assert.equal(result[0].ageMinutes, 14 * 24 * 60);
  assert.deepEqual(repository.mutations, []);
  assert.deepEqual(repository.snapshot(), before);
});

test('database listing preserves the recent cap and unions/deduplicates protected unresolved sync rows', async () => {
  const recent = Array.from({ length: 101 }, (_, index) => item(100 + index, at(NOW.getTime() - index), { sync: index === 0 }));
  const protectedOld = item(300, at(CUTOFF - TTL), { sync: true });
  const oldTerminal = ['resolved', 'recovered', 'not_required'].map((status, index) => item(301 + index, at(CUTOFF - TTL), { sync: true, status }));
  const ordinaryOld = item(304, at(CUTOFF - TTL));
  const repository = readOnlyRepository([...recent, protectedOld, ...oldTerminal, ordinaryOld]);
  const before = repository.snapshot();
  const result = await listRuntimeIncidentsDb(repository.prisma, { now: NOW });
  assert.deepEqual(result.map(value => value.id), [...recent.slice(0, 100).map(value => value.id), protectedOld.id]);
  assert.equal(new Set(result.map(value => value.id)).size, result.length);
  assert.deepEqual(repository.mutations, []);
  assert.deepEqual(repository.snapshot(), before);
});

test('database listing applies a custom TTL only to its active query and does not mutate history', async () => {
  const boundary = item(400, at(NOW.getTime() - 1000));
  const expired = item(401, at(NOW.getTime() - 1001));
  const inside = item(402, at(NOW.getTime() - 999));
  const repository = readOnlyRepository([boundary, expired, inside]);
  const before = repository.snapshot();
  const result = await listRuntimeIncidentsDb(repository.prisma, { now: NOW, ttlMs: 1000 });
  assert.deepEqual(result.map(value => value.id), [inside.id, boundary.id]);
  assert.deepEqual(repository.mutations, []);
  assert.deepEqual(repository.snapshot(), before);
});
