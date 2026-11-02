'use strict';
// Metadata-only boundary, not an OS sandbox. The caller must independently
// verify that drive letters/mounts are local and the host/ancestors are trusted.
// Node cannot prevent hostile same-account ancestor swaps or inspect every
// platform-specific reparse/mount type. No network-share probe is performed.
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const MAX_BYTES = 2 * 1024 * 1024;
class MetadataIOError extends Error {
  constructor(code) { super(code); this.name = 'MetadataIOError'; this.code = code; }
}
const fail = code => { throw new MetadataIOError('LOCAL_METADATA_' + code); };

function lexicalPath(value, platform = process.platform) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  const windows = platform === 'win32', api = windows ? path.win32 : path.posix;
  if (windows) {
    if (!/^[a-z]:[\\/]/i.test(value) || /[:<>"|?*]/.test(value.slice(2))) fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  } else if (!value.startsWith('/') || value.startsWith('//') || /[\\:]/.test(value) || /^\/(?:dev|proc|sys)(?:\/|$)/.test(value)) fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  const root = api.parse(value).root, parts = value.slice(root.length).split(windows ? /[\\/]/ : /\//);
  if (!parts.length || parts.length > 128 || parts.some(part => !part || part === '.' || part === '..' || part.length > 255
    || (windows && (/[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) fail('UNAMBIGUOUS_DEDICATED_PATH_REQUIRED');
  const normalized = api.normalize(value);
  if (!api.isAbsolute(normalized) || normalized === api.parse(normalized).root) fail('ABSOLUTE_LOCAL_PATH_REQUIRED');
  return normalized;
}

function createMetadataIO({ io = fs, platform = process.platform, maxBytes = MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) fail('BOUNDED_IO_REQUIRED');
  const api = platform === 'win32' ? path.win32 : path.posix, plans = new WeakMap(), directories = new WeakMap();
  const protect = work => (...args) => { try { return work(...args); } catch (error) { if (error instanceof MetadataIOError) throw error; fail('IO_FAILED_NO_RETRY'); } };
  const redirected = stat => stat.isSymbolicLink() || stat.isReparsePoint?.() === true || stat.reparsePoint === true
    || (typeof stat.fileAttributes === 'number' && (stat.fileAttributes & 0x400) !== 0)
    || (typeof stat.fileAttributes === 'bigint' && (stat.fileAttributes & 0x400n) !== 0n);
  const directory = stat => stat.isDirectory() && !redirected(stat);
  const regular = stat => stat.isFile() && !redirected(stat) && stat.nlink === 1n && stat.size >= 0n && stat.size <= BigInt(maxBytes);
  const identity = (left, right) => left.dev === right.dev && left.ino === right.ino;
  const unchanged = (left, right) => identity(left, right) && ['size','nlink','mtimeNs','ctimeNs'].every(key => left[key] === right[key]);
  const stat = filename => io.lstatSync(filename, { bigint: true });
  function ancestors(filename) {
    const ordered = []; let current = api.dirname(filename);
    while (true) { ordered.unshift(current); const parent = api.dirname(current); if (parent === current) break; current = parent; }
    // Stop at the first redirect/non-directory; never touch its descendant.
    for (const parent of ordered) if (!directory(stat(parent))) fail('ANCESTOR_DIRECTORY_REDIRECTED');
  }
  function absent(filename) {
    try { stat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    fail('OUTPUT_ALREADY_EXISTS_DO_NOT_REPLACE');
  }
  function selected(plan, key, kind) {
    const entry = plans.get(plan)?.[key];
    if (!entry || entry.kind !== kind) fail('VALIDATED_PATH_PLAN_REQUIRED');
    return entry.path;
  }
  const prepare = entries => {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.keys(entries).length) fail('PATH_ARGUMENTS_REQUIRED');
    const result = {}, seen = new Set();
    // Complete all lexical checks before the first possible filesystem call.
    for (const [key, entry] of Object.entries(entries)) {
      if (!/^[a-z][a-z-]*$/.test(key) || !entry || !['input','output-dir','output-file'].includes(entry.kind)) fail('PATH_ARGUMENTS_REQUIRED');
      const filename = lexicalPath(entry.path, platform), comparison = platform === 'win32' ? filename.toLowerCase() : filename;
      if (seen.has(comparison)) fail('INPUT_OUTPUT_PATHS_MUST_BE_DISTINCT');
      seen.add(comparison); result[key] = { path: filename, kind: entry.kind };
    }
    const plan = Object.freeze({}); plans.set(plan, result); return plan;
  };
  const readJson = protect((plan, key) => {
    const filename = selected(plan, key, 'input'); ancestors(filename);
    const before = stat(filename); if (!regular(before)) fail('BOUNDED_PLAIN_INPUT_REQUIRED');
    let fd, bytes;
    try {
      fd = io.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = io.fstatSync(fd, { bigint: true });
      if (!regular(opened) || !unchanged(before, opened)) fail('INPUT_CHANGED_DURING_READ');
      const buffer = Buffer.alloc(Number(opened.size) + 1); let total = 0;
      while (total < buffer.length) {
        const count = io.readSync(fd, buffer, total, buffer.length - total, null);
        if (!Number.isSafeInteger(count) || count < 0 || count > buffer.length - total) fail('INPUT_READ_INVALID');
        if (count === 0) break; total += count;
      }
      const after = io.fstatSync(fd, { bigint: true }); ancestors(filename); const current = stat(filename);
      if (total > maxBytes || BigInt(total) !== opened.size || !regular(after) || !regular(current)
        || !unchanged(opened, after) || !unchanged(opened, current)) fail('INPUT_CHANGED_DURING_READ');
      bytes = buffer.subarray(0, total);
    } finally { if (fd !== undefined) io.closeSync(fd); }
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INPUT_JSON_OR_ENCODING_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INPUT_OBJECT_REQUIRED');
    return { value, bytes };
  });
  function write(filename, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OUTPUT_OBJECT_REQUIRED');
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    if (bytes.length > maxBytes) fail('BOUNDED_OUTPUT_REQUIRED');
    ancestors(filename); absent(filename);
    let fd;
    try {
      fd = io.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      const opened = io.fstatSync(fd, { bigint: true }); if (!regular(opened)) fail('PLAIN_OUTPUT_REQUIRED');
      io.writeFileSync(fd, bytes); io.fsyncSync(fd);
      const after = io.fstatSync(fd, { bigint: true }); ancestors(filename); const current = stat(filename);
      if (!regular(after) || !regular(current) || !identity(opened, after) || !unchanged(after, current) || after.size !== BigInt(bytes.length)) fail('OUTPUT_CHANGED_REQUIRES_REVIEW');
    } finally { if (fd !== undefined) io.closeSync(fd); }
  }
  const createDirectory = protect((plan, key) => {
    const filename = selected(plan, key, 'output-dir'); ancestors(filename); absent(filename);
    io.mkdirSync(filename, { mode: 0o700 });
    const created = stat(filename); if (!directory(created)) fail('OUTPUT_DIRECTORY_REDIRECTED');
    const handle = Object.freeze({}); directories.set(handle, { path: filename, identity: created }); return handle;
  });
  const writeJsonInDirectory = protect((handle, name, value) => {
    const entry = directories.get(handle);
    if (!entry || typeof name !== 'string' || !/^[a-z][a-z-]*\.json$/.test(name)) fail('OWNED_OUTPUT_DIRECTORY_REQUIRED');
    ancestors(entry.path); const current = stat(entry.path);
    if (!directory(current) || !identity(entry.identity, current)) fail('OUTPUT_DIRECTORY_CHANGED');
    write(api.join(entry.path, name), value);
  });
  return Object.freeze({ prepare, readJson, createDirectory, writeJsonInDirectory,
    writeJson: protect((plan, key, value) => write(selected(plan, key, 'output-file'), value)) });
}
module.exports = { MAX_BYTES, lexicalPath, createMetadataIO, MetadataIOError };
