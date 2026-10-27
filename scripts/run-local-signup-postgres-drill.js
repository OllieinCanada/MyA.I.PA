// Disposable, loopback-only PostgreSQL for Windows machines without Docker.
// Downloads a versioned runtime to a new temp directory; never uses project .env.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {PrismaClient} = require('@prisma/client');
const {Client}=require('pg');
const {privateDirectory,removePrivateDirectory}=require('./backup-safety');
const ROOT=path.resolve(__dirname,'..');
const PACKAGE='@embedded-postgres/windows-x64';
const VERSION='18.4.0-beta.17';
const INTEGRITY='sha512-AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==';
async function main(){
  if(process.platform!=='win32')throw Error('This fallback is Windows-only; use the existing PostgreSQL/Docker drill on other platforms.');
  const restoreFixture=process.argv.includes('--restore-fixture');
  let restoreBackup=process.argv.find(arg=>arg.startsWith('--restore-backup='))?.slice('--restore-backup='.length)||(restoreFixture?'fixture':'');
  const fullTools=Boolean(restoreBackup||process.argv.includes('--intake-only')||process.argv.includes('--intake-ledger')||process.argv.includes('--call-persistence-only'));
  const temporary=restoreBackup?privateDirectory('myaipa-backup-drill-'):fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-isolated-postgres-'));
  const bin=path.join(temporary,'package','native','bin');
  const data=path.join(temporary,'data');
  const password=crypto.randomBytes(24).toString('hex');
  const passwordFile=path.join(temporary,'password');
  let started=false;
  function run(command,args,env=process.env){
    // A Windows postgres child can inherit pg_ctl's output pipe and keep
    // spawnSync waiting after pg_ctl exited. Its dedicated -l logfile suffices.
    const result=spawnSync(command,args,{cwd:ROOT,env,encoding:'utf8',stdio:path.basename(command)==='pg_ctl.exe'?'ignore':'pipe',windowsHide:true,timeout:600000});
    if(result.error||result.status!==0)throw Error(`${path.basename(command)} failed: ${String(result.stderr||result.stdout||result.error).replaceAll(password,'[redacted]').slice(-2500)}`);
    return result;
  }
  try{
    if(!fullTools){
    console.log('Downloading disposable PostgreSQL runtime (version and SHA-512 verified).');
    const archiveUrl=`https://registry.npmjs.org/${PACKAGE}/-/windows-x64-${VERSION}.tgz`;
    const response=await fetch(archiveUrl,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('PostgreSQL runtime download failed');
    const archive=Buffer.from(await response.arrayBuffer());
    const actual='sha512-'+crypto.createHash('sha512').update(archive).digest('base64');
    if(actual!==INTEGRITY)throw Error('PostgreSQL runtime archive integrity check failed');
    const archivePath=path.join(temporary,'runtime.tgz');fs.writeFileSync(archivePath,archive);
    run('tar.exe',['-xzf',archivePath,'-C',temporary]);
    }
    // Package versions may keep the executables directly under native/.
    const runtimeBin=fullTools?(await require('./prepare-postgres-client-tools').prepareTools()).bin:
      (fs.existsSync(path.join(bin,'initdb.exe'))?bin:path.join(temporary,'package','native'));
    if(!fs.existsSync(path.join(runtimeBin,'initdb.exe')))throw Error('Downloaded runtime has no initdb');
    fs.writeFileSync(passwordFile,password,{mode:0o600});
    run(path.join(runtimeBin,'initdb.exe'),['-D',data,'-U','drill','--pwfile',passwordFile,'--auth=scram-sha-256','--locale=C','--encoding=UTF8']);
    const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    started=runtimeBin;
    run(path.join(runtimeBin,'pg_ctl.exe'),['-D',data,'-l',path.join(temporary,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const database=(restoreBackup?'myaipa_restore_drill_':'myaipa_recovery_drill_')+crypto.randomBytes(6).toString('hex');
    // Match CI's explicit bounded Prisma pool instead of multiplying a
    // machine-CPU-derived default across every restarted application worker.
    const url=`postgresql://drill:${password}@127.0.0.1:${port}/${database}?connection_limit=2`;
    const client=new PrismaClient({datasources:{db:{url:`postgresql://drill:${password}@127.0.0.1:${port}/postgres`}},
      __internal:{configOverride:config=>({...config,relativeEnvPaths:{}})}});
    let systemIdentifier;
    try{
      await client.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      if(restoreBackup)systemIdentifier=(await client.$queryRawUnsafe('SELECT system_identifier::text AS id FROM pg_control_system()'))[0].id;
    }finally{await client.$disconnect();}
    if(restoreBackup){
      let restoreSecret=process.env.BACKUP_ENCRYPTION_KEY;
      if(restoreFixture){
        restoreSecret=crypto.randomBytes(32).toString('hex');
        const fixtureDatabase='myaipa_backup_fixture_'+crypto.randomBytes(6).toString('hex');
        const admin=new Client({host:'127.0.0.1',port,user:'drill',password,database:'postgres'});
        try{await admin.connect();await admin.query(`CREATE DATABASE "${fixtureDatabase}"`);}finally{await admin.end();}
        const fixture=new Client({host:'127.0.0.1',port,user:'drill',password,database:fixtureDatabase});
        try{await fixture.connect();await fixture.query('CREATE TABLE "Business" (id integer PRIMARY KEY, name text NOT NULL); CREATE TABLE "Lead" (id integer PRIMARY KEY, "businessId" integer NOT NULL REFERENCES "Business"(id)); INSERT INTO "Business" VALUES (1,\'Synthetic fixture\'),(2,\'Synthetic second fixture\'); INSERT INTO "Lead" VALUES (1,1),(2,2),(3,1);');}finally{await fixture.end();}
        const raw=path.join(temporary,'synthetic.dump');
        run(path.join(runtimeBin,'pg_dump.exe'),['--format=custom','--no-owner','--no-privileges','--file',raw],{
          ...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'drill',PGPASSWORD:password,PGDATABASE:fixtureDatabase,PGSSLMODE:'disable'});
        const encrypted=require('./database-backup').encryptBackup(raw,restoreSecret);
        restoreBackup=encrypted.encryptedPath;
        fs.writeFileSync(restoreBackup+'.manifest.json',JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),
          encrypted:true,encryption:encrypted.encryption,archiveFormat:'postgres-custom',
          sha256:crypto.createHash('sha256').update(fs.readFileSync(restoreBackup)).digest('hex')}),{flag:'wx',mode:0o600});
      }
      const ticket=path.join(temporary,'target-ticket.json');
      fs.writeFileSync(ticket,JSON.stringify({host:'127.0.0.1',port:String(port),database,systemIdentifier,dataDirectory:data,createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
      const env={PATH:runtimeBin+path.delimiter+process.env.PATH,SystemRoot:process.env.SystemRoot,
        LOCALAPPDATA:process.env.LOCALAPPDATA,USERDOMAIN:process.env.USERDOMAIN,USERNAME:process.env.USERNAME,
        DISABLE_LOCAL_ENV_FILES:'1',RESTORE_BACKUP_PATH:path.resolve(restoreBackup),RESTORE_DATABASE_URL:url,
        RESTORE_TARGET_TICKET:ticket,RESTORE_DRILL_CONFIRM:'RESTORE_TO_DISPOSABLE_DATABASE',
        BACKUP_ENCRYPTION_KEY:restoreSecret};
      const restored=spawnSync(process.execPath,[path.join(ROOT,'scripts','restore-backup-drill.js'),'--restore'],{cwd:ROOT,env,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});
      if(restored.error||restored.status!==0)throw Error('Guarded restore failed: '+String(restored.stderr||'archive/target validation failure').slice(-1200));
      const report=JSON.parse(restored.stdout);
      report.backupMode=restoreFixture?'synthetic-backup-fixture':'production-logical-export';
      const output=path.join(ROOT,'diagnostics','provider-hardening',restoreFixture?'restore-fixture.json':'restore.json');
      fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report,null,2));
      return;
    }
    const env={...process.env,DATABASE_URL:url,SIGNUP_RECOVERY_DRILL_DATABASE_URL:url,DISABLE_LOCAL_ENV_FILES:'1'};
    console.log('Applying the application schema to the new disposable database.');
    run(process.execPath,[path.join(ROOT,'node_modules','prisma','build','index.js'),'db','push','--skip-generate'],env);
    if(process.argv.includes('--call-persistence-only')){
      console.log('Checking canonical call persistence, contention and transaction expiry against isolated PostgreSQL.');
      const tested=run(process.execPath,['--test','--test-concurrency=1',path.join(ROOT,'tests','database-integration.test.js'),path.join(ROOT,'tests','call-persistence-startup-postgres.test.js'),path.join(ROOT,'tests','call-persistence-budget-postgres.test.js')],{...env,RUN_DATABASE_INTEGRATION:'1'});
      console.log(tested.stdout.replaceAll(password,'[redacted]'));
      return;
    }
    console.log('Checking receipt contention, replay recovery and health queries against PostgreSQL.');
    run(process.execPath,['--test',path.join(ROOT,'tests','twilio-status-postgres.test.js')],{...env,RUN_TWILIO_RECEIPT_DATABASE:'1'});
    if(process.argv.includes('--intake-only')){
      run(process.execPath,[path.join(ROOT,'scripts','run-staging-intake-drill.js')],env);
      return;
    }
    if(process.argv.includes('--receipts-only'))return;
    if(!process.argv.includes('--chain-only')){
      console.log('Running the real-database restart and concurrent-worker drill.');
      const result=spawnSync(process.execPath,[path.join(ROOT,'scripts','run-signup-postgres-restart-drill.js')],{cwd:ROOT,env,stdio:'inherit',windowsHide:true,timeout:600000});
      if(result.error||result.status!==0)throw Error('Isolated PostgreSQL drill failed');
    }
    console.log('Running the complete verified-signup queue chain with fake providers.');
    run(process.execPath,[path.join(ROOT,'scripts','run-signup-setup-chain-drill.js')],env);
    if(process.argv.includes('--intake-ledger')){
      console.log('Running authenticated staging intake, correction, restart and rollback checks.');
      run(process.execPath,[path.join(ROOT,'scripts','run-staging-intake-drill.js')],env);
    }
  }catch(error){
    // Keep diagnostics from synthetic failures before scoped cleanup. Never
    // preserve raw logs from a restored production-data database here.
    if(!restoreBackup&&started){
      const log=path.join(temporary,'postgres.log');
      const status=spawnSync(path.join(started,'pg_ctl.exe'),['-D',data,'status'],{encoding:'utf8',windowsHide:true,timeout:10000});
      const scrub=value=>String(value||'').replaceAll(password,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').slice(-10000);
      const output=path.join(ROOT,'diagnostics/provider-hardening','disposable-postgres-failure-'+Date.now()+'.json');
      require('./provider-hardening-evidence').writeManifest(output,{checkedAt:new Date().toISOString(),productionTouched:false,
        serverStatusExitCode:status.status,serverStatus:scrub(status.stdout||status.stderr),
        error:scrub(error.message),postgresLogTail:fs.existsSync(log)?scrub(fs.readFileSync(log,'utf8')):'unavailable'});
    }
    throw error;
  }finally{
    if(started&&fs.existsSync(path.join(data,'postmaster.pid')))run(path.join(started,'pg_ctl.exe'),['-D',data,'-w','-m','immediate','stop']);
    // Exact directory returned by mkdtemp, verified before recursive cleanup.
    if(restoreBackup)removePrivateDirectory(temporary);
    else{
      const resolved=fs.realpathSync(temporary),tempRoot=fs.realpathSync(os.tmpdir());
      if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('myaipa-isolated-postgres-')||fs.lstatSync(temporary).isSymbolicLink())throw Error('Unsafe temp cleanup target');
      fs.rmSync(resolved,{recursive:true,force:true});
    }
    console.log('Disposable PostgreSQL stopped and its test-only files removed.');
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
