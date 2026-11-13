// Sealed CI composition only. No deployment, provider transport, production
// configuration, shared ref update, correction endpoint or source-data import.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const FILES=['scripts/expanded-release-pins.json','scripts/compose-expanded-release.js',
  'tests/expanded-release-composition.test.js','.github/workflows/expanded-release.yml'];
const REGRESSIONS=['tests/recovery-notification-receipt-retry.test.js','tests/vapi-business-mapping-audit.test.js',
  'tests/vapi-inventory-evidence.test.js','tests/vapi-mapping-failclosed.test.js',
  'tests/signup-association-lifecycle.test.js','tests/bounded-business-mapping-writer.test.js'];
const DELEGATED={quality:['Install dependencies','Install isolated regression browsers'],
  'public-browser-quality':['Restore unchanged locked dependencies','Install isolated regression browsers']};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function validatePins(p){
  if(p?.schemaVersion!==1||p.repository!=='OllieinCanada/MyA.I.PA'||p.node!=='24.22.3'||p.entry?.pr!==241
    ||JSON.stringify(p.dependencies?.map(d=>d.pr))!==JSON.stringify([235,239,240,237,238])
    ||![p.base,p.entry.head,p.sourceTree,...p.dependencies.map(d=>d.head)].every(x=>/^[a-f0-9]{40}$/.test(x))
    ||Object.values(p.requiredBytes||{}).length!==5||Object.values(p.requiredBytes).some(x=>!/^[a-f0-9]{64}$/.test(x)))throw Error('Invalid immutable expanded provenance');
}
function baselineComplete(r,required){
  return r?.disposableDatabaseRemoved===true&&r.sqlMode==='real-postgresql'&&r.providerMode==='synthetic-no-send'
    &&r.outcomes?.length===required.length&&new Set(r.outcomes.map(x=>x.id)).size===required.length
    &&required.every(id=>r.outcomes.some(x=>x.id===id&&x.status===((id.startsWith('ownership_')||id.startsWith('wait_'))?'failed':'passed')
      &&(!id.startsWith('ownership_')||x.code==='REPRO_PROVIDER_CONFLICT_ACCEPTED')
      &&(!id.startsWith('wait_')||x.code==='REPRO_REVOKED_ADMISSION_DISPATCHED')));
}
function strictTap(text){
  // Required focused regressions may not silently skip or return an empty run.
  const metric=n=>Number(new RegExp('^# '+n+' (\\d+)$','m').exec(text)?.[1]??NaN);
  return metric('tests')>0&&metric('pass')===metric('tests')&&metric('fail')===0&&metric('cancelled')===0&&metric('skipped')===0;
}
function workflowPlan(workspace,name,pins){
  const bytes=fs.readFileSync(path.join(workspace,'.github/workflows',name+'.yml'),'utf8');
  if(hash(bytes.replace(/\r\n/g,'\n'))!==pins.workflowHashes[name])throw Error('Canonical workflow changed');
  const yaml=require('js-yaml'),job=Object.values(yaml.load(bytes).jobs)[0];
  const runs=job.steps.filter(s=>s.run);
  if(runs.length!==(name==='quality'?20:6)||runs.some(s=>!s.name||s.if||/\$\{\{/.test(JSON.stringify(s.env||{}))))throw Error('Unreviewed workflow control flow');
  const delegated=DELEGATED[name];
  if(delegated.some(n=>!runs.some(s=>s.name===n)))throw Error('Required setup delegation missing');
  return {delegated,steps:runs.filter(s=>!delegated.includes(s.name))};
}
function compose({root=path.resolve(__dirname,'..'),phase='compose'}={}){
  if(!['compose','sql','quality','browser'].includes(phase))throw Error('Unknown expanded phase');
  const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:32*1024*1024,...options});
    if(r.error||r.status!==0)throw Error(`${path.basename(cmd)} failed: ${String(r.stderr||r.error?.code||'').slice(-1000)}`);return r.stdout;};
  const git=(args,options={})=>run('git',args,options).trim();
  const pins=JSON.parse(fs.readFileSync(path.join(root,'scripts/expanded-release-pins.json')));validatePins(pins);
  if(process.versions.node!==pins.node)throw Error('Exact approved Node required');
  const head=git(['rev-parse','HEAD']);if(process.env.EXPANDED_EXPECTED_HEAD&&process.env.EXPANDED_EXPECTED_HEAD!==head)throw Error('Expanded head changed');
  if(git(['diff','--name-only',pins.base,head]).split(/\r?\n/).filter(Boolean).some(x=>!FILES.includes(x)))throw Error('Out-of-scope publication');
  const identity={...process.env,GIT_AUTHOR_NAME:'Expanded CI composition',GIT_AUTHOR_EMAIL:'ci@example.invalid',GIT_COMMITTER_NAME:'Expanded CI composition',
    GIT_COMMITTER_EMAIL:'ci@example.invalid',GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'};
  let candidate=pins.entry.head;
  for(const d of pins.dependencies){const tree=git(['merge-tree','--write-tree',candidate,d.head]);
    candidate=git(['commit-tree',tree,'-p',candidate,'-p',d.head],{env:identity,input:'Ephemeral expanded composition; no shared ref mutation\n'});}
  const tree=git(['rev-parse',candidate+'^{tree}']);if(tree!==pins.sourceTree)throw Error('Expanded tree differs from exact pinned composition');
  for(const p of ['package.json','package-lock.json','prisma/schema.prisma'])if(hash(run('git',['show',`${tree}:${p}`]))!==hash(run('git',['show',`${head}:${p}`])))throw Error('Manifest/lock/schema drift');
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-expanded-'));
  const out=path.join(root,'diagnostics/expanded-release',phase,path.basename(workspace));fs.mkdirSync(out,{recursive:true});
  const report={schemaVersion:1,head,phase,pins,sourceTree:tree,workspace,ready:false,productionActions:0,completed:[],runtimeHashes:{}};
  const checkBytes=()=>{for(const[p,expected]of Object.entries(pins.requiredBytes)){const actual=hash(fs.readFileSync(path.join(workspace,p)));
    if(actual!==expected)throw Error('Required corrected bytes differ: '+p);report.runtimeHashes[p]=actual;}};
  const apply=(name,reverse=false)=>{const args=['-c','core.autocrlf=false','apply',...(reverse?['-R']:[]),path.join(workspace,'scripts',name)];
    git([...args.slice(0,-1),'--check',args.at(-1)],{cwd:workspace});git(args,{cwd:workspace});};
  try{
    // A disposable Git checkout preserves tracked ignored files and gives the
    // canonical quality tools an honest composed HEAD, never a fake PR head.
    git(['init','--quiet',workspace]);
    const common=git(['rev-parse','--path-format=absolute','--git-common-dir']);
    fs.mkdirSync(path.join(workspace,'.git/objects/info'),{recursive:true});
    fs.writeFileSync(path.join(workspace,'.git/objects/info/alternates'),path.join(common,'objects').replace(/\\/g,'/')+'\n');
    git(['read-tree',tree],{cwd:workspace});git(['-c','core.autocrlf=false','checkout-index','--all'],{cwd:workspace});
    for(const p of FILES){const dest=path.join(workspace,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,run('git',['show',`${head}:${p}`]));}
    // Patch bytes themselves must be exactly241 before applying either patch.
    for(const p of ['scripts/bounded-mapping-entry-index.patch','scripts/bounded-mapping-entry-safety.patch'])
      if(hash(fs.readFileSync(path.join(workspace,p)))!==pins.requiredBytes[p])throw Error('Entry patch bytes changed');
    apply('bounded-mapping-entry-index.patch');apply('bounded-mapping-entry-safety.patch');checkBytes();
    git(['add','--force','--',...FILES,'server/index.js','server/boundedBusinessMappingWriter.js'],{cwd:workspace});
    const wiredTree=git(['write-tree'],{cwd:workspace});
    report.composedHead=git(['commit-tree',wiredTree,'-p',head],{cwd:workspace,env:identity,input:'Disposable exact expanded candidate; never publish or deploy\n'});
    git(['update-ref','HEAD',report.composedHead],{cwd:workspace});report.wiredTree=wiredTree;
    run(process.execPath,['--check','server/index.js'],{cwd:workspace});
    if(phase==='compose')return report;
    const deps=path.resolve(process.env.EXPANDED_APPROVED_NODE_MODULES||path.join(root,'node_modules'));
    if(!fs.existsSync(path.join(deps,'@prisma/client/package.json')))throw Error('Existing locked install required');
    fs.symlinkSync(deps,path.join(workspace,'node_modules'),process.platform==='win32'?'junction':'dir');
    const {validateSqlTarget,validateCoverage}=require(path.join(workspace,'scripts/compose-bounded-mapping-integration'));
    validateSqlTarget(process.env.DATABASE_URL,process.env);
    const env=Object.fromEntries(['PATH','HOME','LANG','SystemRoot','TEMP','TMP','RUNNER_ENVIRONMENT','RUNNER_TEMP','GITHUB_REPOSITORY',
      'GITHUB_EVENT_NAME','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    Object.assign(env,{CI:'true',GITHUB_ACTIONS:'true',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:process.env.DATABASE_URL,
      GITHUB_WORKSPACE:workspace,DEPENDENCY_EXPECTED_HEAD:report.composedHead,REACT_APP_API_BASE_URL:'https://api.myaipa.ca',REACT_APP_RELEASE_SHA:report.composedHead});
    const execute=(label,args,extra={},timeout=180000)=>{
      const r=spawnSync(args[0],args.slice(1),{cwd:workspace,env:{...env,...extra},encoding:'utf8',timeout,maxBuffer:64*1024*1024});
      fs.writeFileSync(path.join(out,label+'.stdout.log'),r.stdout||'');fs.writeFileSync(path.join(out,label+'.stderr.log'),r.stderr||'');
      if(r.error||r.status!==0)throw Error('Expanded step failed: '+label);report.completed.push(label);return r.stdout||'';
    };
    execute('installed-lock',[process.execPath,'scripts/verify-installed-lock.js']);
    if(phase==='sql'){
      const {SQL_CASES,validCoverage}=require(path.join(workspace,'scripts/compose-bounded-mapping-entry'));
      apply('bounded-mapping-entry-safety.patch',true);
      const baselineFile=path.join(out,'baseline-entry-sql.json');
      const baseline=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/bounded-mapping-control-postgres.integration.cjs'],
        {cwd:workspace,env:{...env,RUN_BOUNDED_MAPPING_CONTROL_POSTGRES:'1',MAPPING_CONTROL_SQL_REPORT:baselineFile},encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
      fs.writeFileSync(path.join(out,'baseline.tap'),baseline.stdout||'');fs.writeFileSync(path.join(out,'baseline.stderr.log'),baseline.stderr||'');
      if(baseline.error||baseline.status===0||!baselineComplete(JSON.parse(fs.readFileSync(baselineFile)),SQL_CASES))throw Error('Expanded baseline proof incomplete');
      report.baselineUnsafeOutcomes=14;apply('bounded-mapping-entry-safety.patch');checkBytes();
      const entryFile=path.join(out,'entry-sql.json');
      const entryTap=execute('entry',[process.execPath,'--test','--test-reporter=tap','tests/bounded-mapping-control.integration.cjs','tests/bounded-mapping-control-postgres.integration.cjs'],
        {RUN_BOUNDED_MAPPING_CONTROL_POSTGRES:'1',MAPPING_CONTROL_SQL_REPORT:entryFile});
      if(!strictTap(entryTap)||!validCoverage(JSON.parse(fs.readFileSync(entryFile))))throw Error('Expanded22-case SQL/session proof incomplete');report.entrySqlCases=22;
      const readerFile=path.join(out,'reader-sql.json');
      const readerTap=execute('reader',[process.execPath,'--test','--test-reporter=tap','tests/bounded-business-mapping-integration.test.js'],
        {RUN_BOUNDED_MAPPING_INTEGRATION:'1',MAPPING_INTEGRATION_REPORT:readerFile});
      const reader=JSON.parse(fs.readFileSync(readerFile));if(!strictTap(readerTap)||!validateCoverage(reader)||!reader.disposableDatabaseRemoved)throw Error('Expanded19-case reader proof incomplete');report.readerSqlCases=19;
      const focused=execute('receipt-mapping-lifecycle',[process.execPath,'--test','--test-reporter=tap','--test-concurrency=1',...REGRESSIONS]);
      if(!strictTap(focused))throw Error('Focused regression proof missing/skipped');report.focusedRegressionsComplete=true;
    }else{
      const name=phase==='quality'?'quality':'public-browser-quality',plan=workflowPlan(workspace,name,pins);
      report.canonicalWorkflow=name;report.delegatedSetup=plan.delegated;
      for(let i=0;i<plan.steps.length;i++){
        const s=plan.steps[i];console.log('Expanded canonical gate: '+s.name);
        execute(name+'-'+String(i+1).padStart(2,'0'),['bash','--noprofile','--norc','-e','-o','pipefail','-c',s.run],s.env||{},900000);
        report.completedCanonicalSteps=(report.completedCanonicalSteps||[]).concat(s.name);
      }
      if(report.completedCanonicalSteps.length!==(phase==='quality'?18:4))throw Error('Incomplete canonical gates');
      if(phase==='browser'){
        const r=JSON.parse(fs.readFileSync(path.join(workspace,'diagnostics/shipping-readiness/browser-quality-gate.json')));
        require(path.join(workspace,'scripts/browser-quality-coverage')).requireCompleteBrowserEvidence(r);
        report.browserChecks=r.completedChecks;report.browserCoverage=r.coverage;
      }
    }
    checkBytes();report.ready=true;return report;
  }catch(error){report.error=error.message;throw error;}
  finally{
    // Only synthetic run diagnostics generated in this disposable checkout.
    for(const relative of ['diagnostics/shipping-readiness/browser-quality-gate.json','diagnostics/call-sync-audio-repair/browser.json',
      'diagnostics/call-sync-audio-repair/scenario-browser.json','diagnostics/development-dependency-ci','diagnostics/shipping-readiness/production-dependencies.json']){
      const src=path.join(workspace,relative);if(fs.existsSync(src)){const dest=path.join(out,'tree-evidence',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(src,dest,{recursive:true});}
    }
    fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(report,null,2)+'\n');console.log('Expanded evidence: '+out);
  }
}
if(require.main===module){try{const phase=process.argv.find(x=>x.startsWith('--phase='))?.slice(8)||'compose';console.log(JSON.stringify(compose({phase}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={FILES,REGRESSIONS,validatePins,baselineComplete,strictTap,workflowPlan,compose};
