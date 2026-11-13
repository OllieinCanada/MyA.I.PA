// Derived from exact #245 81a50f7 runner; original dependency bytes remain pinned unchanged.
// This runner starts only a sealed read-only HTTP child, never application workers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const nativeSpawn=require('node:child_process').spawnSync;
const {Worker}=require('node:worker_threads');
const {validateEnvironment,ownedDatabase}=require('./run-synthetic-backup-ci');
const fixture=require('./composite-recovery-fixture'),pins=require('./composite-recovery-pins.json');
const ROOT=path.resolve(__dirname,'..');
const httpFixture=require('./restored-http-fixture');
const httpPins=require('./restored-http-pins.json');
const SOURCES=['scripts/run-restored-http-ci.js','scripts/restored-http-fixture.js','scripts/restored-http-worker.js','scripts/restored-http-pins.json','server/index.js','server/callNotificationEvidence.js','server/twilioStatusInbox.js','server/smsSuppression.js','scripts/composite-recovery-fixture.js','scripts/composite-recovery-pins.json','server/recoveryFileStore.js','server/calendarIntegrations.js','server/jobberIntegration.js','server/persistentSecurityState.js',...Object.keys(pins.sha256)];
const fail=code=>{throw Object.assign(Error(code),{code});};
function verifyPins(read=file=>fs.readFileSync(path.join(ROOT,file))){for(const [file,hash]of Object.entries(httpPins.sha256))if(fixture.sha(read(file))!==hash)fail('COMPOSITE_HTTP_DEPENDENCY_BYTES_CHANGED');for(const [file,hash]of Object.entries(pins.sha256))if(fixture.sha(read(file))!==hash)fail('COMPOSITE_DEPENDENCY_BYTES_CHANGED');return true;}
function expected(){return {head:process.env.SYNTHETIC_BACKUP_HEAD,schemaSha256:fixture.sha(fs.readFileSync(path.join(ROOT,'prisma/schema.prisma'))),
  dependencyHead:pins.reviewedHead,models:fixture.expectedModels(fs.readFileSync(path.join(ROOT,'prisma/schema.prisma'),'utf8')),
  sourceSha256:Object.fromEntries(SOURCES.map(file=>[file,fixture.sha(fs.readFileSync(path.join(ROOT,file)))]))};}
const safeCode=e=>typeof e?.code==='string'&&/^(COMPOSITE_[A-Z_]+|ERR_ASSERTION)$/.test(e.code)?e.code:'COMPOSITE_CHECK_FAILED';
async function run(input=process.env){
  const service=validateEnvironment(input),policy=expected(),aborted=input.SYNTHETIC_BACKUP_EXPECTED_ABORT==='1';verifyPins();
  if(['.env','.env.local'].some(name=>fs.existsSync(path.join(ROOT,name))))fail('COMPOSITE_LOCAL_ENV_FORBIDDEN');
  const clean=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
  for(const k of Object.keys(process.env))delete process.env[k];
  Object.assign(process.env,clean,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',SECURITY_STATE_FORCE_DATABASE:'true',CHECKPOINT_DISABLE:'1',LC_ALL:'C'});
  // Trusted native helpers are captured before the JS transport instrumentation.
  // They receive only fixed tools and execution-owned local targets, not URLs or
  // archives from callers. This does not claim an OS network sandbox.
  const {Client}=require('pg'),{PrismaClient,Prisma}=require('@prisma/client'),assert=require('node:assert/strict');
  const {privateDirectory,removePrivateDirectory,schemaSqlDigest}=require('./backup-safety');
  const {encryptBackup}=require('./database-backup'),{decryptBackup,restoreDrill}=require('./restore-backup-drill');
  const {NAMES,readRecoveryFileStore}=require('../server/recoveryFileStore');
  const guard=require('./local-staging-egress').install();
  const privateInventory=()=>fs.readdirSync(require('node:os').tmpdir()).filter(n=>/^myaipa-(backup|restore)-drill-/.test(n)).sort();
  const initialPrivate=privateInventory();
  const root=privateDirectory('myaipa-backup-drill-'),vault=privateDirectory('myaipa-backup-drill-'),owned=new Set();
  const report={schemaVersion:1,scope:'restored-disposable-http-synthetic-recovery-only',head:policy.head,
    schemaSha256:policy.schemaSha256,dependencyHead:pins.reviewedHead,httpDependencyHead:httpPins.reviewedHead,pinsVerified:true,
    startedAt:new Date().toISOString(),passed:false,checks:[],modelInventory:policy.models,fileInventory:[...NAMES],
    productionDataUsed:false,providerCallsOrMessages:0,applicationWorkersStarted:false,liveRecoveryProven:false,
    productionWriterFenceProven:false,privacyReplayProven:false,uncertainReconciliationProven:false,osSandboxProven:false,
    unexercisedBehaviors:[...fixture.OMITTED_BEHAVIORS],cleanup:{databasesRemoved:false,filesRemoved:false,unrelatedDatabasesUnchanged:false}};
  let relay,admin,sourcePrisma,targetPrisma,sourceRead,initial,identity,success=false;
  const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false});throw e;}};
  let config;
  const connect=async database=>{const c=new Client({...config,database,connectionTimeoutMillis:5000,query_timeout:10000});await c.connect();return c;};
  const use=async(database,fn)=>{const c=await connect(database);try{return await fn(c);}finally{await c.end();}};
  const inventory=async()=>((await admin.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(r=>r.datname));
  const cluster=async()=>{const r=(await admin.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::int AS version,current_setting('data_directory') AS directory,system_identifier::text AS identifier FROM pg_control_system()")).rows[0];
    assert.equal(r.database,service.database);assert.equal(r.role,service.user);assert.ok(r.version>=180000&&r.version<190000);if(identity){assert.equal(r.identifier,identity.identifier);assert.equal(r.directory,identity.directory);}return r;};
  const create=async prefix=>{const n=prefix+crypto.randomBytes(6).toString('hex');await admin.query('CREATE DATABASE "'+n+'"');owned.add(n);return n;};
  const json=(name,value)=>{const file=path.join(root,name);fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});return file;};
  try{
    relay=new Worker(path.join(__dirname,'synthetic-backup-loopback-relay.js'));
    const port=await new Promise((resolve,reject)=>{relay.once('error',reject);relay.once('message',m=>resolve(m.port));});assert.ok(Number.isInteger(port)&&port>0&&port<65536);guard.allowPort(port);
    config={...service,host:'127.0.0.1',port};admin=await connect(service.database);identity=await cluster();initial=await inventory();
    await check('pins-and-pg18-identity',async()=>{for(const command of ['pg_dump','pg_restore']){const r=nativeSpawn(command,['--version'],{encoding:'utf8',env:{...clean,LC_ALL:'C'},timeout:10000});assert.equal(r.status,0);assert.match(r.stdout,/\b18\./);}
      assert.equal((await admin.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n,0);report.postgresVersionNumber=identity.version;});
    const source=await create('myaipa_backup_fixture_'),target=await create('myaipa_restore_drill_'),sentinel=await create('myaipa_restore_drill_');
    const url=database=>`postgresql://${service.user}:${service.password}@127.0.0.1:${port}/${database}?connection_limit=2`;
    const sourceUrl=url(source),targetUrl=url(target);
    const generated=nativeSpawn(process.execPath,[path.join(ROOT,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',path.join(ROOT,'prisma/schema.prisma')],{
      cwd:ROOT,encoding:'utf8',timeout:120000,env:{...clean,LC_ALL:'C',DATABASE_URL:sourceUrl,CHECKPOINT_DISABLE:'1',DISABLE_LOCAL_ENV_FILES:'1'}});assert.equal(generated.status,0);
    const client=database=>new PrismaClient({datasources:{db:{url:url(database)}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
    sourcePrisma=client(source);global.__myAiPaPrisma={};
    const versions={...fixture.KEY_VERSIONS};report.keyVersions=versions;
    const keys=Object.fromEntries(Object.keys(versions).map(k=>[k,crypto.randomBytes(32).toString('hex')]));
    const vaultFile=path.join(vault,'fixture-keys.json');fs.writeFileSync(vaultFile,JSON.stringify({versions,keys}),{flag:'wx',mode:0o600});
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=keys.calendar;
    const calendar=require('../server/calendarIntegrations'),fieldModule={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'server/jobberIntegration.js'),'utf8')+'\nmodule.exports.fixtureCrypto={encryptSecret,decryptSecret};',{
      require,module:fieldModule,process:{env:{}},Buffer,URL,URLSearchParams});const field=fieldModule.exports.fixtureCrypto;
    let records;
    await check('actual-schema-and-every-model-seeded',async()=>{
      assert.deepEqual(Prisma.dmmf.datamodel.models.map(m=>m.name).sort(),[...policy.models].sort());
      records=await fixture.seedEveryModel(sourcePrisma,Prisma.dmmf.datamodel,(model,text)=>model==='FieldServiceConnection'?field.encryptSecret(text,{FIELD_SERVICE_TOKEN_ENCRYPTION_KEY:keys.field}):calendar.encryptSecret(text));
      report.modelsSeeded=records.size;assert.equal(records.size,policy.models.length);
    });
    const httpContext=await httpFixture.seedHttp(sourcePrisma,records);
    const generation='fixture-'+crypto.randomBytes(12).toString('hex'),boundary='boundary-'+crypto.randomBytes(12).toString('hex');
    await sourcePrisma.runtimeStore.create({data:{key:'synthetic:composite-capture:v1',data:{syntheticOnly:true,generation,boundary}}});
    const sourceFiles=path.join(root,'source-files'),bundle=path.join(root,'bundle'),restoredFiles=path.join(root,'restored-files');for(const dir of [sourceFiles,bundle,restoredFiles])fs.mkdirSync(dir);
    const expectedFiles={};
    for(const [i,name]of NAMES.entries()){
      const data=name==='signup-dashboard.json'?Object.fromEntries(httpContext.context.map((r,j)=>['attempt:'+r.signupAttemptId,{...r,syntheticOnly:true,generation,boundary}])):{['fixture-'+i]:{syntheticOnly:true,generation,boundary,businessId:records.get('Business').id,status:'pending-no-dispatch'}};
      const file=path.join(sourceFiles,name);fs.writeFileSync(file,JSON.stringify(data),{flag:'wx',mode:0o600});
      expectedFiles[name]={generation,boundary,keyVersion:versions.backup,plainSha256:fixture.sha(fs.readFileSync(file))};
    }
    await sourcePrisma.$disconnect();sourcePrisma=null;
    // The fixture has no application process. Drain its only writer and prevent
    // ordinary new source connections from writing; not a production fence.
    assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname=$1',[source])).rows[0].n,0);
    await admin.query('ALTER DATABASE "'+source+'" SET default_transaction_read_only=on');
    const modelMeta=Prisma.dmmf.datamodel.models;
    const ident=name=>{if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))fail('COMPOSITE_TABLE_IDENTITY');return '"'+name+'"';};
    const tables=async c=>((await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename));
    const catalog=async c=>({constraints:(await c.query("SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid) AS definition,k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname")).rows,
      indexes:(await c.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows,
      enums:(await c.query("SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder")).rows,
      sequences:(await c.query("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows});
    const fingerprints=async c=>{const result=[];assert.deepEqual(await tables(c),modelMeta.map(m=>m.dbName||m.name).sort());
      for(const model of modelMeta){const rows=(await c.query('SELECT to_jsonb(t) AS r FROM '+ident(model.dbName||model.name)+' t')).rows.map(r=>r.r);assert.ok(rows.length>0);result.push({model:model.name,rows:rows.length,sha256:fixture.rowsHash(rows)});}return result;};
    sourceRead=await connect(source);await sourceRead.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot=(await sourceRead.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const before=await fingerprints(sourceRead),beforeCatalog=await catalog(sourceRead);
    const pgEnv={...clean,LC_ALL:'C',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:service.user,PGPASSWORD:service.password,PGDATABASE:source,PGSSLMODE:'disable'};
    const raw=path.join(root,'synthetic-composite.dump');
    const dumped=nativeSpawn('pg_dump',['--format=custom','--no-owner','--no-privileges','--snapshot',snapshot,'--file',raw],{env:pgEnv,encoding:'utf8',timeout:60000});assert.equal(dumped.status,0);
    const schema=nativeSpawn('pg_restore',['--schema-only','--no-owner','--no-privileges','--file=-',raw],{env:{...clean,LC_ALL:'C'},encoding:'utf8',timeout:60000});assert.equal(schema.status,0);
    const files=[];
    for(const name of NAMES){readRecoveryFileStore(path.join(sourceFiles,name));const copy=path.join(bundle,name);fs.copyFileSync(path.join(sourceFiles,name),copy,fs.constants.COPYFILE_EXCL);
      const encrypted=encryptBackup(copy,keys.backup),bytes=fs.readFileSync(encrypted.encryptedPath);
      files.push({name,...expectedFiles[name],path:encrypted.encryptedPath,manifest:{encrypted:true,encryption:encrypted.encryption,sha256:fixture.sha(bytes)}});}
    const encrypted=encryptBackup(raw,keys.backup),manifest={schemaVersion:1,createdAt:new Date().toISOString(),encrypted:true,encryption:encrypted.encryption,archiveFormat:'postgres-custom',sha256:fixture.sha(fs.readFileSync(encrypted.encryptedPath))};
    await check('synthetic-capture-boundary',async()=>{
      await use(source,async c=>{await assert.rejects(c.query('UPDATE "Business" SET name=\'not-permitted\''),e=>e.code==='25006');});
      const marker=(await sourceRead.query('SELECT data FROM "RuntimeStore" WHERE key=$1',['synthetic:composite-capture:v1'])).rows[0].data;assert.equal(marker.generation,generation);assert.equal(marker.boundary,boundary);
      for(const name of NAMES){const data=readRecoveryFileStore(path.join(sourceFiles,name));assert.equal(fixture.sha(fs.readFileSync(path.join(sourceFiles,name))),expectedFiles[name].plainSha256);for(const row of Object.values(data)){assert.equal(row.generation,marker.generation);assert.equal(row.boundary,marker.boundary);}}
      assert.deepEqual(await fingerprints(sourceRead),before);fixture.validateFiles(files,expectedFiles);assert.ok(!require.cache[path.join(ROOT,'server/index.js')]);
    });
    await sourceRead.query('COMMIT');await sourceRead.end();sourceRead=null;
    if(aborted)fail('COMPOSITE_EXPECTED_ABORT');
    await check('omission-tamper-and-inconsistent-generation-refused',async()=>{
      assert.throws(()=>fixture.validateFiles(files.slice(1),expectedFiles),/FILE_SET/);
      assert.throws(()=>fixture.validateFiles(files.map((f,i)=>i?f:{...f,generation:'different-generation'}),expectedFiles),/BINDING/);
      assert.throws(()=>fixture.validateFiles(files.map((f,i)=>i?f:{...f,keyVersion:'wrong-version'}),expectedFiles),/BINDING/);
      for(const f of files){const bytes=fs.readFileSync(f.path),tampered=Buffer.from(bytes);tampered[0]^=1;assert.throws(()=>decryptBackup(tampered,f.manifest,keys.backup),/checksum/);assert.throws(()=>decryptBackup(bytes,f.manifest,crypto.randomBytes(32).toString('hex')),/authenticate|Unsupported state/i);}
    });
    await use(sentinel,c=>c.query('CREATE TABLE sentinel(id integer PRIMARY KEY); INSERT INTO sentinel VALUES(1)'));
    const ticketFor=database=>({host:'127.0.0.1',port:String(port),database,systemIdentifier:identity.identifier,dataDirectory:identity.directory,createdAt:new Date().toISOString()});
    const targetTicket=json('target.json',ticketFor(target)),manifestPath=json('manifest.json',manifest);
    const review=json('review.json',{scope:'exact-logical-archive-schema',decision:'approved',reviewReference:'generated-fixed-actual-Prisma-synthetic-only',reviewedAt:new Date().toISOString(),
      schemaDigestFormat:'pg-schema-without-generated-restrict-wrapper-v1',artifactSha256:manifest.sha256,schemaSqlSha256:schemaSqlDigest(schema.stdout)});
    const recovered=JSON.parse(fs.readFileSync(vaultFile,'utf8'));assert.deepEqual(recovered.versions,versions);
    const restoreEnv={...clean,DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:sourceUrl,RESTORE_DATABASE_URL:targetUrl,RESTORE_TARGET_TICKET:targetTicket,
      RESTORE_SCHEMA_REVIEW_TICKET:review,RESTORE_DRILL_CONFIRM:'RESTORE_TO_DISPOSABLE_DATABASE',BACKUP_ENCRYPTION_KEY:recovered.keys.backup};
    const restore=env=>restoreDrill({env:env||restoreEnv,applyRestore:true,backupPath:encrypted.encryptedPath,manifestPath});
    await check('unsafe-target-refusals',async()=>{
      await assert.rejects(restore({...restoreEnv,DATABASE_URL:targetUrl}),/matches source/);
      await assert.rejects(restore({...restoreEnv,RESTORE_TARGET_TICKET:json('wrong-target.json',{...ticketFor(target),systemIdentifier:identity.identifier+'0'})}),/server identity/);
      await assert.rejects(restore({...restoreEnv,RESTORE_DATABASE_URL:url(sentinel),RESTORE_TARGET_TICKET:json('sentinel.json',ticketFor(sentinel))}),/not empty/);
      assert.deepEqual((await use(sentinel,c=>c.query('SELECT * FROM sentinel'))).rows,[{id:1}]);assert.equal((await use(target,tables)).length,0);
    });
    await check('actual-schema-encrypted-restore',async()=>{const r=await restore();assert.equal(r.restored,true);assert.equal(r.checksumVerified,true);assert.equal(r.constraintsValidated,true);assert.equal(r.tablesVerified,policy.models.length);});
    await check('all-model-row-and-catalog-roundtrip',async()=>{
      const after=await use(target,fingerprints);assert.deepEqual(after,before);assert.deepEqual(await use(target,catalog),beforeCatalog);
      report.modelRoundtrip=before.map((m,i)=>({model:m.model,rows:m.rows,sourceSha256:m.sha256,targetSha256:after[i].sha256}));
      await use(target,async c=>{await c.query('BEGIN');try{await assert.rejects(c.query('INSERT INTO "Lead" (id,"businessId","callerId",intent,urgency,summary,"callbackNumber",name) VALUES (2147483646,2147483646,$1,$2,$3,$4,$5,$6)',[records.get('Caller').id,records.get('Lead').intent,records.get('Lead').urgency,'synthetic','+15555550101','synthetic']),e=>e.code==='23503');}finally{await c.query('ROLLBACK');}});
    });
    await check('four-files-and-recovered-key-versions',async()=>{
      report.fileRoundtrip=[];for(const f of files){assert.equal(f.keyVersion,recovered.versions.backup);const plain=decryptBackup(fs.readFileSync(f.path),f.manifest,recovered.keys.backup);try{assert.equal(fixture.sha(plain),expectedFiles[f.name].plainSha256);const file=path.join(restoredFiles,f.name);fs.writeFileSync(file,plain,{flag:'wx',mode:0o600});const data=readRecoveryFileStore(file);for(const row of Object.values(data)){assert.equal(row.generation,generation);assert.equal(row.boundary,boundary);}report.fileRoundtrip.push({name:f.name,verified:true,keyVersion:f.keyVersion});}finally{plain.fill(0);}}
      process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=recovered.keys.calendar;const cal=await use(target,c=>c.query('SELECT "accessTokenEncrypted" FROM "CalendarConnection"'));assert.equal(calendar.decryptSecret(cal.rows[0].accessTokenEncrypted),'synthetic-CalendarConnection-accessTokenEncrypted');
      process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');assert.throws(()=>calendar.decryptSecret(cal.rows[0].accessTokenEncrypted));process.env.CALENDAR_TOKEN_ENCRYPTION_KEY=recovered.keys.calendar;
      const job=await use(target,c=>c.query('SELECT "accessTokenEncrypted" FROM "FieldServiceConnection"'));assert.equal(field.decryptSecret(job.rows[0].accessTokenEncrypted,{FIELD_SERVICE_TOKEN_ENCRYPTION_KEY:recovered.keys.field}),'synthetic-FieldServiceConnection-accessTokenEncrypted');
      assert.throws(()=>field.decryptSecret(job.rows[0].accessTokenEncrypted,{FIELD_SERVICE_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')}));report.keyVersions=versions;
    });
    await check('restored-http-auth-tenancy-receipts-and-side-effects',async()=>{
      report.http=await httpFixture.exerciseHttp({nativeSpawn,admin,use,config,target,restoredFiles,root,clean,identity,httpContext,head:policy.head,fingerprints,before});
    });
    await check('completed-replay-refused-without-reset',async()=>{
      targetPrisma=client(target);const replay=require('../server/persistentSecurityState');
      const result=await replay.claimWebhookReplay({client:targetPrisma,key:records.get('WebhookReplayClaim').key,provider:'synthetic',eventIdHash:'fixture',leaseMs:1000,retentionMs:1000,now:new Date('2026-11-13T00:00:00.000Z')});
      assert.equal(result.claimed,false);assert.equal(result.duplicate,true);assert.equal(result.status,'completed');await targetPrisma.$disconnect();targetPrisma=null;
      assert.deepEqual(await use(target,fingerprints),before);
    });
    await check('nonempty-archive-replay-refused',async()=>{await assert.rejects(restore(),/not empty/);assert.deepEqual(await use(target,fingerprints),before);});
    await check('provider-transports-disabled',async()=>{assert.equal(guard.status().unexpectedOutboundAttempts,0);const probes=await guard.probes();assert.equal(probes.rejected,6);assert.equal(probes.unexpectedOutboundAttempts,0);assert.ok(!require.cache[path.join(ROOT,'server/index.js')]);});
    success=true;
  }catch(error){report.failureCode=safeCode(error);}
  finally{
    if(sourceRead){await sourceRead.query('ROLLBACK').catch(()=>{});await sourceRead.end().catch(()=>{});}
    for(const client of [sourcePrisma,targetPrisma])if(client)await client.$disconnect().catch(()=>{success=false;});
    try{if(admin&&identity){await cluster();for(const name of owned){if(!ownedDatabase(name,owned))fail('COMPOSITE_CLEANUP_SCOPE');const r=(await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[name])).rows[0];assert.equal(r?.owner,service.user);await admin.query('DROP DATABASE "'+name+'"');}assert.deepEqual(await inventory(),initial);report.cleanup.databasesRemoved=true;report.cleanup.unrelatedDatabasesUnchanged=true;}}catch(error){report.cleanup.failureCode=safeCode(error);success=false;}
    if(admin)await admin.end().catch(()=>{success=false;});
    if(relay)await new Promise(resolve=>{const timer=setTimeout(()=>{success=false;relay.terminate().then(resolve);},5000);relay.once('exit',()=>{clearTimeout(timer);resolve();});relay.postMessage('stop');});
    try{removePrivateDirectory(root);removePrivateDirectory(vault);report.cleanup.filesRemoved=!fs.existsSync(root)&&!fs.existsSync(vault);assert.deepEqual(privateInventory(),initialPrivate);report.cleanup.privateDirectoryInventoryRestored=true;}catch(error){report.cleanup.failureCode=safeCode(error);success=false;}
    report.ownedDatabaseCount=owned.size;report.passed=success&&report.cleanup.databasesRemoved&&report.cleanup.filesRemoved;report.finishedAt=new Date().toISOString();
    report.sourceSha256=Object.fromEntries(SOURCES.map(file=>[file,fixture.sha(fs.readFileSync(path.join(ROOT,file)))]));
    const output=path.join(ROOT,'diagnostics/restored-http-ci',aborted?'expected-abort.json':'result.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  return report;
}
if(require.main===module){if(process.argv[2]==='--verify-evidence'){
  try{verifyPins();const dir=path.join(ROOT,'diagnostics/restored-http-ci'),aborted=process.argv[3]==='--aborted';if(!verifyReport(JSON.parse(fs.readFileSync(path.join(dir,aborted?'expected-abort.json':'result.json'))),expected(),aborted))throw Error();}catch{console.error('COMPOSITE_EVIDENCE_REFUSED');process.exitCode=1;}
}else run().then(r=>{console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}).catch(e=>{console.error(safeCode(e));process.exitCode=1;});}
function verifyReport(report,policy,aborted=false){
 if(report?.scope!=='restored-disposable-http-synthetic-recovery-only'||report.httpDependencyHead!==httpPins.reviewedHead)return false;
 const checks=report?.checks||[];const httpChecks=checks.filter(c=>c.name==='restored-http-auth-tenancy-receipts-and-side-effects');
 if(!aborted&&(httpChecks.length!==1||httpChecks[0].passed!==true||!httpFixture.verifyHttp(report.http)))return false;
 return fixture.verifyComposite({...report,scope:'actual-prisma-four-file-synthetic-recovery-only',checks:checks.filter(c=>c.name!=='restored-http-auth-tenancy-receipts-and-side-effects')},policy,aborted);
}
module.exports={verifyPins,expected,safeCode,verifyReport};
