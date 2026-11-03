// Offline preparation only. No provider SDK, credential reader, application import or execution capability.
const crypto = require('node:crypto');
const path = require('node:path');
const COMMIT = /^[a-f0-9]{40}$/;
const REFERENCE = /^ref-[a-z0-9][a-z0-9-]{0,75}$/;
const RESOURCE_FIELDS = ['stripeAccountRef', 'stripePriceRef', 'webhookEndpointRef', 'webhookSecretRef', 'tenantARef', 'tenantBRef', 'auditSinkRef'];
const REVIEW_FIELDS = ['ownerScopeRef', 'participantOptInRef', 'resourceOwnershipRef', 'cleanupProcedureRef', 'applicationRoutesRef'];
function ensure(condition, code) { if (!condition) throw Error(code); }
function exact(value, fields) {
  ensure(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'EXACT_PREPARATION_FIELDS_REQUIRED');
}
function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function localPath(input, { platform = process.platform, pathApi = path } = {}) {
  // Lexical checks precede filesystem access. Drive letters can still be mapped;
  // local physical-volume ownership and a non-hostile host remain assumptions.
  ensure(typeof input === 'string' && input.length <= 4096 && !/[\x00-\x1f]/.test(input)
    && !/^[\\/]{2}/.test(input) && pathApi.isAbsolute(input), 'EXPLICIT_LOCAL_ABSOLUTE_PATH_REQUIRED');
  if (platform === 'win32') {
    ensure(/^[a-z]:[\\/]/i.test(input) && !input.slice(2).includes(':'), 'LOCAL_DRIVE_PATH_NO_DEVICE_OR_ADS_REQUIRED');
    for (const component of input.slice(3).split(/[\\/]/).filter(Boolean)) {
      if (component === '.' || component === '..') continue;
      ensure(!/[. ]$/.test(component) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component), 'LOCAL_DRIVE_PATH_NO_DEVICE_OR_ADS_REQUIRED');
    }
  } else ensure(!input.includes(':'), 'LOCAL_PATH_NO_DEVICE_OR_STREAM_REQUIRED');
  const resolved = pathApi.resolve(input);
  ensure(!/^[\\/]{2}/.test(resolved) && (platform !== 'win32' || /^[a-z]:[\\/]/i.test(resolved)), 'EXPLICIT_LOCAL_ABSOLUTE_PATH_REQUIRED');
  return resolved;
}
function plainAncestors(target, { io, pathApi = path }) {
  const parents = [];
  for (let cursor = pathApi.dirname(target);; cursor = pathApi.dirname(cursor)) {
    parents.push(cursor); if (pathApi.dirname(cursor) === cursor) break;
  }
  // Never inspect a child until its parent was checked as a plain directory.
  for (const parent of parents.reverse()) {
    const stat = io.lstatSync(parent);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'LOCAL_PATH_ANCESTOR_REDIRECTED');
  }
}
function template(releaseCommit) {
  ensure(typeof releaseCommit === 'string' && COMMIT.test(releaseCommit), 'EXACT_RELEASE_STRING_REQUIRED');
  return {
    schemaVersion: 1, scope: 'isolated-test-preparation-only', releaseCommit, executionAuthorized: false,
    environment: { appOrigin: null, databaseRef: null, secretStoreRef: null, dataset: 'synthetic-only', stripeMode: 'test', productionShared: false, workersEnabled: false },
    resources: Object.fromEntries(RESOURCE_FIELDS.map(key => [key, null])),
    participants: { telegramRecipientRef: null, emailRecipientRef: null },
    review: Object.fromEntries(REVIEW_FIELDS.map(key => [key, null])),
    bounds: { startsAt: null, endsAt: null, cleanupDueAt: null, budgetUsdCents: null, maxStripeTestObjects: null, maxPrivateAlertMessages: 2, customerCalls: 0, customerTexts: 0, stopStartMessages: 0 },
  };
}
function prepare(value, { now = Date.now() } = {}) {
  exact(value, ['schemaVersion', 'scope', 'releaseCommit', 'executionAuthorized', 'environment', 'resources', 'participants', 'review', 'bounds']);
  ensure(value.schemaVersion === 1 && value.scope === 'isolated-test-preparation-only' && typeof value.releaseCommit === 'string' && COMMIT.test(value.releaseCommit), 'EXACT_PREPARATION_SCOPE_AND_RELEASE_REQUIRED');
  ensure(value.executionAuthorized === false, 'PREPARATION_CANNOT_AUTHORIZE_EXECUTION');
  const env = value.environment, bounds = value.bounds;
  exact(env, ['appOrigin', 'databaseRef', 'secretStoreRef', 'dataset', 'stripeMode', 'productionShared', 'workersEnabled']);
  ensure(env.dataset === 'synthetic-only' && env.stripeMode === 'test' && env.productionShared === false && env.workersEnabled === false, 'DEDICATED_SYNTHETIC_TEST_ENVIRONMENT_REQUIRED');
  exact(value.resources, RESOURCE_FIELDS); exact(value.participants, ['telegramRecipientRef', 'emailRecipientRef']); exact(value.review, REVIEW_FIELDS);
  exact(bounds, ['startsAt', 'endsAt', 'cleanupDueAt', 'budgetUsdCents', 'maxStripeTestObjects', 'maxPrivateAlertMessages', 'customerCalls', 'customerTexts', 'stopStartMessages']);
  ensure(bounds.maxPrivateAlertMessages === 2 && bounds.customerCalls === 0 && bounds.customerTexts === 0 && bounds.stopStartMessages === 0, 'NO_CUSTOMER_CONTACT_AND_BOUNDED_PRIVATE_ALERT_PLAN_REQUIRED');
  const missing = [];
  function reference(input, field) {
    if (input === null) { missing.push(field); return; }
    ensure(typeof input === 'string' && REFERENCE.test(input), 'OPAQUE_REFERENCES_ONLY_NO_SECRET_OR_CONTACT_VALUES');
  }
  reference(env.databaseRef, 'environment.databaseRef'); reference(env.secretStoreRef, 'environment.secretStoreRef');
  for (const key of RESOURCE_FIELDS) reference(value.resources[key], `resources.${key}`);
  for (const key of ['telegramRecipientRef', 'emailRecipientRef']) reference(value.participants[key], `participants.${key}`);
  for (const key of REVIEW_FIELDS) reference(value.review[key], `review.${key}`);
  if (env.appOrigin === null) missing.push('environment.appOrigin');
  else {
    ensure(typeof env.appOrigin === 'string', 'DEDICATED_APP_ORIGIN_REQUIRED');
    let url; try { url = new URL(env.appOrigin); } catch { throw Error('DEDICATED_APP_ORIGIN_REQUIRED'); }
    ensure(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      && !/(^|\.)myaipa\.ca$/i.test(url.hostname)
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      && !['example.invalid', 'api.stripe.com'].includes(url.hostname), 'DEDICATED_APP_ORIGIN_REQUIRED');
  }
  if (value.resources.tenantARef !== null && value.resources.tenantBRef !== null) ensure(value.resources.tenantARef !== value.resources.tenantBRef, 'TWO_DISTINCT_SYNTHETIC_TENANTS_REQUIRED');
  for (const key of ['startsAt', 'endsAt', 'cleanupDueAt']) {
    if (bounds[key] === null) missing.push(`bounds.${key}`);
    else ensure(timestamp(bounds[key]), 'EXACT_UTC_WINDOW_REQUIRED');
  }
  if ([bounds.startsAt, bounds.endsAt, bounds.cleanupDueAt].every(timestamp)) {
    const [start, end, cleanup] = [bounds.startsAt, bounds.endsAt, bounds.cleanupDueAt].map(Date.parse);
    ensure(Number.isFinite(now) && start >= now && end > start && end - start <= 30 * 60000 && cleanup >= end && cleanup - end <= 3600000, 'BOUNDED_FUTURE_WINDOW_AND_CLEANUP_REQUIRED');
  }
  for (const [key, maximum] of [['budgetUsdCents', 500], ['maxStripeTestObjects', 100]]) {
    if (bounds[key] === null) missing.push(`bounds.${key}`);
    else ensure(Number.isSafeInteger(bounds[key]) && bounds[key] >= (key === 'maxStripeTestObjects' ? 1 : 0) && bounds[key] <= maximum, 'EXACT_NONNEGATIVE_BUDGET_AND_OBJECT_LIMIT_REQUIRED');
  }
  const metadataSha256 = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    schemaVersion: 1, scope: 'isolated-test-preparation-only', releaseCommit: value.releaseCommit,
    metadataComplete: missing.length === 0, missing, metadataSha256,
    executionAllowed: false, readyToShip: false, approvalAuthenticated: false, environmentOwnershipVerified: false,
    testsPrepared: {
      stripeProvider: ['Explicit test account and price; no production fallbacks.', 'Five provider clock cycles with paid renewal/effective cancellation; count every temporary object.', 'Unknown create/cleanup outcomes stop the exercise; inspect exact IDs, do not blindly recreate.'],
      checkoutAndAccess: ['Dedicated hosted TEST Checkout and correctly verified signed webhook.', 'Reject unauthenticated, tampered/expired session, cross-tenant customer/subscription and duplicate/out-of-order deliveries.', 'Canceled/late setup cannot resume service; failed/open invoice cannot claim paid readiness.'],
      privacy: ['Exercise actual application handlers with two synthetic tenants, not standalone arrays.', 'Access/correction/export must not reveal the other tenant; enforce reviewed authority and legal-hold decisions.', 'Erasure must retain opt-out/no-resend protection; restore replay must not resurrect deleted data.', 'Provider-held deletion/retention is a separate approved exercise, not established here.'],
      privateAlerts: ['At most one logical alert per approved private channel; no customer calls/texts or STOP/START.', 'Distinguish acceptance, held unknown outcome and independently confirmed recipient receipt.', 'Duplicate/restart delivery must not resend an uncertain accepted attempt.'],
      cleanup: ['Use execution-owned test resources only; never delete production/customer resources.', 'Preserve sanitized object inventory and receipt digests; confirm each cleanup result.', 'Unknown cleanup remains open; preparation must not emit a passing provider gate.'],
    },
    separateUnresolvedGates: ['Phone-only Vapi confirmation remains waiting on provider contract; no browser alternative or old-call replay.', 'Physical Safari listening is unverified; automated WebKit is not device proof.', '163 legal placeholders were reported in dated private evidence; no fresh legal scan, completion or owner/counsel approval is inferred.', 'No live environment, participant, budget/window, funding, cleanup or execution approval is granted by metadata completeness.'],
    effects: { networkRequests: 0, credentialsLoaded: 0, stripeObjectsCreated: 0, providerMutations: 0, messagesOrCalls: 0, schedulesInstalled: 0 },
  };
}
function main(args = process.argv.slice(2), { io = require('node:fs'), platform = process.platform, pathApi = path } = {}) {
  const fs = require('node:fs');
  const get = key => args.filter(arg => arg.startsWith(`--${key}=`));
  ensure(args.every(arg => arg === '--template' || /^--(commit|input|out-dir)=.+$/.test(arg)), 'LOCAL_PREPARATION_ARGUMENTS_ONLY');
  ensure(get('out-dir').length === 1, 'NEW_ABSOLUTE_OUTPUT_DIRECTORY_REQUIRED');
  const output = localPath(get('out-dir')[0].slice(10), { platform, pathApi });
  ensure(output !== pathApi.parse(output).root, 'NEW_DEDICATED_OUTPUT_DIRECTORY_REQUIRED');
  let input, inputFile = null;
  if (args.includes('--template')) {
    ensure(args.filter(x => x === '--template').length === 1 && get('commit').length === 1 && get('input').length === 0, 'ONE_TEMPLATE_RELEASE_REQUIRED');
    input = template(get('commit')[0].slice(9));
  } else {
    ensure(get('input').length === 1 && get('commit').length === 0, 'ONE_LOCAL_INPUT_FILE_REQUIRED');
    inputFile = localPath(get('input')[0].slice(8), { platform, pathApi });
  }
  // Validate every input/output path lexically before the first filesystem call.
  plainAncestors(output, { io, pathApi });
  let absent = false;
  try { io.lstatSync(output); } catch (error) { if (error.code === 'ENOENT') absent = true; else throw error; }
  ensure(absent, 'NEW_DEDICATED_OUTPUT_DIRECTORY_REQUIRED');
  if (inputFile !== null) {
    plainAncestors(inputFile, { io, pathApi });
    const before = io.lstatSync(inputFile);
    const regular = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= 65536;
    ensure(regular(before), 'BOUNDED_PLAIN_METADATA_FILE_REQUIRED');
    const fd = io.openSync(inputFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let bytes;
    try {
      const opened = io.fstatSync(fd); ensure(regular(opened) && opened.dev === before.dev && opened.ino === before.ino, 'METADATA_FILE_CHANGED');
      const buffer = Buffer.alloc(opened.size + 1); let size = 0, count;
      while (size < buffer.length && (count = io.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
      const after = io.fstatSync(fd), current = io.lstatSync(inputFile);
      ensure(regular(after) && regular(current) && size === opened.size
        && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => opened[key] === after[key] && opened[key] === current[key]), 'METADATA_FILE_CHANGED');
      bytes = buffer.subarray(0, size);
    } finally { io.closeSync(fd); }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const report = prepare(input);
  io.mkdirSync(output, { mode: 0o700 });
  plainAncestors(pathApi.join(output, 'plan.json'), { io, pathApi });
  io.writeFileSync(pathApi.join(output, 'plan.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (args.includes('--template')) io.writeFileSync(pathApi.join(output, 'pending-input.json'), JSON.stringify(input, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ scope: report.scope, metadataComplete: report.metadataComplete, missing: report.missing, executionAllowed: false, readyToShip: false }));
  return report;
}
if (require.main === module) { try { main(); } catch { console.error('Offline preparation requires exact sanitized metadata and a new local output directory; nothing was authorized or executed.'); process.exitCode = 1; } }
module.exports = { template, prepare, main, localPath, plainAncestors };
