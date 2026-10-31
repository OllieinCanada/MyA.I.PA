// Pure policy helpers. No credential loading, network, database, or filesystem access.
const crypto = require('node:crypto');
const { assertFreshHealth } = require('./provider-hardening-evidence');
const INPUT_FIELDS = new Set(['releaseCommit', 'databaseId', 'serviceId', 'exportId', 'exportCreatedAt', 'maximumSnapshotAgeHours']);
const EXECUTION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function createPlan(input, { now = Date.now(), executionId = crypto.randomUUID() } = {}) {
  if (!input || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) throw Error('Only sanitized recovery identity metadata is accepted; URLs and secrets are forbidden');
  if (!/^[a-f0-9]{40}$/.test(input.releaseCommit || '') || !/^dpg-[a-z0-9-]+$/.test(input.databaseId || '')
    || !/^srv-[a-z0-9]+$/.test(input.serviceId || '') || !EXECUTION_ID.test(executionId)) throw Error('Exact release, source database, service and execution identity required');
  if (typeof input.exportId !== 'string' || !input.exportId.startsWith(input.databaseId + '/')
    || !/^[a-zA-Z0-9/_.:-]+$/.test(input.exportId) || input.exportId.includes('..')
    || input.exportId.length > 240) throw Error('One exact source-database export ID is required');
  const snapshot = Date.parse(input.exportCreatedAt);
  const maximumAge = input.maximumSnapshotAgeHours;
  if (!Number.isFinite(maximumAge) || maximumAge <= 0 || maximumAge > 168) throw Error('Explicit snapshot age policy from greater than zero to 168 hours required; this is not a promised RPO');
  if (!Number.isFinite(snapshot) || snapshot > now + 5000 || now - snapshot > maximumAge * 3600000) throw Error('Selected export is stale, future-dated or has no valid creation time');
  const body = {
    schemaVersion: 1, executionId, createdAt: new Date(now).toISOString(),
    releaseCommit: input.releaseCommit, databaseId: input.databaseId, serviceId: input.serviceId,
    exportId: input.exportId, exportCreatedAt: new Date(snapshot).toISOString(), maximumSnapshotAgeHours: maximumAge,
    mode: 'preparation-only', scope: 'logical-database-only', downloadLimitBytes: 512 * 1024 * 1024,
    fullApplicationRecoveryProven: false, diskStateCovered: false, keyCustodyVerified: false,
    productionRestoreAllowed: false, providerDispatchesAllowed: false, executionAuthorized: false,
  };
  return { ...body, sha256: digest(body) };
}
function validatePlan(plan, { now = Date.now() } = {}) {
  const body = { ...plan }; delete body.sha256;
  if (!plan || digest(body) !== plan.sha256) throw Error('Recovery plan checksum mismatch');
  const createdAt = Date.parse(plan.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now + 5000 || now - createdAt > 3600000) throw Error('A fresh recovery preparation from the last hour is required');
  const rebuilt = createPlan(Object.fromEntries([...INPUT_FIELDS].map(key => [key, plan[key]])), { now: createdAt, executionId: plan.executionId });
  if (rebuilt.sha256 !== plan.sha256) throw Error('Unsupported or modified recovery plan');
  if (now - Date.parse(plan.exportCreatedAt) > plan.maximumSnapshotAgeHours * 3600000) throw Error('Selected export is now stale');
  return plan;
}
function validateExecution(plan, manifest, { now = Date.now() } = {}) {
  validatePlan(plan, { now });
  if (manifest?.executionId !== plan.executionId || manifest?.releaseCommit !== plan.releaseCommit
    || manifest?.createdAt !== plan.createdAt) throw Error('Recovery evidence belongs to a different execution or release');
  assertFreshHealth(manifest, now);
  if (manifest.gates.health.codeIdentity !== plan.releaseCommit) throw Error('Live health evidence is not bound to this exact release');
  return plan;
}
function selectExactExport(rows, plan) {
  if (!Array.isArray(rows)) throw Error('Logical export inventory shape unconfirmed');
  const matching = rows.map(row => row.export || row.postgresExport || row).filter(row => row.id === plan.exportId);
  if (matching.length !== 1 || Date.parse(matching[0].createdAt) !== Date.parse(plan.exportCreatedAt)) throw Error('Exact selected export is missing, ambiguous or has changed; never select a newer substitute');
  const item = matching[0];
  if (item.status && !['available', 'completed', 'complete', 'succeeded', 'success'].includes(String(item.status).toLowerCase())) throw Error('Selected export is not complete');
  const url = new URL(item.url || item.downloadUrl || item.exportUrl || 'invalid:');
  if (url.protocol !== 'https:' || url.hostname !== 'backups.render.com' || url.port || url.username || url.password) throw Error('Unrecognized backup-download origin; URL suppressed');
  return { item, url };
}
function restoreEnvironment(env, secret) {
  return Object.fromEntries(Object.entries({
    PATH: env.PATH, SystemRoot: env.SystemRoot, LOCALAPPDATA: env.LOCALAPPDATA,
    USERDOMAIN: env.USERDOMAIN, USERNAME: env.USERNAME, TEMP: env.TEMP, TMP: env.TMP,
    BACKUP_ENCRYPTION_KEY: secret, DISABLE_LOCAL_ENV_FILES: '1',
  }).filter(([, value]) => value !== undefined));
}
module.exports = { createPlan, validatePlan, validateExecution, selectExactExport, restoreEnvironment };
