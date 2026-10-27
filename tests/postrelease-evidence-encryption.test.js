const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { output } = require('../scripts/verify-postrelease');
const { sealEvidence } = require('../scripts/postrelease-evidence-envelope');
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const id = 'a'.repeat(24);
function report() { return { schemaVersion: 1, readOnly: true, releaseCommit: 'b'.repeat(40), scope: 'runtime_and_saved_callbacks',
  sync: { status: 'unknown', completedOnRelease: false }, runtime: { activeCriticalCount: 1 },
  sms: { workerStatus: 'unknown', historicalIncidentCount: 0, originalOperationOutcomes: 'unknown',
    providerDeliveryVerified: false, incidentClosurePermitted: false },
  investigation: { schemaVersion: 1, readOnly: true, incidentsTruncated: false, receiptWindowsTruncated: false,
    incidents: [{ id, severity: 'critical', reasonCode: 'PROVIDER_TIMEOUT', remediation: 'needs_user', occurrences: 1 }], receiptWindows: [] } }; }
function open(envelope) {
  const e = envelope.encryptedEvidence;
  const secret = crypto.privateDecrypt({ key: keys.privateKey, oaepHash: 'sha256',
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(e.encryptedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(e.iv, 'base64'));
  decipher.setAAD(Buffer.from('myaipa-postrelease-evidence:v1')); decipher.setAuthTag(Buffer.from(e.authTag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]).toString());
}
test('public workflow defaults never emit detailed incident or receipt metadata', () => {
  const r = output(report(), {}); assert.equal(r.investigation, undefined);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(id)); assert.equal(r.sms.providerDeliveryVerified, false);
});
test('detailed output is authenticated encrypted data decryptable only by the intended task', () => {
  const data = report(); data.investigation.incidents[0].credential = 'PRIVATE_SECRET';
  const sealed = output(data, { INSPECTION_PUBLIC_KEY: publicKey });
  assert.doesNotMatch(JSON.stringify(sealed), /PROVIDER_TIMEOUT|needs_user|PRIVATE_SECRET/);
  const decoded = open(sealed); assert.equal(decoded.investigation.incidents[0].id, id);
  assert.doesNotMatch(JSON.stringify(decoded), /PRIVATE_SECRET/);
  assert.equal(decoded.investigation.providerDeliveryVerified, false);
  sealed.encryptedEvidence.authTag = Buffer.alloc(16).toString('base64'); assert.throws(() => open(sealed));
});
test('invalid, oversized, non-RSA and weak public keys fail without a plaintext fallback', () => {
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const key of ['INVALID', 'x'.repeat(2001), weak, ec, privatePem]) assert.throws(() => output(report(), { INSPECTION_PUBLIC_KEY: key }));
  assert.throws(() => sealEvidence(report(), keys.privateKey));
});
