// Disposable, loopback-only PostgreSQL for Windows machines without Docker.
// Downloads a versioned runtime to a new temp directory; never uses project .env.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {PrismaClient} = require('@prisma/client');
const ROOT=path.resolve(__dirname,'..');
const PACKAGE='@embedded-postgres/windows-x64';
const VERSION='18.4.0-beta.17';
const INTEGRITY='sha512-AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==';
async function main(){
  if(process.platform!=='win32')throw Error('This fallback is Windows-only; use the existing PostgreSQL/Docker drill on other platforms.');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-isolated-postgres-'));
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
  }
  try{
    console.log('Downloading disposable PostgreSQL runtime (version and SHA-512 verified).');
    const archiveUrl=`https://registry.npmjs.org/${PACKAGE}/-/windows-x64-${VERSION}.tgz`;
    const response=await fetch(archiveUrl,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('PostgreSQL runtime download failed');
    const archive=Buffer.from(await response.arrayBuffer());
    const actual='sha512-'+crypto.createHash('sha512').update(archive).digest('base64');
    if(actual!==INTEGRITY)throw Error('PostgreSQL runtime archive integrity check failed');
    const archivePath=path.join(temporary,'runtime.tgz');fs.writeFileSync(archivePath,archive);
    run('tar.exe',['-xzf',archivePath,'-C',temporary]);
    // Package versions may keep the executables directly under native/.
    const runtimeBin=fs.existsSync(path.join(bin,'initdb.exe'))?bin:path.join(temporary,'package','native');
    if(!fs.existsSync(path.join(runtimeBin,'initdb.exe')))throw Error('Downloaded runtime has no initdb');
    fs.writeFileSync(passwordFile,password,{mode:0o600});
    run(path.join(runtimeBin,'initdb.exe'),['-D',data,'-U','drill','--pwfile',passwordFile,'--auth=scram-sha-256','--locale=C','--encoding=UTF8']);
    const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    started=runtimeBin;
    run(path.join(runtimeBin,'pg_ctl.exe'),['-D',data,'-l',path.join(temporary,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const database='myaipa_recovery_drill_'+crypto.randomBytes(6).toString('hex');
    const url=`postgresql://drill:${password}@127.0.0.1:${port}/${database}`;
    const client=new PrismaClient({datasources:{db:{url:`postgresql://drill:${password}@127.0.0.1:${port}/postgres`}},
      __internal:{configOverride:config=>({...config,relativeEnvPaths:{}})}});
    try{await client.$executeRawUnsafe(`CREATE DATABASE "${database}"`);}finally{await client.$disconnect();}
    const env={...process.env,DATABASE_URL:url,SIGNUP_RECOVERY_DRILL_DATABASE_URL:url,DISABLE_LOCAL_ENV_FILES:'1'};
    console.log('Applying the application schema to the new disposable database.');
    run(process.execPath,[path.join(ROOT,'node_modules','prisma','build','index.js'),'db','push','--skip-generate'],env);
    console.log('Checking receipt contention, replay recovery and health queries against PostgreSQL.');
    run(process.execPath,['--test',path.join(ROOT,'tests','twilio-status-postgres.test.js')],{...env,RUN_TWILIO_RECEIPT_DATABASE:'1'});
    if(process.argv.includes('--receipts-only'))return;
    if(!process.argv.includes('--chain-only')){
      console.log('Running the real-database restart and concurrent-worker drill.');
      const result=spawnSync(process.execPath,[path.join(ROOT,'scripts','run-signup-postgres-restart-drill.js')],{cwd:ROOT,env,stdio:'inherit',windowsHide:true,timeout:600000});
      if(result.error||result.status!==0)throw Error('Isolated PostgreSQL drill failed');
    }
    console.log('Running the complete verified-signup queue chain with fake providers.');
    run(process.execPath,[path.join(ROOT,'scripts','run-signup-setup-chain-drill.js')],env);
  }finally{
    if(started&&fs.existsSync(path.join(data,'postmaster.pid')))run(path.join(started,'pg_ctl.exe'),['-D',data,'-w','-m','immediate','stop']);
    // Exact directory returned by mkdtemp, verified before recursive cleanup.
    const resolved=fs.realpathSync(temporary),tempRoot=fs.realpathSync(os.tmpdir());
    if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('myaipa-isolated-postgres-')||fs.lstatSync(temporary).isSymbolicLink())throw Error('Unsafe temp cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
    console.log('Disposable PostgreSQL stopped and its test-only files removed.');
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
