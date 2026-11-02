// Explicit single-host local-filesystem adapter for the disabled proposal. There is
// no default path, credential reader, stale-lock stealing, transport or CLI.
// Every load/claim/update holds one atomic mkdir lock and enforces revision CAS.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const model = require('./recovery-notification-model');
const { lexicalPath } = require('./recovery-metadata-io');
const stores = new WeakSet();
const MAX_BYTES = 2 * 1024 * 1024;
function resolveLocalDirectory(directory, platform = process.platform, pathApi = platform === 'win32' ? path.win32 : path.posix) {
  try { return lexicalPath(directory, platform); }
  catch {
    if (typeof directory === 'string' && (platform === 'win32' ? /^[a-z]:[\\/]$/i.test(directory) : directory === '/')) model.fail('RECOVERY_NOTIFICATION_DEDICATED_DIRECTORY_REQUIRED');
    model.fail('RECOVERY_NOTIFICATION_EXPLICIT_LOCAL_DIRECTORY_REQUIRED');
  }
}
function assertPlainPath(directory, { io = fs, platform = process.platform } = {}) {
  const resolved = resolveLocalDirectory(directory, platform), api = platform === 'win32' ? path.win32 : path.posix;
  const ordered = []; let cursor = resolved;
  while (true) { ordered.unshift(cursor); const parent = api.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  for (const component of ordered) {
    let stat;
    try { stat = io.lstatSync(component); } catch { model.fail('RECOVERY_NOTIFICATION_DIRECTORY_UNAVAILABLE'); }
    const reparse = stat.isSymbolicLink() || stat.isReparsePoint?.() === true || stat.reparsePoint === true
      || (typeof stat.fileAttributes === 'number' && (stat.fileAttributes & 0x400) !== 0)
      || (typeof stat.fileAttributes === 'bigint' && (stat.fileAttributes & 0x400n) !== 0n);
    if (!stat.isDirectory() || reparse) model.fail('RECOVERY_NOTIFICATION_DIRECTORY_REDIRECTED');
  }
  return resolved;
}
function openNotificationStore({ directory, monitorId } = {}) {
  const root = assertPlainPath(directory);
  model.createInitialState(monitorId);
  const filename = path.join(root, 'notification-state.json'), lock = path.join(root, 'notification-state.lock');
  const stateEntry = () => {
    try { return fs.lstatSync(filename, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  function read() {
    const stat = fs.lstatSync(filename, { bigint: true });
    const regular = value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n && value.size <= BigInt(MAX_BYTES);
    const same = (left, right) => ['dev','ino','size','nlink','mtimeNs','ctimeNs'].every(key => left[key] === right[key]);
    if (!regular(stat)) model.fail('RECOVERY_NOTIFICATION_STATE_FILE_INVALID');
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let bytes;
    try {
      const before = fs.fstatSync(descriptor, { bigint: true });
      if (!regular(before) || !same(stat, before)) model.fail('RECOVERY_NOTIFICATION_STATE_FILE_CHANGED');
      const buffer = Buffer.alloc(Number(before.size) + 1); let size = 0, count;
      while (size < buffer.length && (count = fs.readSync(descriptor, buffer, size, buffer.length - size, null)) > 0) size += count;
      const after = fs.fstatSync(descriptor, { bigint: true }), current = fs.lstatSync(filename, { bigint: true });
      if (!regular(after) || !regular(current) || !same(before, after) || !same(before, current) || BigInt(size) !== before.size) model.fail('RECOVERY_NOTIFICATION_STATE_FILE_CHANGED');
      bytes = buffer.subarray(0, size);
    } finally { fs.closeSync(descriptor); }
    let decoded;
    try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { model.fail('RECOVERY_NOTIFICATION_STATE_ENCODING_OR_JSON_INVALID_NO_RESET'); }
    const state = model.validateState(decoded);
    if (state.monitorId !== monitorId) model.fail('RECOVERY_NOTIFICATION_MONITOR_MISMATCH');
    return { state, digest: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  function exclusive(fn) {
    assertPlainPath(root);
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') model.fail('RECOVERY_NOTIFICATION_LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE'); throw error; }
    const token = crypto.randomUUID(), owner = path.join(lock, 'owner.json');
    const descriptor = fs.openSync(owner, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify({ token })); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const owned = () => {
      let actual;
      try {
        const stat = fs.lstatSync(owner);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 || fs.lstatSync(lock).isSymbolicLink()) model.fail('RECOVERY_NOTIFICATION_LOCK_OWNERSHIP_LOST');
        actual = JSON.parse(fs.readFileSync(owner, 'utf8')).token;
      } catch { model.fail('RECOVERY_NOTIFICATION_LOCK_OWNERSHIP_LOST'); }
      if (actual !== token) model.fail('RECOVERY_NOTIFICATION_LOCK_OWNERSHIP_LOST');
    };
    try {
      const result = fn(owned);
      if (result && typeof result.then === 'function') model.fail('RECOVERY_NOTIFICATION_LOCK_CALLBACK_MUST_BE_SYNCHRONOUS');
      return result;
    } finally {
      owned(); fs.unlinkSync(owner); fs.rmdirSync(lock);
    }
  }
  function write(state, expectedDigest, owned) {
    model.validateState(state); owned();
    const currentDigest = stateEntry() === null ? null : read().digest;
    if (currentDigest !== expectedDigest) model.fail('RECOVERY_NOTIFICATION_REVISION_CONFLICT');
    const bytes = Buffer.from(JSON.stringify(state, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) model.fail('RECOVERY_NOTIFICATION_HISTORY_REVIEW_REQUIRED');
    const temporary = path.join(root, `notification-state.${crypto.randomUUID()}.pending`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    owned();
    if ((stateEntry() === null ? null : read().digest) !== expectedDigest) model.fail('RECOVERY_NOTIFICATION_REVISION_CONFLICT');
    if (expectedDigest === null) {
      // Exclusive first creation must not replace a dangling link or an entry
      // created after the absence check. A crash before unlink leaves a
      // visible multi-link hold, not a reason to reset state or dispatch.
      fs.linkSync(temporary, filename); fs.unlinkSync(temporary);
    } else fs.renameSync(temporary, filename);
    // Flush the new file before transport. Directory fsync is additionally
    // supported on POSIX; Windows power-loss durability is not claimed tested.
    const committed = fs.openSync(filename, 'r+');
    try { fs.fsyncSync(committed); } finally { fs.closeSync(committed); }
    if (process.platform !== 'win32') { const dir = fs.openSync(root, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
  }
  const store = {
    initialize() {
      return exclusive(owned => {
        if (stateEntry() !== null) model.fail('RECOVERY_NOTIFICATION_STATE_ALREADY_EXISTS_DO_NOT_RESET');
        const state = model.createInitialState(monitorId); write(state, null, owned); return model.clone(state);
      });
    },
    transaction(fn) {
      return exclusive(owned => {
        let current = read();
        const commit = (candidate, expectedRevision) => {
          if (expectedRevision !== current.state.revision || candidate.revision !== expectedRevision) model.fail('RECOVERY_NOTIFICATION_REVISION_CONFLICT');
          model.assertAdvance(current.state, candidate);
          const next = model.clone(candidate); next.revision++;
          if (!Number.isSafeInteger(next.revision)) model.fail('RECOVERY_NOTIFICATION_HISTORY_REVIEW_REQUIRED');
          write(next, current.digest, owned); current = read(); return model.clone(current.state);
        };
        return fn(model.clone(current.state), commit);
      });
    },
    readState() { return store.transaction(state => state); },
  };
  stores.add(store); return Object.freeze(store);
}
module.exports = { openNotificationStore, resolveLocalDirectory, assertPlainPath, isNotificationStore: value => stores.has(value) };
