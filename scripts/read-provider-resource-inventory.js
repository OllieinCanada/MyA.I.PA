const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { writeManifest } = require('./provider-hardening-evidence');
const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
async function main() {
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: 'srv-d92503a8qa3s73crdpog', keys: ['VAPI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] });
  async function get(url, authorization) {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('Resource inventory HTTP ' + response.status);
    return response.json();
  }
  const [phones, assistants, twilio] = await Promise.all([
    get('https://api.vapi.ai/phone-number?limit=1000', 'Bearer ' + env.VAPI_API_KEY),
    get('https://api.vapi.ai/assistant?limit=1000', 'Bearer ' + env.VAPI_API_KEY),
    get('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers.json?PageSize=1000',
      'Basic ' + Buffer.from(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN).toString('base64')),
  ]);
  if (!Array.isArray(phones) || !Array.isArray(assistants) || !Array.isArray(twilio.incoming_phone_numbers)) throw Error('Resource inventory shape unconfirmed');
  const owned = new Set(twilio.incoming_phone_numbers.map(x => x.phone_number));
  const assistantIds = new Set(assistants.map(x => x.id));
  const host = raw => { try { return new URL(raw).hostname; } catch (_) { return null; } };
  const bindings = phones.map(phone => ({ phoneFingerprint: digest(phone.id), last4: String(phone.number || '').slice(-4), provider: phone.provider,
    ownedBySelectedTwilioAccount: phone.provider === 'twilio' ? owned.has(phone.number) : null,
    directAssistantPresent: phone.assistantId ? assistantIds.has(phone.assistantId) : null,
    dynamicRouteHost: host(phone.server?.url || phone.serverUrl),
    explicitlyMarkedStagingIntake: assistants.some(a => a.id === phone.assistantId && a.metadata?.synthetic === true && a.metadata?.purpose === 'staging-intake') }));
  const report = { checkedAt: new Date().toISOString(), mode: 'GET-only-resource-snapshot',
    counts: { twilioNumbers: owned.size, vapiPhones: phones.length, vapiAssistants: assistants.length },
    pagination: { twilioComplete: !twilio.next_page_uri, vapiRequestedLimit: 1000, vapiPhoneRows: phones.length,
      vapiAssistantRows: assistants.length, limitation: 'Provider lists are snapshots; CRM lifecycle ownership and staging release parity are not certified by these API lists.' },
    bindings, dedicatedStagingIntakePhonesObserved: bindings.filter(x => x.explicitlyMarkedStagingIntake).length,
    liveCanaryApproved: false, providerWrites: 0,
    limitations: ['Never repurpose a customer number or assistant based on a name or missing mapping.', 'Real canary still requires funded accounts and an existing isolated environment with this exact code.'] };
  const output = path.resolve(__dirname, '../diagnostics/provider-hardening/provider-resources.json'); writeManifest(output, report);
  console.log(JSON.stringify({ checkedAt: report.checkedAt, counts: report.counts,
    twilioOwnershipMismatches: bindings.filter(x => x.ownedBySelectedTwilioAccount === false).length,
    missingDirectAssistants: bindings.filter(x => x.directAssistantPresent === false).length,
    dedicatedStagingIntakePhonesObserved: report.dedicatedStagingIntakePhonesObserved, providerWrites: 0, liveCanaryApproved: false }, null, 2));
}
if (require.main === module) main().catch(error => { console.error('Read-only inventory stopped: ' + error.message); process.exitCode = 1; });
