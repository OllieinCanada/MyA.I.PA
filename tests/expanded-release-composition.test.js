const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {FILES,REGRESSIONS,validatePins,baselineComplete,strictTap,workflowPlan,workflowPlanFromBytes,launchNode,publicBuildEnvironment}=require('../scripts/compose-expanded-release');
const pins=require('../scripts/expanded-release-pins.json');
test('only four public composition files and unchanged exact dependency provenance are published',()=>{
  validatePins(pins);assert.equal(FILES.length,4);assert.equal(new Set(FILES).size,4);
  assert.ok(FILES.every(f=>!/^server\/|diagnostics\/|\.env|policy/.test(f)));
  assert.deepEqual(pins.dependencies.map(x=>[x.pr,x.head]),[[235,'f452de511657c41b3ced081aed07b49379656cf3'],
    [239,'932346e199636732d19ccb8bb73c80059447530e'],[240,'0765667d0226db61eec81ec08f8de373922987b9'],
    [237,'96c6752e8b857ce291212c04ab875f7b280798e9'],[238,'7efebcba8c33c9651c8c1ddbe36a8a7ab00f5be0']]);
  assert.equal(pins.entry.head,'842aac6dfc9772bae1a1d50a3b189e808ffe8e8f');
  assert.equal(pins.requiredBytes['server/boundedBusinessMappingWriter.js'],'c8b129211d807e780d55600695362cbcb813c29ac784a147dbed1b9ca746db6a');
  assert.equal(pins.requiredBytes['scripts/bounded-mapping-entry-safety.patch'],'db9b7a82312bc4929a687e81f4bef8bed4d091fa17d3b9826185ed9a7e1b8d98');
  assert.equal(pins.requiredBytes['server/index.js'],'90fccc0b064198b84babd15b347b4dfb397255005da5f62b29d21b362f0e9524');
  for(const p of [{...pins,node:'20'},{...pins,sourceTree:'main'},{...pins,dependencies:pins.dependencies.slice(1)}])assert.throws(()=>validatePins(p));
});
test('baseline evidence requires exact known unsafe outcomes, not arbitrary failures or skipped cleanup',()=>{
  const ids=['success','ownership_phone_metadata','wait_mapping_session'];
  const r={sqlMode:'real-postgresql',providerMode:'synthetic-no-send',disposableDatabaseRemoved:true,outcomes:[
    {id:'success',status:'passed'},{id:ids[1],status:'failed',code:'REPRO_PROVIDER_CONFLICT_ACCEPTED'},
    {id:ids[2],status:'failed',code:'REPRO_REVOKED_ADMISSION_DISPATCHED'}]};
  assert.equal(baselineComplete(r,ids),true);
  for(const bad of [{...r,outcomes:r.outcomes.slice(1)},{...r,disposableDatabaseRemoved:false},{...r,sqlMode:'synthetic'},
    {...r,outcomes:r.outcomes.map((x,i)=>i===2?{...x,code:'HTTP_429'}:x)},
    {...r,outcomes:r.outcomes.map((x,i)=>i===1?{...x,status:'skipped'}:x)}])assert.equal(baselineComplete(bad,ids),false);
});
test('required focused regression TAP fails closed for absent, failed, cancelled or skipped proof',()=>{
  const text='# tests 12\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 0\n';assert.equal(strictTap(text),true);
  for(const bad of ['',text.replace('tests 12','tests 0'),text.replace('pass 12','pass 11'),text.replace('fail 0','fail 1'),
    text.replace('cancelled 0','cancelled 1'),text.replace('skipped 0','skipped 1')])assert.equal(strictTap(bad),false);
  assert.ok(REGRESSIONS.includes('tests/recovery-notification-receipt-retry.test.js'));
  assert.ok(REGRESSIONS.includes('tests/vapi-mapping-failclosed.test.js'));
});
test('canonical full quality/browser plans retain every applicable run gate, delegating only identical setup',()=>{
  const fs=require('node:fs'),crypto=require('node:crypto'),root=path.resolve(__dirname,'..');
  let bytes=fs.readFileSync(path.join(root,'.github/workflows/quality.yml'),'utf8').replace(/\r\n/g,'\n');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==pins.workflowHashes.quality){
    // Standalone publication is main-based. Reproduce exactly235's one-line
    // workflow fixture delta; the reviewed hash still must match, never waive it.
    assert.throws(()=>workflowPlanFromBytes(bytes,'quality',pins),/Canonical workflow changed/);
    const anchor='          RUN_SIGNUP_CONTEXT_POSTGRES=1 node --test tests/signup-context-identity-postgres.test.js\n';
    assert.ok(bytes.includes(anchor));bytes=bytes.replace(anchor,anchor+'          RUN_SIGNUP_ASSOCIATION_POSTGRES=1 node --test tests/signup-association-repair-postgres.test.js\n');
  }
  const quality=workflowPlanFromBytes(bytes,'quality',pins),browser=workflowPlan(root,'public-browser-quality',pins);
  assert.equal(quality.steps.length,18);assert.equal(browser.steps.length,4);
  assert.ok(quality.steps.some(s=>s.run==='npm run test:backend'));
  assert.ok(quality.steps.some(s=>s.name==='Exercise the real PostgreSQL schema and constraints'));
  assert.ok(quality.steps.some(s=>s.run.includes('RUN_SIGNUP_ASSOCIATION_POSTGRES=1')));
  assert.ok(quality.steps.some(s=>s.run.includes('test:public-demo-audio')));
  assert.ok(browser.steps.some(s=>s.env?.BROWSER_ENGINES==='chromium,firefox,webkit'));
});
test('only the approved public browser build configuration crosses the narrow environment boundary',()=>{
  assert.deepEqual(publicBuildEnvironment({REACT_APP_GOOGLE_MAPS_API_KEY:'synthetic-public-browser-value',VAPI_API_KEY:'do-not-copy',ADMIN_PASSWORD:'do-not-copy'}),
    {REACT_APP_GOOGLE_MAPS_API_KEY:'synthetic-public-browser-value'});
  assert.deepEqual(publicBuildEnvironment({}),{REACT_APP_GOOGLE_MAPS_API_KEY:''});
});
test('native Node dispatch preserves spaces and shell metacharacters as literal arguments',()=>{
  const value=path.join(require('node:os').tmpdir(),"fixture space;$(never-run)&'quote");
  const r=launchNode(['-e','process.stdout.write(process.argv[1])',value],{encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,value);
});
