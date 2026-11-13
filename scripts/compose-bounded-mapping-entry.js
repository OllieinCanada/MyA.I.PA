// Immutable preparation composition: no branch/ref writes, provider transport or deployment.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const FILES=['server/boundedMappingControl.js','tests/bounded-mapping-control.integration.cjs',
  'tests/bounded-mapping-control-postgres.integration.cjs','scripts/bounded-mapping-entry-index.patch',
  'scripts/bounded-mapping-entry-pins.json','scripts/bounded-mapping-entry-safety.patch','scripts/compose-bounded-mapping-entry.js',
  'tests/bounded-mapping-entry-composition.test.js','.github/workflows/bounded-mapping-entry.yml'];
const SQL_CASES=['default_refusal','dry_run_zero_writes','explicit_guarded_admission','fresh_receipt_refusal',
  'atomicity_uncertainty','lost_commit_acknowledgement','shared_running_fence','actual_signed_session_http',
  ...['phone','assistant'].flatMap(r=>['businessId','metadata'].map(f=>`ownership_${r}_${f}`)),
  ...['gate','mapping'].flatMap(s=>['session','session_expiry','policy','approval','flag'].map(c=>`wait_${s}_${c}`))];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function validCoverage(r){return r?.sqlMode==='real-postgresql'&&r.providerMode==='synthetic-no-send'
  &&r.disposableDatabaseRemoved===true&&r.outcomes?.length===SQL_CASES.length
  &&new Set(r.outcomes.map(x=>x.id)).size===SQL_CASES.length&&SQL_CASES.every(id=>r.outcomes.some(x=>x.id===id&&x.status==='passed'));}
function compose({root=path.resolve(__dirname,'..'),composeOnly=false}={}){
  const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:32*1024*1024,...options});
    if(r.error||r.status!==0)throw Error(`${path.basename(cmd)} failed: ${String(r.stderr||r.error?.code||'').slice(-1000)}`);return r.stdout;};
  const git=args=>run('git',args).trim(),pins=JSON.parse(fs.readFileSync(path.join(root,'scripts/bounded-mapping-entry-pins.json')));
  if(pins.schemaVersion!==1||pins.node!=='24.22.3'||![pins.base,pins.association,pins.writer,pins.adapter,pins.combinedTree].every(x=>/^[a-f0-9]{40}$/.test(x)))throw Error('Invalid immutable pins');
  if(process.versions.node!==pins.node)throw Error('Exact approved Node required');
  const head=git(['rev-parse','HEAD']);if(process.env.ENTRY_EXPECTED_HEAD&&process.env.ENTRY_EXPECTED_HEAD!==head)throw Error('Head mismatch');
  if(git(['diff','--name-only',pins.base,head]).split(/\r?\n/).filter(Boolean).some(p=>!FILES.includes(p)))throw Error('Out-of-scope publication');
  const pair=git(['merge-tree','--write-tree',pins.association,pins.writer]);
  const synthetic=run('git',['commit-tree',pair,'-p',pins.association,'-p',pins.writer],{input:'Ephemeral pinned CI composition only\n',
    env:{...process.env,GIT_AUTHOR_NAME:'CI composition',GIT_AUTHOR_EMAIL:'ci@example.invalid',GIT_COMMITTER_NAME:'CI composition',GIT_COMMITTER_EMAIL:'ci@example.invalid'}}).trim();
  const tree=git(['merge-tree','--write-tree',synthetic,pins.adapter]);if(tree!==pins.combinedTree)throw Error('Pinned composition mismatch');
  for(const p of ['package-lock.json','prisma/schema.prisma'])if(hash(run('git',['show',`${tree}:${p}`]))!==hash(run('git',['show',`${head}:${p}`])))throw Error('Lock/schema mismatch');
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-entry-combined-'));
  const out=path.join(root,'diagnostics/bounded-mapping-entry',path.basename(workspace));fs.mkdirSync(out,{recursive:true});
  const report={head,pins,tree,workspace,composeOnly,ready:false,overlayHashes:{},dependencyHashes:{}};
  try{
    const archive=path.join(workspace,'tree.tar');run('git',['-c','core.autocrlf=false','archive','--format=tar','--output',archive,tree]);
    run(process.platform==='win32'?'tar.exe':'tar',['-xf',archive,'-C',workspace]);
    for(const p of FILES){const body=run('git',['show',`${head}:${p}`]);const dest=path.join(workspace,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);report.overlayHashes[p]=hash(body);}
    for(const[p,sha]of [['server/signupAssociationRepair.js',pins.association],['server/boundedBusinessMappingWriter.js',pins.writer],['server/boundedBusinessMappingAdapters.js',pins.adapter]]){
      const bytes=fs.readFileSync(path.join(workspace,p));if(hash(bytes)!==hash(run('git',['show',`${sha}:${p}`])))throw Error('Dependency bytes mismatch');report.dependencyHashes[p]=hash(bytes);}
    const patch=fs.readFileSync(path.join(workspace,'scripts/bounded-mapping-entry-index.patch'),'utf8');
    if((patch.match(/^diff --git /gm)||[]).length!==1||!patch.startsWith('diff --git a/server/index.js b/server/index.js\n'))throw Error('Unexpected index patch scope');
    run('git',['apply','--check',path.join(workspace,'scripts/bounded-mapping-entry-index.patch')],{cwd:workspace});
    run('git',['apply',path.join(workspace,'scripts/bounded-mapping-entry-index.patch')],{cwd:workspace});
    report.baselineWiredIndexHash=hash(fs.readFileSync(path.join(workspace,'server/index.js')));
    run(process.execPath,['--check','server/index.js'],{cwd:workspace});
    const applySafety=()=>{
      const file=path.join(workspace,'scripts/bounded-mapping-entry-safety.patch'),body=fs.readFileSync(file,'utf8');
      const diffs=body.match(/^diff --git .+$/gm)||[];
      if(JSON.stringify(diffs)!==JSON.stringify(['diff --git a/server/index.js b/server/index.js','diff --git a/server/boundedBusinessMappingWriter.js b/server/boundedBusinessMappingWriter.js']))throw Error('Unexpected safety patch scope');
      run('git',['apply','--check',file],{cwd:workspace});run('git',['apply',file],{cwd:workspace});
      report.wiredIndexHash=hash(fs.readFileSync(path.join(workspace,'server/index.js')));
      report.patchedWriterHash=hash(fs.readFileSync(path.join(workspace,'server/boundedBusinessMappingWriter.js')));
    };
    if(composeOnly){applySafety();return report;}
    const {validateSqlTarget}=require(path.join(workspace,'scripts/compose-bounded-mapping-integration'));validateSqlTarget(process.env.DATABASE_URL,process.env);
    const deps=path.resolve(process.env.MAPPING_APPROVED_NODE_MODULES||path.join(root,'node_modules'));
    if(!fs.existsSync(path.join(deps,'@prisma/client/package.json')))throw Error('Locked dependencies required');
    fs.symlinkSync(deps,path.join(workspace,'node_modules'),process.platform==='win32'?'junction':'dir');
    const env=Object.fromEntries(['PATH','HOME','SystemRoot','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    Object.assign(env,{CI:'true',GITHUB_ACTIONS:'true',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:process.env.DATABASE_URL,
      RUN_BOUNDED_MAPPING_CONTROL_POSTGRES:'1',MAPPING_CONTROL_SQL_REPORT:path.join(out,'entry-sql.json')});
    const baselineReport=path.join(out,'baseline-entry-sql.json');
    const baseline=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/bounded-mapping-control-postgres.integration.cjs'],
      {cwd:workspace,env:{...env,MAPPING_CONTROL_SQL_REPORT:baselineReport},encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
    fs.writeFileSync(path.join(out,'baseline.tap'),baseline.stdout||'');fs.writeFileSync(path.join(out,'baseline.stderr.log'),baseline.stderr||'');
    const old=JSON.parse(fs.readFileSync(baselineReport));
    const expected=SQL_CASES.filter(id=>id.startsWith('ownership_')||id.startsWith('wait_'));
    if(baseline.error||baseline.status===0||old.disposableDatabaseRemoved!==true||old.outcomes.length!==SQL_CASES.length
      ||!SQL_CASES.every(id=>old.outcomes.some(x=>x.id===id&&x.status===(expected.includes(id)?'failed':'passed')
        &&(!expected.includes(id)||x.code===(id.startsWith('ownership_')?'REPRO_PROVIDER_CONFLICT_ACCEPTED':'REPRO_REVOKED_ADMISSION_DISPATCHED')))))throw Error('Baseline regression reproduction incomplete; inspect preserved evidence');
    report.baselineReproduced=expected;
    applySafety();
    const r=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/bounded-mapping-control.integration.cjs','tests/bounded-mapping-control-postgres.integration.cjs'],
      {cwd:workspace,env,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
    fs.writeFileSync(path.join(out,'tests.tap'),r.stdout||'');fs.writeFileSync(path.join(out,'tests.stderr.log'),r.stderr||'');
    if(r.error||r.status!==0)throw Error('Entry-point tests failed; preserved TAP/stderr');
    if(!validCoverage(JSON.parse(fs.readFileSync(env.MAPPING_CONTROL_SQL_REPORT))))throw Error('Incomplete entry SQL coverage/cleanup');
    // The admission hook patches the native writer. Re-run the existing full
    // reader/lifecycle SQL matrix too; prior PR240 evidence is not this code.
    const adapterReport=path.join(out,'adapter-regression-sql.json');
    const regression=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/bounded-business-mapping-integration.test.js'],
      {cwd:workspace,env:{...env,RUN_BOUNDED_MAPPING_INTEGRATION:'1',MAPPING_INTEGRATION_REPORT:adapterReport},encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
    fs.writeFileSync(path.join(out,'adapter-regression.tap'),regression.stdout||'');fs.writeFileSync(path.join(out,'adapter-regression.stderr.log'),regression.stderr||'');
    const prior=JSON.parse(fs.readFileSync(adapterReport));
    if(regression.error||regression.status!==0||prior.disposableDatabaseRemoved!==true
      ||!require(path.join(workspace,'scripts/compose-bounded-mapping-integration')).validateCoverage(prior))throw Error('Full reader/lifecycle SQL regression incomplete');
    report.adapterRegressionCases=prior.cases.length;
    report.ready=true;return report;
  }catch(error){report.error=error.message;throw error;}
  finally{fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(report,null,2));console.log(`Entry evidence: ${out}`);}
}
if(require.main===module){try{console.log(JSON.stringify(compose({composeOnly:process.argv.includes('--compose-only')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={FILES,SQL_CASES,validCoverage,compose};
