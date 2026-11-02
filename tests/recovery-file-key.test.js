const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {REQUIRED_FILES,digest}=require('../scripts/recovery-isolation-contract');
process.env.DISABLE_LOCAL_ENV_FILES='1';process.env.NODE_ENV='test';global.__myAiPaPrisma={};
const {encryptBackup}=require('../scripts/database-backup');
const {decryptBackup}=require('../scripts/restore-backup-drill');
const calendar=require('../server/calendarIntegrations');
// Instrument private pure crypto functions only in this isolated VM; no application source edit.
const jobberModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server/jobberIntegration.js'),'utf8')+'\nmodule.exports.fixtureCrypto={encryptSecret,decryptSecret};',{require,module:jobberModule,process:{env:{}},Buffer,URL,URLSearchParams});
const field=jobberModule.exports.fixtureCrypto;
test('all four synthetic file stores survive authenticated archive encryption and reject tampering or the wrong recovered key',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-key-file-fixture-'));
  const key=crypto.randomBytes(32).toString('hex'); const recoveredKey=String(key); let verified=0;
  try{
    for(const [index,name] of REQUIRED_FILES.entries()){
      const value={fixtureOnly:true,generation:'fixture-generation-1',records:{['fixture-'+index]:{id:index+1,status:'synthetic'}}};
      const raw=path.join(directory,name);fs.writeFileSync(raw,JSON.stringify(value),{flag:'wx',mode:0o600});
      const encrypted=encryptBackup(raw,key);assert.equal(fs.existsSync(raw),false);
      const bytes=fs.readFileSync(encrypted.encryptedPath);const manifest={encrypted:true,encryption:encrypted.encryption,sha256:digest(bytes)};
      const plain=decryptBackup(bytes,manifest,recoveredKey);try{assert.deepEqual(JSON.parse(plain.toString('utf8')),value);}finally{plain.fill(0);}
      assert.throws(()=>decryptBackup(bytes,manifest,'wrong-fixture-key-that-is-at-least-24'));
      const damaged=Buffer.from(bytes);damaged[0]^=1;assert.throws(()=>decryptBackup(damaged,manifest,recoveredKey),/checksum/);verified++;
    }
    assert.equal(verified,4);assert.throws(()=>JSON.parse('{broken fixture JSON'));
  }finally{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('myaipa-key-file-fixture-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
test('actual calendar encryption requires the same recovered version; the current runtime key cannot decrypt an older version',()=>{
  const before=process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  const version1=crypto.randomBytes(32).toString('hex'),version2=crypto.randomBytes(32).toString('hex');
  try{process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=version1;const ciphertext=calendar.encryptSecret('fixture-calendar-token');process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=version2;assert.throws(()=>calendar.decryptSecret(ciphertext));process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=version1;assert.equal(calendar.decryptSecret(ciphertext),'fixture-calendar-token');}
  finally{if(before===undefined)delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=before;}
});
test('actual field-service crypto recovery resolves its calendar fallback and rejects key substitution',()=>{
  const key=crypto.randomBytes(32).toString('hex');const fallback={CALENDAR_TOKEN_ENCRYPTION_KEY:key};
  const ciphertext=field.encryptSecret('fixture-field-token',fallback);assert.equal(field.decryptSecret(ciphertext,{FIELD_SERVICE_TOKEN_ENCRYPTION_KEY:key}),'fixture-field-token');
  assert.throws(()=>field.decryptSecret(ciphertext,{FIELD_SERVICE_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')}));
  assert.throws(()=>field.decryptSecret(ciphertext,{}),/not configured/);
});
