// Read-only account verification. In particular, never call the billing
// configuration helper's --save-* modes or infer a payment from a balance.
const fs = require('node:fs');
const path = require('node:path');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { recordGate, writeManifest, assertFreshHealth } = require('./provider-hardening-evidence');
const SERVICE = 'srv-d92503a8qa3s73crdpog';
const DATABASE = 'dpg-d924vjq8qa3s73crd29g-a';
const select = (value, fields) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
function unknownPayment() { return { paymentMethodStatus: 'unverified_dashboard_required', renewalDate: null,
  rechargeStatus: 'unverified_dashboard_required', lastPaymentFailure: 'unverified_dashboard_required' }; }
function makeUsage(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(r => !Number.isFinite(Number(r.centicredits)) || Number(r.centicredits) < 0)) return null;
  return { rollingCredits: rows.reduce((sum, r) => sum + Number(r.centicredits) / 100, 0), days: rows.length,
    from: rows[0].date, to: rows.at(-1).date, billingCycleRemainingCredits: null,
    limitation: 'Rolling usage is not a verified billing-cycle balance or reset date.' };
}
async function collectFunding({ env, credentials, fetchImpl = fetch }) {
  async function get(url, headers) {
    try {
      const r = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (_) { return { status: 'unavailable', body: null }; }
  }
  const renderAuth = { Authorization: `Bearer ${credentials.key}` };
  const twilioAuth = { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}` };
  const makeAuth = { Authorization: `Token ${env.MAKE_AUDIT_API_TOKEN || env.MAKE_API_TOKEN}` };
  const [twilio, usage, vapi, makeOrgs, makeRolling, serviceResult, databaseResult, recoveryResult] = await Promise.all([
    get(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Balance.json`, twilioAuth),
    get(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Usage/Records.json?StartDate=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}&EndDate=${new Date().toISOString().slice(0, 10)}&PageSize=1000`, twilioAuth),
    get('https://api.vapi.ai/org', { Authorization: `Bearer ${env.VAPI_API_KEY}` }),
    get('https://us2.make.com/api/v2/organizations?cols[]=id&cols[]=license&cols[]=serviceName', makeAuth),
    get('https://us2.make.com/api/v2/teams/1609349/usage?organizationTimezone=true', makeAuth),
    get(`${credentials.host}/services/${SERVICE}`, renderAuth),
    get(`${credentials.host}/postgres/${DATABASE}`, renderAuth),
    get(`${credentials.host}/postgres/${DATABASE}/recovery`, renderAuth),
  ]);
  const org = (makeOrgs.body?.organizations || []).find(o => o.id === 5814892);
  const s = serviceResult.body?.service || serviceResult.body;
  const db = databaseResult.body?.postgres || databaseResult.body;
  const usageRows = usage.status === 200 && !usage.body?.next_page_uri ? usage.body?.usage_records : null;
  const price = category => {
    const rows = usageRows?.filter(r => r.category === category && String(r.price_unit).toLowerCase() === 'usd');
    return rows?.length === 1 && Number.isFinite(Number(rows[0].price)) ? Math.abs(Number(rows[0].price)) : null;
  };
  const total = price('totalprice'), rent = price('phonenumbers');
  const variable = total != null && rent != null ? Math.max(0, total - rent) : null;
  const recommendedReserve = variable != null ? Math.round((rent + 7 * variable / 30) * 100) / 100 : null;
  const organizations = Array.isArray(vapi.body) ? vapi.body : [];
  return { checkedAt: new Date().toISOString(), mode: 'GET-only', productionWrites: 0, billingChanges: 0,
    dashboardAccess: 'not_inspected_by_this_api_only_collector',
    providers: {
      twilio: { httpStatus: twilio.status, ...unknownPayment(),
        balance: twilio.status === 200 ? select(twilio.body, ['balance', 'currency']) : null,
        usage: { httpStatus: usage.status, paginationComplete: Boolean(usageRows), last30DaysTotalUsd: total,
          last30DaysNumberRentalUsd: rent, last30DaysVariableUsd: variable },
        recommendation: { reserveUsd: recommendedReserve,
          basis: 'Seven days average variable usage plus one historical month of number rentals; validate the upcoming rental schedule before setting.',
          applied: false } },
      vapi: { httpStatus: vapi.status, ...unknownPayment(),
        organizations: organizations.map(o => ({ id: o.id, ...select(o, ['credits', 'balance', 'creditBalance', 'subscriptionStatus']) })),
        limitation: 'A billing endpoint refusal does not prove that the call API key is invalid, or that credits are exhausted.' },
      render: { httpStatus: serviceResult.status, ...unknownPayment(),
        service: select(s, ['id', 'suspended']), plan: s?.serviceDetails?.plan || null,
        database: { ...select(db, ['id', 'status', 'plan', 'version', 'diskSizeGB', 'highAvailabilityEnabled']),
          externalNetworkAccess: Array.isArray(db?.ipAllowList) ? (db.ipAllowList.length ? 'rules_present_not_changed' : 'disabled') : 'unverified' },
        recovery: { httpStatus: recoveryResult.status,
          ...select(recoveryResult.body, ['status', 'recoveryStatus', 'startsAt', 'earliestRecoveryTime', 'latestRecoveryTime', 'oldestRecoveryTime', 'newestRecoveryTime']),
          availableFieldNames: Object.keys(recoveryResult.body || {}) } },
      make: { httpStatus: makeOrgs.status, ...unknownPayment(), plan: org?.serviceName || null,
        monthlyAllowance: org?.license?.operations ?? null, resetPeriod: org?.license?.restartPeriod || null,
        rollingUsage: makeUsage(makeRolling.body?.data),
        creditWarningRolling30Days: Number(env.PROVIDER_MAKE_30DAY_CREDIT_WARNING) || null },
    },
    liveCanaryFundingVerified: false,
    restrictions: ['Do not change payment methods, auto-reload, plans or paused trials.',
      'Real delivery remains blocked until Vapi credits, relevant account status and dedicated test resources are verified.',
      'Unknown renewal/card/recharge settings remain unverified, not false or healthy.'],
  };
}
async function main() {
  const root = path.resolve(__dirname, '../diagnostics/provider-hardening');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'execution.json'), 'utf8'));
  assertFreshHealth(manifest);
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: SERVICE, keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'VAPI_API_KEY', 'MAKE_AUDIT_API_TOKEN'],
    optionalKeys: ['PROVIDER_MAKE_30DAY_CREDIT_WARNING'] });
  const report = await collectFunding({ env, credentials });
  const evidence = path.join(root, 'funding.json'); writeManifest(evidence, report);
  recordGate(manifest, 'funding', { status: report.liveCanaryFundingVerified ? 'PASS' : 'BLOCKED', evidence,
    prerequisites: ['health'], restrictions: report.restrictions, codeIdentity: manifest.releaseCommit });
  writeManifest(path.join(root, 'execution.json'), manifest);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Funding audit stopped safely; no payment settings changed.'); process.exitCode = 1; });
module.exports = { collectFunding, makeUsage };
