// One approved batch only. Not a worker, auto-refill, or customer-assignment path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BATCH = 'held-365-20261110', CONFIRM = 'BUY_FIVE_HELD_365_20261110';
const marker = i => `myaipa-reserve-held-20261110-${i + 1}`;
function assertHeld(number) {
  if (!number || !/^\+1365\d{7}$/.test(number.phone_number || '')
    || number.capabilities?.voice !== true || (number.capabilities?.sms ?? number.capabilities?.SMS) !== true
    || ['voice_url', 'sms_url', 'voice_fallback_url', 'sms_fallback_url', 'status_callback',
      'voice_application_sid', 'sms_application_sid', 'messaging_service_sid'].some(k => number[k])) {
    throw Error('RESERVE_NOT_VERIFIED_UNROUTED');
  }
}
async function purchaseHeldReserve({ api, load, save, approved }) {
  if (approved !== CONFIRM) throw Error('RESERVE_EXACT_APPROVAL_REQUIRED');
  const account = await api.accountFingerprint();
  let journal = await load();
  if (!journal) {
    journal = { batch: BATCH, account, status: 'prepared', slots: Array.from({ length: 5 }, (_, i) => ({ marker: marker(i), status: 'unattempted' })) };
    await save(journal);
  }
  if (journal.batch !== BATCH || journal.account !== account || journal.slots?.length !== 5
    || journal.slots.some((s, i) => s.marker !== marker(i))) throw Error('RESERVE_JOURNAL_MISMATCH');
  // An uncertain earlier write must never be retried, even after a new process.
  if (journal.slots.some(s => !['unattempted', 'held'].includes(s.status))) throw Error('RESERVE_PRIOR_PURCHASE_UNCERTAIN');
  const price = await api.price();
  if (price.currency !== 'USD' || !Number.isFinite(price.monthly) || price.monthly <= 0 || price.monthly > 1.15) throw Error('RESERVE_PRICE_NOT_APPROVED');
  for (const slot of journal.slots) {
    const inventory = await api.owned();
    if (!inventory.complete) throw Error('RESERVE_INVENTORY_INCOMPLETE');
    const matches = inventory.numbers.filter(n => n.friendly_name === slot.marker);
    if (slot.status === 'held') {
      if (matches.length !== 1 || matches[0].sid !== slot.sid || matches[0].phone_number !== slot.phoneNumber) throw Error('RESERVE_SAVED_NUMBER_MISMATCH');
      assertHeld(matches[0]);
      if (await api.assistantAttached(slot.phoneNumber)) throw Error('RESERVE_ASSISTANT_ATTACHED');
      continue;
    }
    if (matches.length) throw Error('RESERVE_UNJOURNALED_PURCHASE_REQUIRES_REVIEW');
    const freshPrice = await api.price();
    if (freshPrice.currency !== 'USD' || !Number.isFinite(freshPrice.monthly)
      || freshPrice.monthly <= 0 || freshPrice.monthly > 1.15) throw Error('RESERVE_PRICE_NOT_APPROVED');
    const owned = new Set(inventory.numbers.map(n => n.phone_number));
    const candidates = await api.available();
    const candidate = candidates.find(n => /^\+1365\d{7}$/.test(n.phone_number || '') && !owned.has(n.phone_number)
      && n.capabilities?.voice === true && (n.capabilities?.sms ?? n.capabilities?.SMS) === true
      && (!n.address_requirements || n.address_requirements === 'none'));
    if (!candidate) throw Error('RESERVE_365_INVENTORY_UNAVAILABLE');
    if (await api.assistantAttached(candidate.phone_number)) throw Error('RESERVE_CANDIDATE_ALREADY_ATTACHED');
    Object.assign(slot, { status: 'dispatching', phoneNumber: candidate.phone_number, dispatchedAt: new Date().toISOString() });
    await save(journal); // durable BEFORE the only paid API call for this slot
    try {
      const bought = await api.buy({ phoneNumber: slot.phoneNumber, friendlyName: slot.marker });
      if (!/^PN[a-fA-F0-9]{32}$/.test(bought.sid || '')) throw Error('RESERVE_PURCHASE_ACK_UNVERIFIED');
      slot.sid = bought.sid; slot.status = 'purchased_unverified'; await save(journal);
      const number = await api.number(slot.sid);
      assertHeld(number);
      if (number.phone_number !== slot.phoneNumber || number.friendly_name !== slot.marker) throw Error('RESERVE_PURCHASE_MISMATCH');
      if (await api.assistantAttached(slot.phoneNumber)) throw Error('RESERVE_ASSISTANT_ATTACHED');
      Object.assign(slot, { status: 'held', monthlyUSD: price.monthly, verifiedAt: new Date().toISOString() });
      await save(journal);
    } catch {
      slot.status = 'uncertain_or_unverified'; await save(journal);
      throw Error('RESERVE_STOPPED_INSPECT_SAVED_SLOT_DO_NOT_RETRY');
    }
  }
  journal.status = 'held'; journal.assignmentAuthorized = false; await save(journal);
  return { batch: BATCH, held: journal.slots.length, monthlyUSD: price.monthly * 5,
    last4: journal.slots.map(s => s.phoneNumber.slice(-4)), assigned: 0, assistantImports: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !a.startsWith('--file=') && !a.startsWith('--confirm='))) throw Error('Unexpected reserve argument');
  if (args.filter(a => a.startsWith('--file=')).length !== 1 || args.filter(a => a.startsWith('--confirm=')).length !== 1) throw Error('Exact file and confirmation required');
  const file = path.resolve(args.find(a => a.startsWith('--file=')).slice(7));
  const approved = args.find(a => a.startsWith('--confirm=')).slice(10);
  if (!path.isAbsolute(args.find(a => a.startsWith('--file=')).slice(7)) || approved !== CONFIRM) throw Error('Absolute evidence file and exact approval required');
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.VAPI_API_KEY) throw Error('Required in-memory provider credentials missing');
  const account = process.env.TWILIO_ACCOUNT_SID;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${account}`;
  async function request(url, options = {}) {
    const target = new URL(url);
    if (!['https://api.twilio.com', 'https://pricing.twilio.com', 'https://api.vapi.ai'].includes(target.origin)) throw Error('Unexpected provider destination');
    const auth = target.origin === 'https://api.vapi.ai' ? `Bearer ${process.env.VAPI_API_KEY}`
      : 'Basic ' + Buffer.from(account + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
    const r = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: auth, ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) } });
    if (!r.ok) throw Error('Provider HTTP ' + r.status); // never print body/headers
    return r.json();
  }
  const api = {
    accountFingerprint: async () => crypto.createHash('sha256').update(account).digest('hex'),
    price: async () => { const d = await request('https://pricing.twilio.com/v1/PhoneNumbers/Countries/CA');
      const p = (d.phone_number_prices || []).filter(x => x.number_type === 'local');
      if (p.length !== 1) throw Error('Local pricing ambiguous'); return { currency: d.price_unit, monthly: Number(p[0].current_price) }; },
    owned: async () => { const d = await request(base + '/IncomingPhoneNumbers.json?PageSize=1000');
      return { complete: !d.next_page_uri, numbers: d.incoming_phone_numbers || [] }; },
    available: async () => (await request(base + '/AvailablePhoneNumbers/CA/Local.json?AreaCode=365&VoiceEnabled=true&SmsEnabled=true&ExcludeAllAddressRequired=true&PageSize=100')).available_phone_numbers || [],
    buy: async ({ phoneNumber, friendlyName }) => request(base + '/IncomingPhoneNumbers.json', {
      method: 'POST', body: new URLSearchParams({ PhoneNumber: phoneNumber, FriendlyName: friendlyName,
        VoiceUrl: '', SmsUrl: '', VoiceFallbackUrl: '', SmsFallbackUrl: '', StatusCallback: '', VoiceApplicationSid: '', SmsApplicationSid: '' }).toString() }),
    number: sid => request(base + '/IncomingPhoneNumbers/' + encodeURIComponent(sid) + '.json'),
    assistantAttached: async phone => { const d = await request('https://api.vapi.ai/phone-number?limit=1000');
      if (!Array.isArray(d) || d.length >= 1000) throw Error('Vapi inventory coverage unproven');
      return d.some(n => String(n.number || '').replace(/[^\d+]/g, '') === phone); },
  };
  // Local one-shot operation lock; never delete a lock created by another run.
  const lock = file + '.lock'; let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); } catch { throw Error('Reserve lock exists or is inaccessible; inspect, do not delete'); }
  const save = async journal => {
    const tmp = file + '.new'; let fd;
    try { fd = fs.openSync(tmp, 'wx'); fs.writeFileSync(fd, JSON.stringify(journal, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  try {
    const result = await purchaseHeldReserve({ api, approved, load: async () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null, save });
    console.log(JSON.stringify(result, null, 2));
  } finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { purchaseHeldReserve, assertHeld, CONFIRM };
