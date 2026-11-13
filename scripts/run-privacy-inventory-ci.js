'use strict';
// Fixed generated-data CI rehearsal only. Never imports server/index or a worker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const nativeSpawn=require('node:child_process').spawnSync,{Worker}=require('node:worker_threads');
const {createPrivacyInventoryPreview,bytes,hash}=require('../server/privacyInventoryPreview');
const {createReadOnlyInventoryReader,requiredSurfaces}=require('../server/privacyInventoryReader');
const ROOT=path.resolve(__dirname,'..'),BASE='8f218834361f5ec22de23c5cedd6690897d40f99';
// Byte-identical relay from reviewed #245 head 81a50f70214e28d6d8579d4c028375e1d7620606.
const RELAY_SHA='948380af82a88da9c1fc4ef128147e6eb70b96e223f5123fa3c504d74a69de4b';
const SOURCES=['server/privacyInventoryPreview.js','server/privacyInventoryReader.js','scripts/run-privacy-inventory-ci.js','scripts/privacy-preview-loopback-relay.js',
 'tests/privacy-inventory-preview.test.js','.github/workflows/privacy-inventory.yml','server/recoveryFileStore.js','scripts/local-staging-egress.js','prisma/schema.prisma','package-lock.json'];
const CHECKS=['owned-pg18-identities-and-select-only-role','actual-shared-tenant-preview','actual-unique-tenant-preview','independent-newer-journal-not-source-payload',
 'caller-payload-cannot-declare-trust','wrong-tenant-subject-refused','absent-current-authority-refused','held-current-authority-refused','incomplete-current-journal-refused',
 'unordered-current-journal-refused','stale-current-attestation-refused','untrusted-key-refused','authority-change-across-read-refused','missing-file-refused',
 'model-file-row-fingerprints-unchanged','provider-transport-probes-refused','live-gates-refuse-partial-proof'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function expected(head){return {head,base:BASE,models:[...fs.readFileSync(path.join(ROOT,'prisma/schema.prisma'),'utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(m=>m[1]),sourceSha256:Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]))};}
function validateEnvironment(env){
 if(process.platform!=='linux'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.RUN_PRIVACY_INVENTORY_CI!=='1'||!/^[a-f0-9]{40}$/.test(env.PRIVACY_INVENTORY_HEAD||''))throw Error('PRIVACY_CI_CONTEXT_REQUIRED');
 if(Object.keys(env).some(k=>env[k]&&(/^(DATABASE_URL|RESTORE_|BACKUP_|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|NODE_OPTIONS|OPERATIONS_ENV_FILE)$/.test(k)||/^(TWILIO_|VAPI_|STRIPE_|MAKE_|TELEGRAM_|SMTP_|RENDER_|OPENAI_|BACKUP_|RESTORE_)/.test(k))))throw Error('PRIVACY_FOREIGN_CONFIGURATION');
 if(['.env','.env.local'].some(n=>fs.existsSync(path.join(ROOT,n))))throw Error('PRIVACY_LOCAL_ENV_FORBIDDEN');
}
function verifyReport(r,p){return /^[a-f0-9]{40}$/.test(p?.head||'')&&r?.head===p.head&&r.base===BASE&&r.scope==='synthetic-readonly-privacy-inventory-ci'
 &&r.passed===true&&r.modelsFingerprinted===36&&r.adapterModels===4&&r.missingSurfaces===36&&r.fileStores===4&&r.ownedDatabases===2
 &&r.sourceSha256&&Object.keys(r.sourceSha256).length===SOURCES.length&&SOURCES.every(f=>r.sourceSha256[f]===p.sourceSha256[f])
 &&Array.isArray(p.models)&&p.models.length===36&&Array.isArray(r.models)&&r.models.length===p.models.length&&new Set(r.models).size===p.models.length&&p.models.every(n=>r.models.includes(n))
 &&Array.isArray(r.modelHashes)&&r.modelHashes.length===p.models.length&&new Set(r.modelHashes.map(m=>m.model)).size===p.models.length
 &&p.models.every(n=>r.modelHashes.some(m=>m.model===n&&Number.isSafeInteger(m.rows)&&m.rows>=0&&/^[a-f0-9]{64}$/.test(m.sourceSha256)&&m.sourceSha256===m.targetSha256))
 &&Array.isArray(r.fileHashes)&&r.fileHashes.length===4&&new Set(r.fileHashes.map(f=>f.name)).size===4&&require('../server/recoveryFileStore').NAMES.every(n=>r.fileHashes.some(f=>f.name===n&&/^[a-f0-9]{64}$/.test(f.sourceSha256)&&f.sourceSha256===f.targetSha256))
 &&Array.isArray(r.checks)&&r.checks.length===CHECKS.length&&new Set(r.checks.map(c=>c.name)).size===CHECKS.length&&CHECKS.every(n=>r.checks.some(c=>c.name===n&&c.passed===true))
 &&r.cleanup?.databasesRemoved===true&&r.cleanup.roleRemoved===true&&r.cleanup.filesRemoved===true&&r.cleanup.unrelatedDatabasesUnchanged===true
 &&r.productionDataUsed===false&&r.providerCallsOrMessages===0&&r.previewMutationQueries===0&&r.workersStarted===false&&r.authorityDatabaseIndependent===true
 &&r.livePrivacyProven===false&&r.liveRecoveryProven===false&&r.productionAuthorityAdapterImplemented===false&&r.osSandboxProven===false;}
async function run(){
 const input={...process.env};validateEnvironment(input);const policy=expected(input.PRIVACY_INVENTORY_HEAD);
 assert.equal(sha(fs.readFileSync(path.join(ROOT,'scripts/privacy-preview-loopback-relay.js'))),RELAY_SHA);
 const kept=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,kept,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',CHECKPOINT_DISABLE:'1'});
 const {Client}=require('pg'),{PrismaClient,Prisma}=require('@prisma/client'),{NAMES}=require('../server/recoveryFileStore');
 const report={scope:'synthetic-readonly-privacy-inventory-ci',...policy,passed:false,checks:[],productionDataUsed:false,providerCallsOrMessages:0,previewMutationQueries:0,
  workersStarted:false,livePrivacyProven:false,liveRecoveryProven:false,productionAuthorityAdapterImplemented:false,osSandboxProven:false,modelsFingerprinted:0,adapterModels:4,missingSurfaces:36,fileStores:4,
  cleanup:{databasesRemoved:false,roleRemoved:false,filesRemoved:false,unrelatedDatabasesUnchanged:false}};
 const check=async(name,work)=>{try{await work();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false});throw e;}};
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'myaipa-privacy-preview-')),owned=new Set();let relay,admin,source,authority,actor,initial,role,createdRole=false,success=false;
 let port;const service={user:'backup_fixture',password:'synthetic-ci-only',database:'myaipa_backup_control_ci'};
 const connect=async database=>{const c=new Client({...service,database,host:'127.0.0.1',port,connectionTimeoutMillis:5000,query_timeout:10000});await c.connect();return c;};
 const use=async(database,work)=>{const c=await connect(database);try{return await work(c);}finally{await c.end();}};
 const inventory=async()=>((await admin.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(r=>r.datname));
 const url=(database,user=service.user,password=service.password)=>`postgresql://${user}:${password}@127.0.0.1:${port}/${database}?connection_limit=2`;
 const fp=async()=>use(source,async c=>{const values=[];for(const m of Prisma.dmmf.datamodel.models){assert.match(m.name,/^[A-Za-z][A-Za-z0-9_]*$/);const rows=(await c.query('SELECT to_jsonb(t) AS r FROM "'+m.name+'" t')).rows.map(x=>x.r);values.push({model:m.name,rows:rows.length,sha256:hash(rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))});}return values;});
 try{
  relay=new Worker(path.join(__dirname,'privacy-preview-loopback-relay.js'));port=await new Promise((resolve,reject)=>{relay.once('message',m=>resolve(m.port));relay.once('error',reject);});
  assert.ok(Number.isInteger(port)&&port>0&&port<65536);admin=await connect(service.database);initial=await inventory();
  const identity=(await admin.query("SELECT current_database() AS db,current_user AS role,current_setting('server_version_num')::int AS version,system_identifier::text AS cluster FROM pg_control_system()")).rows[0];
  assert.equal(identity.db,service.database);assert.equal(identity.role,service.user);assert.ok(identity.version>=180000&&identity.version<190000);report.postgresVersionNumber=identity.version;
  const suffix=crypto.randomBytes(6).toString('hex');source='myaipa_privacy_fixture_'+suffix;authority='myaipa_privacy_authority_'+suffix;
  for(const db of [source,authority]){await admin.query('CREATE DATABASE "'+db+'"');owned.add(db);}
  const pushed=nativeSpawn(process.execPath,[path.join(ROOT,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',path.join(ROOT,'prisma/schema.prisma')],{cwd:ROOT,encoding:'utf8',timeout:120000,env:{...kept,DATABASE_URL:url(source),DISABLE_LOCAL_ENV_FILES:'1',CHECKPOINT_DISABLE:'1'}});assert.equal(pushed.status,0);
  await use(source,async c=>{await c.query("INSERT INTO \"Business\" (id,name,phone,timezone) VALUES(11,'Fictitious A','+15555550111','America/Toronto'),(12,'Fictitious B','+15555550112','America/Toronto'); INSERT INTO \"Caller\" (id,phone) VALUES(21,'+15555550121'),(22,'+15555550122'); INSERT INTO \"Call\" (\"businessId\",\"callerId\",\"startedAt\",status) VALUES(11,21,now(),'COMPLETED'),(12,21,now(),'COMPLETED'),(11,22,now(),'COMPLETED'); INSERT INTO \"Lead\" (\"businessId\",\"callerId\",intent,urgency,summary,\"callbackNumber\",name) VALUES(11,21,'GENERAL','LOW','Fictitious enquiry','+15555550121','Fictitious Person'); INSERT INTO \"SmsSuppression\" (id,\"phoneNumber\",suppressed,source,\"updatedAt\") VALUES('fixture-suppression','+15555550121',true,'fixture',now()); INSERT INTO \"RuntimeStore\" (key,data,\"updatedAt\") VALUES('fixture-stale-backup-journal','{\"throughSequence\":0}',now())");});
  const keys=crypto.generateKeyPairSync('ed25519'),referenceKey=crypto.randomBytes(32),target={businessId:11,callerId:21},unique={businessId:11,callerId:22};
  const ref=t=>crypto.createHmac('sha256',referenceKey).update(bytes(t)).digest('hex');
  const baseline={revision:1,throughSequence:2,journal:[{sequence:1,scopeRef:ref(target),decisionRef:'fixture-invented-one'},{sequence:2,scopeRef:ref(unique),decisionRef:'fixture-invented-two'}],holds:[{scopeRef:ref(target),revision:1,state:'clear'},{scopeRef:ref(unique),revision:1,state:'clear'},
   {scopeRef:ref({businessId:12,callerId:22}),revision:1,state:'clear'}]};
  await use(authority,c=>c.query('CREATE TABLE "FixtureAuthority" (id integer PRIMARY KEY CHECK(id=1),data jsonb NOT NULL)'));
  const setAuthority=async data=>use(authority,async c=>{await c.query('DELETE FROM "FixtureAuthority"');if(data)await c.query('INSERT INTO "FixtureAuthority" VALUES(1,$1::jsonb)',[JSON.stringify(data)]);});await setAuthority(baseline);
  for(const name of NAMES)fs.writeFileSync(path.join(root,name),JSON.stringify({fixture:{businessId:11,callerId:21,syntheticOnly:true}}),{flag:'wx',mode:0o600});
  const fileFp=()=>Object.fromEntries(NAMES.map(n=>[n,sha(fs.readFileSync(path.join(root,n)))])),beforeFiles=fileFp(),before=await fp();report.modelsFingerprinted=before.length;
  role='privacy_read_'+suffix;const password=crypto.randomBytes(24).toString('hex');await admin.query('CREATE ROLE "'+role+'" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD \''+password+'\'');createdRole=true;
  for(const db of owned){await admin.query('GRANT CONNECT ON DATABASE "'+db+'" TO "'+role+'"');await use(db,async c=>{await c.query('GRANT USAGE ON SCHEMA public TO "'+role+'"');await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO "'+role+'"');});}
  actor=new PrismaClient({datasources:{db:{url:url(source,role,password)}},log:[{emit:'event',level:'query'}],__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});await actor.$connect();
  const observer=new Client({host:'127.0.0.1',port,database:authority,user:role,password});await observer.connect();
  const authorityIdentity=(await observer.query('SELECT current_database() AS db,current_user AS role')).rows[0];assert.equal(authorityIdentity.db,authority);assert.notEqual(authorityIdentity.db,source);assert.equal(authorityIdentity.role,role);report.authorityDatabaseIndependent=true;
  const guard=require('./local-staging-egress').install({ports:[port]});
  let queryWrites=0;actor.$on('query',e=>{if(/^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(e.query))queryWrites++;});
  const readInventory=createReadOnlyInventoryReader({prisma:actor,directory:root}),schema=fs.readFileSync(path.join(ROOT,'prisma/schema.prisma'),'utf8');
  let authorityReads=0;
  const authorityReader=async({scopeRef,challenge},adjust=p=>p)=>{authorityReads++;const stored=(await observer.query('SELECT data FROM "FixtureAuthority" WHERE id=1')).rows[0]?.data;
   if(!stored)throw Object.assign(Error('PRIVACY_AUTHORITY_ABSENT'),{code:'PRIVACY_AUTHORITY_ABSENT'});
   const proof=adjust({version:1,authorityId:'fixture-independent-database',scopeRef,challenge,issuedAt:Date.now(),...stored,holds:stored.holds.filter(h=>h.scopeRef===scopeRef)});
   return {proof,signature:crypto.sign(null,bytes(proof),keys.privateKey).toString('base64url')};};
  const config={readInventory,readAuthority:authorityReader,authorityId:'fixture-independent-database',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),referenceKey,requiredSurfaces:requiredSurfaces(schema)};
  const preview=overrides=>createPrivacyInventoryPreview({...config,...overrides});
  try{
   await check('owned-pg18-identities-and-select-only-role',async()=>{const id=(await actor.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role')).at(0);assert.equal(id.db,source);assert.equal(id.role,role);
    await assert.rejects(actor.$executeRawUnsafe('UPDATE "Business" SET name=name'),e=>e.meta?.code==='42501');queryWrites=0;});
   await check('actual-shared-tenant-preview',async()=>{const r=await preview()(target);assert.equal(r.sharedIdentity,true);assert.equal(r.foreignTenantCount,1);assert.equal(r.inventory.length,4);assert.equal(r.coverage.missing.length,36);assert.equal(r.applyAllowed,false);assert.ok(!JSON.stringify(r).includes('+15555550121'));});
   await check('actual-unique-tenant-preview',async()=>{const r=await preview()(unique);assert.equal(r.sharedIdentity,false);assert.equal(r.foreignTenantCount,0);assert.equal(r.inventory.length,2);});
   await check('independent-newer-journal-not-source-payload',async()=>{const prior=authorityReads,r=await preview()(target);assert.equal(authorityReads-prior,2);assert.equal(r.authority.throughSequence,2);const stale=await actor.runtimeStore.findUnique({where:{key:'fixture-stale-backup-journal'}});assert.equal(stale.data.throughSequence,0);});
   await check('caller-payload-cannot-declare-trust',async()=>{await assert.rejects(preview()({...target,journalComplete:true}),e=>e.code==='PRIVACY_TARGET_REQUIRED');});
   await check('wrong-tenant-subject-refused',async()=>{await assert.rejects(preview()({businessId:12,callerId:22}),e=>e.code==='PRIVACY_TARGET_NOT_OWNED');});
   await check('absent-current-authority-refused',async()=>{await setAuthority(null);await assert.rejects(preview()(target),e=>e.code==='PRIVACY_AUTHORITY_ABSENT');await setAuthority(baseline);});
   await check('held-current-authority-refused',async()=>{const v=structuredClone(baseline);v.holds[0].state='held';await setAuthority(v);await assert.rejects(preview()(target),e=>e.code==='PRIVACY_HOLD_NOT_CLEAR');await setAuthority(baseline);});
   await check('incomplete-current-journal-refused',async()=>{const v=structuredClone(baseline);v.journal.pop();await setAuthority(v);await assert.rejects(preview()(target),e=>e.code==='PRIVACY_JOURNAL_INCOMPLETE');await setAuthority(baseline);});
   await check('unordered-current-journal-refused',async()=>{const v=structuredClone(baseline);v.journal.reverse();await setAuthority(v);await assert.rejects(preview()(target),e=>e.code==='PRIVACY_JOURNAL_UNORDERED');await setAuthority(baseline);});
   await check('stale-current-attestation-refused',async()=>{await assert.rejects(preview({readAuthority:x=>authorityReader(x,p=>({...p,issuedAt:Date.now()-60001}))})(target),e=>e.code==='PRIVACY_AUTHORITY_STALE');});
   await check('untrusted-key-refused',async()=>{const other=crypto.generateKeyPairSync('ed25519');await assert.rejects(preview({publicKey:other.publicKey.export({type:'spki',format:'pem'})})(target),e=>e.code==='PRIVACY_AUTHORITY_UNTRUSTED');});
   await check('authority-change-across-read-refused',async()=>{await assert.rejects(preview({readInventory:async t=>{const r=await readInventory(t);const v=structuredClone(baseline);v.revision=2;v.holds.forEach(h=>h.revision=2);await setAuthority(v);return r;}})(target),e=>e.code==='PRIVACY_AUTHORITY_CHANGED');await setAuthority(baseline);});
   await check('missing-file-refused',async()=>{const file=path.join(root,NAMES[0]),saved=fs.readFileSync(file);fs.unlinkSync(file);try{await assert.rejects(preview()(target),e=>e.code==='RECOVERY_STORE_MISSING');}finally{fs.writeFileSync(file,saved,{flag:'wx',mode:0o600});}});
   await check('model-file-row-fingerprints-unchanged',async()=>{const after=await fp(),afterFiles=fileFp();assert.deepEqual(after,before);assert.deepEqual(afterFiles,beforeFiles);assert.equal(queryWrites,0);report.previewMutationQueries=queryWrites;
    report.modelHashes=before.map((m,i)=>({model:m.model,rows:m.rows,sourceSha256:m.sha256,targetSha256:after[i].sha256}));report.fileHashes=NAMES.map(name=>({name,sourceSha256:beforeFiles[name],targetSha256:afterFiles[name]}));});
   await check('provider-transport-probes-refused',async()=>{assert.equal(guard.status().unexpectedOutboundAttempts,0);assert.equal((await guard.probes()).rejected,6);assert.ok(!require.cache[path.join(ROOT,'server/index.js')]);});
   await check('live-gates-refuse-partial-proof',async()=>{const r=await preview()(target),g=require('./launch-evidence');for(const f of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(g[f](r,policy.head),false);});
   success=true;
  }finally{await observer.end();}
 }catch(e){report.failureCode=/^PRIVACY_[A-Z_]+$/.test(e.code||'')?e.code:'PRIVACY_SYNTHETIC_CHECK_FAILED';}
 finally{
  if(actor)await actor.$disconnect().catch(()=>{success=false;});
  try{if(admin){if(createdRole){for(const db of owned)await use(db,c=>c.query('DROP OWNED BY "'+role+'"'));await admin.query('DROP ROLE "'+role+'"');report.cleanup.roleRemoved=(await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n===0;}
   for(const db of owned){assert.match(db,/^myaipa_privacy_(fixture|authority)_[a-f0-9]{12}$/);const owner=(await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[db])).rows[0];assert.equal(owner?.owner,service.user);await admin.query('DROP DATABASE "'+db+'"');}
   report.cleanup.databasesRemoved=true;assert.deepEqual(await inventory(),initial);report.cleanup.unrelatedDatabasesUnchanged=true;await admin.end();}}
  catch{success=false;report.cleanup.error='PRIVACY_OWNED_CLEANUP_FAILED';}
  if(relay)await relay.terminate();
  try{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(require('node:os').tmpdir()));assert.match(path.basename(resolved),/^myaipa-privacy-preview-/);
   for(const name of fs.readdirSync(root)){assert.ok(require('../server/recoveryFileStore').NAMES.includes(name));assert.equal(fs.lstatSync(path.join(root,name)).isFile(),true);fs.unlinkSync(path.join(root,name));}fs.rmdirSync(root);report.cleanup.filesRemoved=!fs.existsSync(root);
  }catch{success=false;report.cleanup.error='PRIVACY_OWNED_FILE_CLEANUP_FAILED';}
  report.ownedDatabases=owned.size;report.passed=success&&Object.values(report.cleanup).every(v=>v===true);
  report.finishedAt=new Date().toISOString();const output=path.join(ROOT,'diagnostics/privacy-inventory-ci/result.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }
 return report;
}
if(require.main===module){if(process.argv[2]==='--verify-evidence'){
 try{const p=expected(process.env.PRIVACY_INVENTORY_HEAD),r=JSON.parse(fs.readFileSync(path.join(ROOT,'diagnostics/privacy-inventory-ci/result.json')));if(!verifyReport(r,p))throw Error();}catch{console.error('PRIVACY_EVIDENCE_REFUSED');process.exitCode=1;}
}else run().then(r=>{console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}).catch(()=>{console.error('PRIVACY_CI_ADMISSION_REFUSED');process.exitCode=1;});}
module.exports={expected,verifyReport,validateEnvironment,CHECKS};
