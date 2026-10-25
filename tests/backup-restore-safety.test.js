const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateTargetUrl, verifyDisposableTarget } = require('../scripts/backup-safety');
const { decryptBackup, copyCounts } = require('../scripts/restore-backup-drill');
const target = 'postgresql://drill:fixture@127.0.0.1:5544/myaipa_restore_drill_aabbccddeeff';
const ticket = () => ({ host: '127.0.0.1', port: '5544', database: 'myaipa_restore_drill_aabbccddeeff', systemIdentifier: '12345', dataDirectory: 'C:/private-fixture/data', createdAt: new Date().toISOString() });
test('production aliases, remote hosts, old tickets and non-drill databases are refused', () => {
  assert.equal(validateTargetUrl(target, ticket()).database, ticket().database);
  assert.throws(() => validateTargetUrl(target, ticket(), target.replace('127.0.0.1', 'localhost') + '?sslmode=prefer'));
  assert.throws(() => validateTargetUrl(target.replace('127.0.0.1', 'remote.example'), ticket()));
  assert.throws(() => validateTargetUrl(target, { ...ticket(), createdAt: new Date(0).toISOString() }));
  assert.throws(() => validateTargetUrl(target.replace('myaipa_restore_drill_aabbccddeeff', 'myaipa'), ticket()));
});
test('a loopback tunnel or existing database cannot bypass server identity and emptiness checks', async () => {
  const client = { query: async sql => ({ rows: sql.includes('try_advisory') ? [{ acquired: true }]
    : sql.includes('pg_control_system') ? [{ database: ticket().database, directory: 'C:/other/data', identifier: '99999' }] : [{ count: 0 }] }) };
  await assert.rejects(verifyDisposableTarget({ client, restoreUrl: target, ticket: ticket() }), /server identity/);
  client.query = async sql => ({ rows: sql.includes('try_advisory') ? [{ acquired: true }]
    : sql.includes('pg_control_system') ? [{ database: ticket().database, directory: ticket().dataDirectory, identifier: '12345' }] : [{ count: 1 }] });
  await assert.rejects(verifyDisposableTarget({ client, restoreUrl: target, ticket: ticket() }), /not empty/);
});
test('backup checksum and authenticated decryption detect tampering without logging contents', () => {
  const secret = 'fixture-encryption-secret-at-least-24-characters';
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update('private fixture'), cipher.final()]);
  const manifest = { encrypted: true, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), encryption: {
    cipher: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') } };
  assert.equal(decryptBackup(bytes, manifest, secret).toString(), 'private fixture');
  assert.throws(() => decryptBackup(Buffer.from('changed'), manifest, secret), /checksum/);
  assert.throws(() => decryptBackup(bytes, manifest, 'different-secret-at-least-24-characters'));
});
test('COPY verification counts records without retaining personal values', () => {
  assert.deepEqual(copyCounts('COPY public."Business" (id, name) FROM stdin;\n1\tFixture\n2\tOther\n\\.\n'), { Business: 2 });
  assert.deepEqual(copyCounts('COPY "public"."Business" ("id", "name") FROM stdin;\n1\tFixture\n\\.\n'), { Business: 1 });
  assert.throws(() => copyCounts('COPY public."Business" (id) FROM stdin;\n1\n'), /incomplete/);
});
