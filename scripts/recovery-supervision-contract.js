// Synthetic proof protocol only. No provider/session/credential fields exist.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { assertPlainPath, resolveLocalDirectory } = require('./recovery-notification-store');
const MODES = Object.freeze(['accept', 'reject', 'hang', 'block', 'accepted-then-hang', 'crash', 'malformed', 'probes']);
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const uuid = new RegExp('^' + UUID + '$');
const eventId = new RegExp('^' + UUID + ':event:[1-9][0-9]{0,15}$');
const episodeId = new RegExp('^' + UUID + ':episode:[1-9][0-9]{0,15}$');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuidValue = value => typeof value === 'string' && uuid.test(value);
function exact(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('SYNTHETIC_SUPERVISION_INPUT_INVALID'); }
function validateMessage(message) {
  exact(message, ['eventId', 'episodeId', 'idempotencyKey', 'channel']);
  if (['eventId','episodeId','idempotencyKey','channel'].some(key => typeof message[key] !== 'string' || message[key].length > 128)) fail('SYNTHETIC_SUPERVISION_MESSAGE_INVALID');
  if (!eventId.test(message.eventId) || !episodeId.test(message.episodeId) || !['telegram','email'].includes(message.channel) || message.idempotencyKey !== `${message.eventId}:${message.channel}`) fail('SYNTHETIC_SUPERVISION_MESSAGE_INVALID');
  return { eventId: message.eventId, episodeId: message.episodeId, idempotencyKey: message.idempotencyKey, channel: message.channel };
}
function readFixture(directory, executionId, { io = fs, platform = process.platform } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix, resolved = resolveLocalDirectory(directory, platform);
  if (!api.basename(resolved).startsWith('recovery-supervision-fixture-') || !uuidValue(executionId)) fail('SYNTHETIC_SUPERVISION_FIXTURE_REQUIRED');
  assertPlainPath(resolved, { io, platform });
  const marker = api.join(resolved, 'synthetic-supervision.json'), stat = io.lstatSync(marker);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) fail('SYNTHETIC_SUPERVISION_MARKER_INVALID');
  let metadata;
  try { metadata = JSON.parse(io.readFileSync(marker, 'utf8')); } catch { fail('SYNTHETIC_SUPERVISION_MARKER_INVALID'); }
  exact(metadata, ['schemaVersion','scope','executionId','realTransportsAllowed']);
  if (metadata.schemaVersion !== 1 || metadata.scope !== 'synthetic-only-no-provider-data' || metadata.executionId !== executionId || metadata.realTransportsAllowed !== false) fail('SYNTHETIC_SUPERVISION_MARKER_INVALID');
  return { directory: resolved, executionId };
}
function validateRequest(request) {
  exact(request, ['syntheticOnly','directory','executionId','mode','timeoutMs','message']);
  if (request.syntheticOnly !== true || !MODES.includes(request.mode) || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 500 || request.timeoutMs > 5000) fail('SYNTHETIC_SUPERVISION_INPUT_INVALID');
  return { syntheticOnly: true, ...readFixture(request.directory,request.executionId), mode: request.mode, timeoutMs: request.timeoutMs, message: validateMessage(request.message) };
}
function workerEnvironment(directory, parent = process.env) {
  const env = Object.fromEntries(['SystemRoot','SYSTEMROOT','windir','WINDIR','ComSpec'].filter(key => typeof parent[key] === 'string').map(key => [key,parent[key]]));
  return { ...env, TEMP: path.dirname(directory), TMP: path.dirname(directory), TMPDIR: path.dirname(directory), NODE_ENV: 'test', RECOVERY_SUPERVISION_SYNTHETIC_ONLY: '1' };
}
function acceptanceFiles(directory) { return fs.readdirSync(directory).filter(name => /^synthetic-acceptance-[a-f0-9-]+\.json$/.test(name)).sort(); }
function recordAcceptance(request) {
  const acceptanceId = crypto.randomUUID(), filename = path.join(request.directory, `synthetic-acceptance-${acceptanceId}.json`);
  const body = { scope:'synthetic-acceptance-only',executionId:request.executionId,acceptanceId,...request.message };
  const descriptor=fs.openSync(filename,'wx',0o600);
  try { fs.writeFileSync(descriptor,JSON.stringify(body)+'\n');fs.fsyncSync(descriptor); } finally {fs.closeSync(descriptor);}
  return acceptanceId;
}
module.exports = { MODES, fail, exact, uuidValue, validateMessage, readFixture, validateRequest, workerEnvironment, acceptanceFiles, recordAcceptance };
