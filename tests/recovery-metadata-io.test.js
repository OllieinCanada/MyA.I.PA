'use strict';
// Every filesystem endpoint in this suite is an in-memory injected double.
// No UNC, device, mapped drive, share, real metadata file or output is probed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createMetadataIO, lexicalPath, MAX_BYTES } = require('../scripts/recovery-metadata-io');

function fakeFilesystem() {
  const calls = [], entries = new Map(), descriptors = new Map(); let next = 20, inode = 10n, fstats = 0;
  const error = code => Object.assign(Error('synthetic filesystem failure; do not disclose private path'), { code });
  const put = (name, type = 'file', raw = '{}', extra = {}) => {
    entries.set(name, { type, bytes: Buffer.isBuffer(raw) ? raw : Buffer.from(raw), ino: inode++, version: 1n, ...extra });
  };
  put('C:\\', 'dir'); put('C:\\safe', 'dir'); put('C:\\safe\\input.json');
  const stats = entry => ({ dev: 1n, ino: entry.ino, nlink: entry.nlink ?? 1n,
    size: entry.reportedSize ?? BigInt(entry.type === 'file' ? entry.bytes.length : 0), mtimeNs: entry.version, ctimeNs: entry.version,
    isFile: () => entry.type === 'file', isDirectory: () => entry.type === 'dir', isSymbolicLink: () => entry.redirected === true,
    fileAttributes: entry.reparse ? 0x400 : 0 });
  const io = {
    lstatSync(name) { calls.push(['lstat', name]); if (!entries.has(name)) throw error('ENOENT'); return stats(entries.get(name)); },
    openSync(name, flags) {
      calls.push(['open', name, flags]);
      if (flags & fs.constants.O_EXCL) {
        if (io.raceOnCreate) { put(name, 'file', '{"otherWriter":true}'); throw error('EEXIST'); }
        if (entries.has(name)) throw error('EEXIST'); put(name);
        entries.get(name).bytes = Buffer.alloc(0);
      }
      if (!entries.has(name)) throw error('ENOENT');
      const fd = next++; descriptors.set(fd, { name, position: 0 }); return fd;
    },
    fstatSync(fd) {
      calls.push(['fstat', fd]); const value = stats(entries.get(descriptors.get(fd).name));
      return io.mutateFstat?.(++fstats, value) || value;
    },
    readSync(fd, buffer, offset, length) {
      calls.push(['read', fd]); const descriptor = descriptors.get(fd), bytes = entries.get(descriptor.name).bytes;
      const count = bytes.copy(buffer, offset, descriptor.position, descriptor.position + length); descriptor.position += count; return count;
    },
    closeSync(fd) { calls.push(['close', fd]); descriptors.delete(fd); },
    writeFileSync(fd, bytes) { calls.push(['write', fd]); const entry = entries.get(descriptors.get(fd).name); entry.bytes = Buffer.from(bytes); entry.version++; },
    fsyncSync(fd) { calls.push(['fsync', fd]); },
    mkdirSync(name) { calls.push(['mkdir', name]); if (entries.has(name)) throw error('EEXIST'); put(name, 'dir'); },
  };
  return { io, calls, entries, put, metadataIO: createMetadataIO({ io, platform: 'win32' }) };
}

test('lexical Windows rejection touches no filesystem for UNC, device, ADS, relative and ambiguous paths', () => {
  const value = fakeFilesystem();
  for (const bad of ['\\\\server\\share\\x.json', '//server/share/x.json', '\\\\?\\C:\\x.json', '\\\\.\\pipe\\x',
    'C:safe\\x.json', '\\safe\\x.json', 'relative.json', 'C:\\safe\\x.json:stream', 'C:\\safe\\NUL.json',
    'C:\\safe\\COM1', 'C:\\safe\\trailing.', 'C:\\safe\\trailing ', 'C:\\safe\\..\\x.json', 'C:\\']) {
    assert.throws(() => value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' },
      out: { path: bad, kind: 'output-file' } }), /LOCAL_METADATA_/);
  }
  assert.deepEqual(value.calls, []);
});

test('POSIX device/share/relative/ADS forms reject lexically without probing an endpoint', () => {
  const metadataIO = createMetadataIO({ io: new Proxy({}, { get() { assert.fail('Filesystem must not be consulted'); } }), platform: 'linux' });
  for (const bad of ['//server/share/file', '/dev/null', '/proc/self/environ', '/sys/kernel/x', 'relative', '/tmp/file:stream', '/tmp/../x', '/']) {
    assert.throws(() => metadataIO.prepare({ input: { path: bad, kind: 'input' } }), /LOCAL_METADATA_/);
  }
  assert.equal(lexicalPath('/tmp/fixture/file.json', 'linux'), '/tmp/fixture/file.json');
});

test('notification-store and fixed-fixture validation share lexical ADS/device rejection without I/O', () => {
  const { assertPlainPath } = require('../scripts/recovery-notification-store');
  const { readFixture } = require('../scripts/recovery-supervision-contract');
  const value = fakeFilesystem();
  for (const bad of ['C:\\safe\\state:stream', 'C:\\safe\\NUL', '\\\\server\\share\\state', 'relative']) {
    assert.throws(() => assertPlainPath(bad, { io: value.io, platform: 'win32' }), /EXPLICIT_LOCAL_DIRECTORY/);
    assert.throws(() => readFixture(bad, '11111111-1111-4111-8111-111111111111', { io: value.io, platform: 'win32' }), /EXPLICIT_LOCAL_DIRECTORY/);
  }
  assert.deepEqual(value.calls, []);
});

test('notification-store and fixed-fixture walks stop before redirected descendants', () => {
  const { assertPlainPath } = require('../scripts/recovery-notification-store');
  const { readFixture } = require('../scripts/recovery-supervision-contract');
  const value = fakeFilesystem(); value.put('C:\\safe\\state', 'dir'); value.entries.get('C:\\safe').redirected = true;
  assert.throws(() => assertPlainPath('C:\\safe\\state', { io: value.io, platform: 'win32' }), /DIRECTORY_REDIRECTED/);
  assert.deepEqual(value.calls, [['lstat', 'C:\\'], ['lstat', 'C:\\safe']]);
  value.calls.length = 0;
  value.put('C:\\safe\\recovery-supervision-fixture-mocked', 'dir');
  assert.throws(() => readFixture('C:\\safe\\recovery-supervision-fixture-mocked', '11111111-1111-4111-8111-111111111111',
    { io: value.io, platform: 'win32' }), /DIRECTORY_REDIRECTED/);
  assert.deepEqual(value.calls, [['lstat', 'C:\\'], ['lstat', 'C:\\safe']]);
});

test('all arguments are checked before I/O, including optional state after an otherwise-valid policy', () => {
  const { main } = require('../scripts/evaluate-recovery-monitor'); const value = fakeFilesystem();
  assert.throws(() => main(['--policy=C:\\safe\\policy.json', '--facts=C:\\safe\\facts.json', '--out-dir=C:\\safe\\out',
    '--state=\\\\server\\share\\later.json'], { metadataIO: value.metadataIO }), /LOCAL_METADATA_/);
  assert.deepEqual(value.calls, []);
});

test('custody CLI rejects a forbidden later output before reading earlier policy/metadata', () => {
  const { main } = require('../scripts/recovery-custody-preflight'); const value = fakeFilesystem();
  assert.throws(() => main(['--policy=C:\\safe\\policy.json', '--metadata=C:\\safe\\metadata.json',
    '--out-dir=C:\\safe\\out:stream'], { metadataIO: value.metadataIO }), /LOCAL_METADATA_/);
  assert.deepEqual(value.calls, []);
});

test('PostgreSQL evidence CLI validates context and output before reading its first input', () => {
  const { main } = require('../scripts/validate-synthetic-postgres-evidence');
  for (const [context, out] of [['\\\\server\\share\\context.json', 'C:\\safe\\out.json'], ['C:\\safe\\context.json', '\\\\?\\C:\\out.json']]) {
    const value = fakeFilesystem();
    assert.throws(() => main(['--input=C:\\safe\\input.json', '--context=' + context, '--out=' + out], { metadataIO: value.metadataIO }), /LOCAL_METADATA_/);
    assert.deepEqual(value.calls, []);
  }
});

test('every CLI path role rejects UNC, device, ADS and relative forms before any injected filesystem call', () => {
  const commands = [
    { main: require('../scripts/evaluate-recovery-monitor').main, values: { policy: 'C:\\safe\\policy.json', facts: 'C:\\safe\\facts.json', state: 'C:\\safe\\state.json', 'out-dir': 'C:\\safe\\new-monitor' } },
    { main: require('../scripts/recovery-custody-preflight').main, values: { policy: 'C:\\safe\\policy.json', metadata: 'C:\\safe\\metadata.json', 'out-dir': 'C:\\safe\\new-custody' } },
    { main: require('../scripts/validate-synthetic-postgres-evidence').main, values: { input: 'C:\\safe\\input.json', context: 'C:\\safe\\context.json', out: 'C:\\safe\\new-evidence.json' } },
  ];
  for (const command of commands) for (const key of Object.keys(command.values)) {
    for (const bad of ['\\\\server\\share\\x.json', '//server/share/x.json', '\\\\?\\C:\\x.json', 'C:\\safe\\x.json:stream', 'relative.json']) {
      const value = fakeFilesystem(), values = { ...command.values, [key]: bad };
      assert.throws(() => command.main(Object.entries(values).map(([name, pathname]) => '--' + name + '=' + pathname),
        { metadataIO: value.metadataIO }), /LOCAL_METADATA_/);
      assert.deepEqual(value.calls, [], key + ' must reject before any earlier valid path is read');
    }
  }
});

test('input/output aliases and forged plans are rejected before any filesystem call', () => {
  const value = fakeFilesystem();
  assert.throws(() => value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' },
    out: { path: 'c:\\safe\\INPUT.JSON', kind: 'output-file' } }), /DISTINCT/);
  assert.throws(() => value.metadataIO.readJson({}, 'input'), /VALIDATED_PATH_PLAN/);
  assert.deepEqual(value.calls, []);
});

test('ancestor walk stops at a junction before touching its descendant', () => {
  const value = fakeFilesystem(); value.entries.get('C:\\safe').redirected = true;
  const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  assert.throws(() => value.metadataIO.readJson(plan, 'input'), /ANCESTOR_DIRECTORY_REDIRECTED/);
  assert.deepEqual(value.calls, [['lstat', 'C:\\'], ['lstat', 'C:\\safe']]);
});

test('reported reparse attributes stop output traversal without mkdir or descendant access', () => {
  const value = fakeFilesystem(); value.entries.get('C:\\safe').reparse = true;
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\new-dir', kind: 'output-dir' } });
  assert.throws(() => value.metadataIO.createDirectory(plan, 'out'), /ANCESTOR_DIRECTORY_REDIRECTED/);
  assert.deepEqual(value.calls, [['lstat', 'C:\\'], ['lstat', 'C:\\safe']]);
});

test('oversized and nonplain inputs reject before descriptor open', () => {
  for (const extra of [{ reportedSize: BigInt(MAX_BYTES + 1) }, { type: 'dir' }, { redirected: true }, { nlink: 2n }]) {
    const value = fakeFilesystem(); Object.assign(value.entries.get('C:\\safe\\input.json'), extra);
    const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
    assert.throws(() => value.metadataIO.readJson(plan, 'input'), /BOUNDED_PLAIN_INPUT_REQUIRED/);
    assert.equal(value.calls.some(call => call[0] === 'open'), false);
  }
});

test('descriptor identity mismatch cannot return metadata and the descriptor is closed', () => {
  const value = fakeFilesystem(); value.io.mutateFstat = (_count, stat) => ({ ...stat, ino: stat.ino + 1n });
  const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  assert.throws(() => value.metadataIO.readJson(plan, 'input'), /INPUT_CHANGED/);
  assert.equal(value.calls.at(-1)[0], 'close');
});

test('mutation after a bounded read rejects data rather than trusting a completed open', () => {
  const value = fakeFilesystem(); value.io.mutateFstat = (count, stat) => count === 2 ? { ...stat, mtimeNs: stat.mtimeNs + 1n } : stat;
  const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  assert.throws(() => value.metadataIO.readJson(plan, 'input'), /INPUT_CHANGED/);
  assert.equal(value.calls.at(-1)[0], 'close');
});

test('a read cannot hide appended bytes behind an unchanged smaller reported size', () => {
  const value = fakeFilesystem(); value.put('C:\\safe\\input.json', 'file', '{}x', { reportedSize: 2n });
  const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  assert.throws(() => value.metadataIO.readJson(plan, 'input'), /INPUT_CHANGED/);
  assert.equal(value.calls.at(-1)[0], 'close');
});

test('invalid UTF-8, malformed JSON and nonobject metadata fail closed', () => {
  for (const raw of [Buffer.from([0xff]), '{broken', 'null', '[]', 'false']) {
    const value = fakeFilesystem(); value.put('C:\\safe\\input.json', 'file', raw);
    const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
    assert.throws(() => value.metadataIO.readJson(plan, 'input'), /INPUT_JSON_OR_ENCODING_INVALID|INPUT_OBJECT_REQUIRED/);
    assert.equal(value.calls.at(-1)[0], 'close');
  }
});

test('plain bounded descriptor reads return only the supplied in-memory JSON bytes', () => {
  const value = fakeFilesystem(); value.put('C:\\safe\\input.json', 'file', '{"fixture":true}');
  const plan = value.metadataIO.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  const result = value.metadataIO.readJson(plan, 'input');
  assert.deepEqual(result.value, { fixture: true });
  assert.equal(result.bytes.toString(), '{"fixture":true}');
  assert.equal(value.calls.at(-1)[0], 'close');
});

test('existing output is never replaced, opened or truncated', () => {
  const value = fakeFilesystem(); value.put('C:\\safe\\output.json', 'file', '{"preserve":true}');
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\output.json', kind: 'output-file' } });
  assert.throws(() => value.metadataIO.writeJson(plan, 'out', { fixture: true }), /OUTPUT_ALREADY_EXISTS/);
  assert.equal(value.entries.get('C:\\safe\\output.json').bytes.toString(), '{"preserve":true}');
  assert.equal(value.calls.some(call => call[0] === 'open'), false);
});

test('exclusive create races fail without overwriting the other writer', () => {
  const value = fakeFilesystem(); value.io.raceOnCreate = true;
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\output.json', kind: 'output-file' } });
  assert.throws(() => value.metadataIO.writeJson(plan, 'out', { fixture: true }), /IO_FAILED_NO_RETRY/);
  assert.equal(value.entries.get('C:\\safe\\output.json').bytes.toString(), '{"otherWriter":true}');
  assert.equal(value.calls.some(call => call[0] === 'write'), false);
});

test('new output is descriptor-written and flushed with exclusive no-replace flags', () => {
  const value = fakeFilesystem();
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\output.json', kind: 'output-file' } });
  value.metadataIO.writeJson(plan, 'out', { fixture: true });
  assert.equal(JSON.parse(value.entries.get('C:\\safe\\output.json').bytes).fixture, true);
  const flags = value.calls.find(call => call[0] === 'open')[2];
  assert.ok(flags & fs.constants.O_EXCL); assert.ok(flags & fs.constants.O_CREAT);
  assert.equal(value.calls.some(call => call[0] === 'fsync'), true);
  assert.equal(value.calls.at(-1)[0], 'close');
});

test('new output directories use owned identity and a fixed safe filename', () => {
  const value = fakeFilesystem();
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\new-dir', kind: 'output-dir' } });
  const handle = value.metadataIO.createDirectory(plan, 'out');
  assert.throws(() => value.metadataIO.writeJsonInDirectory(handle, '..\\escape.json', {}), /OWNED_OUTPUT_DIRECTORY/);
  value.metadataIO.writeJsonInDirectory(handle, 'fixture-report.json', { fixture: true });
  assert.equal(value.entries.has('C:\\safe\\new-dir\\fixture-report.json'), true);
  assert.throws(() => value.metadataIO.createDirectory(plan, 'out'), /OUTPUT_ALREADY_EXISTS/);
});

test('replaced output-directory identity is held instead of writing through it', () => {
  const value = fakeFilesystem();
  const plan = value.metadataIO.prepare({ out: { path: 'C:\\safe\\new-dir', kind: 'output-dir' } });
  const handle = value.metadataIO.createDirectory(plan, 'out'); value.entries.get('C:\\safe\\new-dir').ino++;
  assert.throws(() => value.metadataIO.writeJsonInDirectory(handle, 'fixture-report.json', {}), /OUTPUT_DIRECTORY_CHANGED/);
  assert.equal(value.calls.some(call => call[0] === 'open'), false);
});

test('oversized generated reports and filesystem errors expose no path or original error detail', () => {
  const value = fakeFilesystem(), metadataIO = createMetadataIO({ io: value.io, platform: 'win32', maxBytes: 32 });
  const plan = metadataIO.prepare({ out: { path: 'C:\\safe\\output.json', kind: 'output-file' } });
  assert.throws(() => metadataIO.writeJson(plan, 'out', { fixture: 'x'.repeat(100) }), /BOUNDED_OUTPUT/);
  assert.deepEqual(value.calls, []);
  const broken = createMetadataIO({ io: { lstatSync() { throw Error('DO_NOT_DISCLOSE_PRIVATE_PATH_OR_CONTENT'); } }, platform: 'win32' });
  const bad = broken.prepare({ input: { path: 'C:\\safe\\input.json', kind: 'input' } });
  assert.throws(() => broken.readJson(bad, 'input'), error => error.code === 'LOCAL_METADATA_IO_FAILED_NO_RETRY'
    && !String(error).includes('DO_NOT_DISCLOSE') && !String(error).includes('C:\\'));
});
