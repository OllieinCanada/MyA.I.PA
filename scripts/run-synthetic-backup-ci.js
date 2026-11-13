// Two-table synthetic CI rehearsal only. No application or provider is started.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const ROOT=path.resolve(__dirname,'..');
const REQUIRED_CHECKS=['postgres18-service-and-client-versions','missing-confirmation-refuses-with-empty-target',
  'source-target-alias-refuses-with-empty-target','mismatched-cluster-ticket-refuses-with-empty-target',
  'nonempty-unrelated-target-refuses-and-preserves-row','ciphertext-checksum-tamper-refuses-with-empty-target',
  'wrong-key-refuses-with-empty-target','authentication-tag-tamper-refuses-with-empty-target',
  'changed-schema-review-refuses-with-empty-target','real-encrypted-restore-verifies-counts-and-constraints',
  'exact-fake-rows-and-source-preserved','real-primary-and-foreign-key-enforcement',
  'archive-replay-refused-without-repeating-restore','instrumented-provider-transports-denied'];
const fail=code=>{throw Object.assign(Error(code),{code});};
function validateEnvironment(env,platform=process.platform){
  if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.CI!=='true'||env.RUN_SYNTHETIC_BACKUP_RESTORE!=='1')fail('SYNTHETIC_BACKUP_CI_ONLY');
  if(env.SYNTHETIC_BACKUP_TEST_PASSWORD!=='synthetic-ci-only')fail('SYNTHETIC_BACKUP_SERVICE_REQUIRED');
  if(!/^[a-f0-9]{40}$/.test(env.SYNTHETIC_BACKUP_HEAD||''))fail('SYNTHETIC_BACKUP_HEAD_REQUIRED');
  if(env.SYNTHETIC_BACKUP_EXPECTED_ABORT!==undefined&&env.SYNTHETIC_BACKUP_EXPECTED_ABORT!=='1')fail('SYNTHETIC_BACKUP_ABORT_MODE_INVALID');
  if(Object.keys(env).some(k=>env[k]&&(/^(?:DATABASE_URL|RESTORE_|BACKUP_|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGPASSFILE|PGOPTIONS|NODE_OPTIONS|OPERATIONS_ENV_FILE)$/.test(k)
    ||/^(?:RESTORE_|BACKUP_|RENDER_|TWILIO_|VAPI_|STRIPE_|MAKE_|TELEGRAM_|SMTP_|OPENAI_|CALENDAR_|FIELD_SERVICE_)/.test(k))))fail('SYNTHETIC_BACKUP_FOREIGN_CONFIGURATION');
  return{host:'postgres',port:5432,user:'backup_fixture',password:'synthetic-ci-only',database:'myaipa_backup_control_ci'};
}
function ownedDatabase(name,owned){
  return owned instanceof Set&&owned.has(name)&&/^(?:myaipa_backup_fixture_|myaipa_restore_drill_)[a-f0-9]{12}$/.test(name);
}
function safeCode(error){return typeof error?.code==='string'&&/^(?:SYNTHETIC_BACKUP_[A-Z_]+|ERR_ASSERTION)$/.test(error.code)?error.code:'SYNTHETIC_BACKUP_CHECK_FAILED';}
function verifyReport(report,head,expectedAbort=false){
  const checks=expectedAbort?['postgres18-service-and-client-versions']:REQUIRED_CHECKS;
  return /^[a-f0-9]{40}$/.test(head||'')&&report?.releaseCommit===head&&report.schemaVersion===1
    &&report.scope==='two-table-synthetic-encrypted-postgres18-restore'
    &&report.passed===!expectedAbort&&(!expectedAbort||report.failureCode==='SYNTHETIC_BACKUP_INJECTED_ABORT')
    &&report.generatedFixtureArchive===true&&report.ownedDatabaseCount===3
    &&report.cleanup?.databasesRemoved===true&&report.cleanup.filesRemoved===true&&report.cleanup.unrelatedDatabasesUnchanged===true
    &&report.productionDataUsed===false&&report.productionRequests===0&&report.providerCallsOrMessages===0&&report.applicationWorkersStarted===false
    &&['completeRecoveryProven','fullApplicationSchemaProven','fileStoreRecoveryProven','privacyReplayProven','uncertainActionReconciliationProven','liveRpoRtoProven','osNetworkSandboxProven'].every(k=>report[k]===false)
    &&Array.isArray(report.checks)&&report.checks.length===checks.length&&new Set(report.checks.map(c=>c.name)).size===checks.length
    &&checks.every(name=>report.checks.some(c=>c.name===name&&c.passed===true));
}
function installTransportFence(){
  let denied=0;const deny=()=>{denied++;fail('SYNTHETIC_BACKUP_TRANSPORT_DENIED');};
  global.fetch=deny;for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
  const connect=net.Socket.prototype.connect;
  const ports=new Set();
  net.Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];
    const host=typeof first==='object'?first.host:args[1],port=Number(typeof first==='object'?first.port:first);
    if(!((host==='postgres'&&port===5432)||(host==='127.0.0.1'&&ports.has(port))))return deny();return connect.apply(this,args);};
  const dns=require('node:dns'),lookup=dns.lookup;
  dns.lookup=(host,...args)=>['postgres','127.0.0.1'].includes(host)?lookup(host,...args):deny();dns.resolve=deny;
  require('node:dgram').createSocket=deny;
  const child=require('node:child_process'),spawn=child.spawnSync;
  child.spawnSync=(command,args,options)=>['pg_dump','pg_restore'].includes(command)?spawn(command,args,options):deny();
  for(const name of ['spawn','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
  return{allowPort:port=>ports.add(port),denied:()=>denied};
}
async function runFixture(input=process.env){
  const config=validateEnvironment(input),head=input.SYNTHETIC_BACKUP_HEAD,expectedAbort=input.SYNTHETIC_BACKUP_EXPECTED_ABORT==='1';
  // Do not inherit credentials, local env files, library loaders or PG options.
  const clean=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
  for(const k of Object.keys(process.env))delete process.env[k];
  Object.assign(process.env,clean,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',LC_ALL:'C'});
  const fence=installTransportFence();
  const {Client}=require('pg'),assert=require('node:assert/strict');
  const {privateDirectory,removePrivateDirectory,schemaSqlDigest}=require('./backup-safety');
  const {restoreDrill}=require('./restore-backup-drill');
  const {encryptBackup}=require('./database-backup');
  const {spawnSync}=require('node:child_process');
  const directory=privateDirectory('myaipa-backup-drill-'),owned=new Set();
  const report={schemaVersion:1,scope:'two-table-synthetic-encrypted-postgres18-restore',releaseCommit:head,
    executionId:crypto.randomUUID(),startedAt:new Date().toISOString(),passed:false,checks:[],
    productionDataUsed:false,productionRequests:0,providerCallsOrMessages:0,applicationWorkersStarted:false,
    completeRecoveryProven:false,fullApplicationSchemaProven:false,fileStoreRecoveryProven:false,
    privacyReplayProven:false,uncertainActionReconciliationProven:false,liveRpoRtoProven:false,
    osNetworkSandboxProven:false,cleanup:{databasesRemoved:false,filesRemoved:false,unrelatedDatabasesUnchanged:false}};
  const admin=new Client({...config,connectionTimeoutMillis:5000,query_timeout:10000});
  let proxy,connected=false,initialInventory,identity;
  const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false});throw error;}};
  const queryDatabase=async(database,fn)=>{const c=new Client({...config,database,connectionTimeoutMillis:5000,query_timeout:10000});try{await c.connect();return await fn(c);}finally{await c.end();}};
  const inventory=async()=>((await admin.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(r=>r.datname));
  const sameCluster=async()=>{const r=(await admin.query("SELECT current_database() AS database, current_user AS role, current_setting('server_version_num')::int AS version, current_setting('data_directory') AS directory, system_identifier::text AS identifier FROM pg_control_system()")).rows[0];
    assert.equal(r.database,config.database);assert.equal(r.role,config.user);assert.ok(r.version>=180000&&r.version<190000);
    if(identity){assert.equal(r.identifier,identity.identifier);assert.equal(r.directory,identity.directory);}return r;};
  const makeDatabase=async(prefix)=>{const name=prefix+crypto.randomBytes(6).toString('hex');assert.ok(!owned.has(name));
    // Claim ownership only after an acknowledged CREATE; an uncertain creation
    // must not trigger DROP against an unproven target or an automatic retry.
    await admin.query('CREATE DATABASE "'+name+'"');owned.add(name);return name;};
  let success=false;
  try{
    await admin.connect();connected=true;identity=await sameCluster();initialInventory=await inventory();
    await check('postgres18-service-and-client-versions',async()=>{
      for(const command of ['pg_dump','pg_restore']){const r=spawnSync(command,['--version'],{encoding:'utf8',timeout:10000,env:{...clean,LC_ALL:'C'}});assert.equal(r.status,0);assert.match(r.stdout,/\b18\./);}
      assert.equal(Number((await admin.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n),0);
    });
    // Tools run in the job container; PostgreSQL runs in its service container.
    // A fixed-destination loopback relay lets the unchanged target guard retain
    // its loopback URL contract, while cluster/database checks bind the service.
    proxy=new (require('node:worker_threads').Worker)(path.join(__dirname,'synthetic-backup-loopback-relay.js'));
    const port=await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.once('message',message=>resolve(message.port));});
    assert.ok(Number.isInteger(port)&&port>0&&port<65536);fence.allowPort(port);
    const source=await makeDatabase('myaipa_backup_fixture_'),target=await makeDatabase('myaipa_restore_drill_'),unrelated=await makeDatabase('myaipa_restore_drill_');
    const sourceUrl=`postgresql://${config.user}:${config.password}@127.0.0.1:${port}/${source}`;
    const targetUrl=`postgresql://${config.user}:${config.password}@127.0.0.1:${port}/${target}`;
    await queryDatabase(source,c=>c.query('CREATE TABLE "Business" (id integer PRIMARY KEY, name text NOT NULL); CREATE TABLE "Lead" (id integer PRIMARY KEY, "businessId" integer NOT NULL REFERENCES "Business"(id)); INSERT INTO "Business" VALUES (1,\'Synthetic fixture\'),(2,\'Synthetic second fixture\'); INSERT INTO "Lead" VALUES (1,1),(2,2),(3,1);'));
    await queryDatabase(unrelated,c=>c.query('CREATE TABLE sentinel (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO sentinel VALUES (1,\'keep synthetic sentinel\');'));
    const empty=async()=>assert.equal((await queryDatabase(target,c=>c.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"))).rows[0].n,0);
    const ticketFor=database=>({host:'127.0.0.1',port:String(port),database,systemIdentifier:identity.identifier,dataDirectory:identity.directory,createdAt:new Date().toISOString()});
    const jsonFile=(name,value)=>{const file=path.join(directory,name);fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});return file;};
    const raw=path.join(directory,'synthetic.dump');
    const pgEnv={...clean,LC_ALL:'C',PGHOST:'postgres',PGPORT:'5432',PGUSER:config.user,PGPASSWORD:config.password,PGDATABASE:source,PGSSLMODE:'disable'};
    const dumped=spawnSync('pg_dump',['--format=custom','--no-owner','--no-privileges','--file',raw],{env:pgEnv,encoding:'utf8',timeout:60000});assert.equal(dumped.status,0);
    const schema=spawnSync('pg_restore',['--schema-only','--no-owner','--no-privileges','--file=-',raw],{env:{...clean,LC_ALL:'C'},encoding:'utf8',timeout:60000});assert.equal(schema.status,0);
    const secret=crypto.randomBytes(32).toString('hex'),encrypted=encryptBackup(raw,secret),bytes=fs.readFileSync(encrypted.encryptedPath);
    assert.equal(fs.existsSync(raw),false);
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),encrypted:true,encryption:encrypted.encryption,archiveFormat:'postgres-custom',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    const manifestPath=jsonFile('manifest.json',manifest),targetTicket=jsonFile('target.json',ticketFor(target));
    const review={scope:'exact-logical-archive-schema',decision:'approved',reviewReference:'generated-fixed-synthetic-fixture-only',reviewedAt:new Date().toISOString(),schemaDigestFormat:'pg-schema-without-generated-restrict-wrapper-v1',artifactSha256:manifest.sha256,schemaSqlSha256:schemaSqlDigest(schema.stdout)};
    const reviewTicket=jsonFile('schema-review.json',review);report.generatedFixtureArchive=true;
    if(expectedAbort)fail('SYNTHETIC_BACKUP_INJECTED_ABORT');
    const env={...clean,DISABLE_LOCAL_ENV_FILES:'1',RESTORE_DATABASE_URL:targetUrl,DATABASE_URL:sourceUrl,RESTORE_TARGET_TICKET:targetTicket,
      RESTORE_SCHEMA_REVIEW_TICKET:reviewTicket,RESTORE_DRILL_CONFIRM:'RESTORE_TO_DISPOSABLE_DATABASE',BACKUP_ENCRYPTION_KEY:secret};
    const restore=overrides=>restoreDrill({env,applyRestore:true,backupPath:encrypted.encryptedPath,manifestPath,...overrides});
    await check('missing-confirmation-refuses-with-empty-target',async()=>{await assert.rejects(restore({env:{...env,RESTORE_DRILL_CONFIRM:''}}),/confirmation/);await empty();});
    await check('source-target-alias-refuses-with-empty-target',async()=>{await assert.rejects(restore({env:{...env,DATABASE_URL:targetUrl}}),/matches source/);await empty();});
    await check('mismatched-cluster-ticket-refuses-with-empty-target',async()=>{const bad=jsonFile('wrong-identity.json',{...ticketFor(target),systemIdentifier:identity.identifier+'0'});await assert.rejects(restore({env:{...env,RESTORE_TARGET_TICKET:bad}}),/server identity/);await empty();});
    await check('nonempty-unrelated-target-refuses-and-preserves-row',async()=>{const ticket=jsonFile('unrelated.json',ticketFor(unrelated));await assert.rejects(restore({env:{...env,RESTORE_DATABASE_URL:targetUrl.replace('/'+target,'/'+unrelated),RESTORE_TARGET_TICKET:ticket}}),/not empty/);
      assert.deepEqual((await queryDatabase(unrelated,c=>c.query('SELECT * FROM sentinel'))).rows,[{id:1,value:'keep synthetic sentinel'}]);await empty();});
    await check('ciphertext-checksum-tamper-refuses-with-empty-target',async()=>{const bad=Buffer.from(bytes);bad[0]^=1;const file=path.join(directory,'tampered.enc');fs.writeFileSync(file,bad,{flag:'wx',mode:0o600});await assert.rejects(restore({backupPath:file}),/checksum/);await empty();});
    await check('wrong-key-refuses-with-empty-target',async()=>{await assert.rejects(restore({env:{...env,BACKUP_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')}}),/authenticate|Unsupported state/i);await empty();});
    await check('authentication-tag-tamper-refuses-with-empty-target',async()=>{const tag=Buffer.from(manifest.encryption.authTag,'base64');tag[0]^=1;const bad=jsonFile('wrong-tag.json',{...manifest,encryption:{...manifest.encryption,authTag:tag.toString('base64')}});await assert.rejects(restore({manifestPath:bad}),/authenticate|Unsupported state/i);await empty();});
    await check('changed-schema-review-refuses-with-empty-target',async()=>{const bad=jsonFile('wrong-review.json',{...review,schemaSqlSha256:'0'.repeat(64)});await assert.rejects(restore({env:{...env,RESTORE_SCHEMA_REVIEW_TICKET:bad}}),/schema SQL review/);await empty();});
    await check('real-encrypted-restore-verifies-counts-and-constraints',async()=>{const r=await restore();assert.equal(r.restored,true);assert.equal(r.checksumVerified,true);assert.equal(r.archiveReadable,true);assert.equal(r.schemaSqlReviewed,true);assert.equal(r.constraintsValidated,true);assert.deepEqual(r.tableCounts,{Business:2,Lead:3});report.rowCounts=r.tableCounts;report.archiveSha256=r.artifactSha256;});
    await check('exact-fake-rows-and-source-preserved',async()=>{const read=c=>c.query('SELECT id,name FROM "Business" ORDER BY id');const sourceRows=(await queryDatabase(source,read)).rows,targetRows=(await queryDatabase(target,read)).rows;
      assert.deepEqual(sourceRows,[{id:1,name:'Synthetic fixture'},{id:2,name:'Synthetic second fixture'}]);assert.deepEqual(targetRows,sourceRows);
      assert.deepEqual((await queryDatabase(target,c=>c.query('SELECT id,"businessId" FROM "Lead" ORDER BY id'))).rows,[{id:1,businessId:1},{id:2,businessId:2},{id:3,businessId:1}]);});
    await check('real-primary-and-foreign-key-enforcement',async()=>{for(const [sql,code]of [['INSERT INTO "Lead" VALUES (1,1)','23505'],['INSERT INTO "Lead" VALUES (99,999)','23503']])await queryDatabase(target,async c=>{await c.query('BEGIN');try{await assert.rejects(c.query(sql),e=>e.code===code);}finally{await c.query('ROLLBACK');}});
      assert.equal((await queryDatabase(target,c=>c.query('SELECT COUNT(*)::int AS n FROM "Lead"'))).rows[0].n,3);});
    await check('archive-replay-refused-without-repeating-restore',async()=>{await assert.rejects(restore(),/not empty/);assert.equal((await queryDatabase(target,c=>c.query('SELECT COUNT(*)::int AS n FROM "Lead"'))).rows[0].n,3);});
    await check('instrumented-provider-transports-denied',async()=>{assert.equal(fence.denied(),0);assert.throws(()=>fetch('https://example.invalid'),/TRANSPORT_DENIED/);assert.throws(()=>require('node:https').request('https://example.invalid'),/TRANSPORT_DENIED/);assert.equal(fence.denied(),2);});
    success=true;
  }catch(error){report.failureCode=safeCode(error);}
  finally{
    try{
      if(connected){await sameCluster();for(const name of owned){if(!ownedDatabase(name,owned))fail('SYNTHETIC_BACKUP_CLEANUP_SCOPE');
        const row=(await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[name])).rows[0];
        if(row?.owner!==config.user)fail('SYNTHETIC_BACKUP_CLEANUP_OWNERSHIP');
        await admin.query('DROP DATABASE "'+name+'"');}
        assert.deepEqual(await inventory(),initialInventory);report.cleanup.databasesRemoved=true;report.cleanup.unrelatedDatabasesUnchanged=true;
      }
    }catch(error){report.cleanup.failureCode=safeCode(error);success=false;}
    await admin.end().catch(()=>{success=false;});
    if(proxy)await new Promise(resolve=>{const timeout=setTimeout(()=>{success=false;proxy.terminate().then(resolve);},5000);proxy.once('exit',()=>{clearTimeout(timeout);resolve();});proxy.postMessage('stop');});
    try{removePrivateDirectory(directory);report.cleanup.filesRemoved=!fs.existsSync(directory);}catch(error){report.cleanup.failureCode=safeCode(error);success=false;}
    report.finishedAt=new Date().toISOString();report.passed=success&&report.cleanup.databasesRemoved&&report.cleanup.filesRemoved;report.ownedDatabaseCount=owned.size;
    report.instrumentedTransportDenials=fence.denied();
    report.sourceSha256=Object.fromEntries(['scripts/run-synthetic-backup-ci.js','scripts/synthetic-backup-loopback-relay.js','scripts/restore-backup-drill.js','scripts/backup-safety.js','scripts/database-backup.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
    const output=path.join(ROOT,'diagnostics/synthetic-backup-ci',expectedAbort?'expected-abort.json':'result.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  return report;
}
if(require.main===module){runFixture().then(report=>{console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}).catch(error=>{console.error(safeCode(error));process.exitCode=1;});}
module.exports={validateEnvironment,ownedDatabase,safeCode,verifyReport,REQUIRED_CHECKS,runFixture};
