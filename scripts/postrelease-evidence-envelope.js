const crypto = require('node:crypto');
const AAD = Buffer.from('myaipa-postrelease-evidence:v1');
function sealEvidence(report, publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length > 2000
    || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(publicKey)) throw Error('Invalid inspection public key');
  const key = crypto.createPublicKey(publicKey);
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== 'rsa' || ![3072, 4096].includes(bits)) throw Error('Invalid inspection public key');
  const secret = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(report), 'utf8'), cipher.final()]);
  const encryptedKey = crypto.publicEncrypt({ key, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, secret);
  secret.fill(0);
  return { schemaVersion: 1, encryptedEvidence: { algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    encryptedKey: encryptedKey.toString('base64'), iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') } };
}
module.exports = { sealEvidence };
