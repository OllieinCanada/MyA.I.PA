'use strict';
// Recovery reads never initialize or replace a missing/unreadable store.
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const NAMES = Object.freeze(['pending-stripe-signups.json', 'trial-reminders.json', 'signup-dashboard.json', 'vapi-call-sync.json']);
class RecoveryStoreReadError extends Error {
  constructor(store, code) {
    super(`Recovery store ${store} unavailable (${code})`);
    this.name = 'RecoveryStoreReadError'; this.code = code; this.status = 503; this.statusCode = 503;
  }
}
function readRecoveryFileStore(filePath, { io = fs, maxBytes = 8 * 1024 * 1024 } = {}) {
  const store = path.basename(filePath);
  const fail = code => { throw new RecoveryStoreReadError(NAMES.includes(store) ? store : 'unrecognized', code); };
  if (!NAMES.includes(store) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) fail('RECOVERY_STORE_INPUT_INVALID');
  let fd;
  try {
    const before = io.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink()) fail('RECOVERY_STORE_REGULAR_FILE_REQUIRED');
    if (before.size > maxBytes) fail('RECOVERY_STORE_TOO_LARGE');
    fd = io.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = io.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail('RECOVERY_STORE_CHANGED_DURING_READ');
    const bytes = Buffer.alloc(maxBytes + 1);
    let total = 0, count;
    do { count = io.readSync(fd, bytes, total, bytes.length - total, null); total += count; } while (count > 0 && total < bytes.length);
    if (total > maxBytes) fail('RECOVERY_STORE_TOO_LARGE');
    const after = io.fstatSync(fd), current = io.lstatSync(filePath);
    if (after.size !== total || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino) fail('RECOVERY_STORE_CHANGED_DURING_READ');
    let parsed;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))); }
    catch { fail('RECOVERY_STORE_JSON_INVALID'); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('RECOVERY_STORE_OBJECT_REQUIRED');
    return parsed;
  } catch (error) {
    if (error instanceof RecoveryStoreReadError) throw error;
    fail(error?.code === 'ENOENT' ? 'RECOVERY_STORE_MISSING' : 'RECOVERY_STORE_READ_FAILED');
  } finally {
    if (fd !== undefined) { try { io.closeSync(fd); } catch { fail('RECOVERY_STORE_CLOSE_FAILED'); } }
  }
}
module.exports = { NAMES, RecoveryStoreReadError, readRecoveryFileStore };
