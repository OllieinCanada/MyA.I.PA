const test=require('node:test');
const assert=require('node:assert/strict');
const {captureRelease,releaseUnchanged,definitionMatches,assessRuns}=require('../scripts/vapi-release-evidence');
const {upsertEval,runEval,initializeRunReport,selectedForRun}=require('../scripts/setup-vapi-evals');
test('release evidence detects assistant and floating tool changes without storing secrets',async()=>{
  let toolSecret='private-tool-credential';
  const api=async path=>path.includes('/assistant/')?{id:'assistant-1',latestVersion:'v16',model:{toolIds:['tool-1'],messages:[{content:'private customer details'}]}}:{id:'tool-1',credential:toolSecret};
  const before=await captureRelease(api,'assistant-1');
  assert.equal(before.publishedVersion,'v16');assert.doesNotMatch(JSON.stringify(before),/private|credential|customer/);
  assert.equal(releaseUnchanged(before,await captureRelease(api,'assistant-1')),true);
  toolSecret='changed-secret';assert.equal(releaseUnchanged(before,await captureRelease(api,'assistant-1')),false);
  await assert.rejects(captureRelease(async()=>({id:'assistant-1'}),'assistant-1'));
});
test('one consistently failing case cannot hide inside an aggregate pass rate',()=>{
  const results=Array.from({length:99},()=>({item:{key:'easy'},passed:true}));results.push({item:{key:'critical'},passed:false});
  assert.equal(assessRuns(results,{minimumPassRate:0.95}).pass,false);
  assert.equal(assessRuns([]).pass,false);
});
test('saved eval definition must include every requested judgment and message',()=>{
  const expected={name:'test',messages:[{role:'assistant',judgePlan:{type:'ai'}}]};
  assert.equal(definitionMatches(expected,{...expected,id:'remote'}),true);
  assert.equal(definitionMatches(expected,{...expected,messages:[]}),false);
  assert.equal(definitionMatches(expected,{...expected,messages:[{role:'assistant'}]}),false);
});
test('a failed eval update cannot silently reuse an older definition',async()=>{
  const existing=new Map([['test',{id:'eval-1'}]]);
  await assert.rejects(upsertEval(async()=>{throw new Error('HTTP 500');},{name:'test'},{name:'test'},existing),/HTTP 500/);
});
test('a missing or mismatched run ID cannot substitute cached success',async()=>{
  await assert.rejects(runEval(async()=>({}),{id:'eval-1'},{name:'test'},'assistant-1'),/fresh eval run ID/);
  await assert.rejects(runEval(async()=>({id:'run-1',evalId:'other',status:'ended',endedReason:'mockConversation.done',results:[{status:'pass'}]}),{id:'eval-1'},{name:'test'},'assistant-1'),/another eval/);
});
test('safe runs require explicit safe marking',()=>{
  assert.deepEqual(selectedForRun([{key:'unknown'},{key:'unsafe',safeToRun:false},{key:'safe',safeToRun:true}],{runSafe:true}).map(item=>item.key),['safe']);
});
test('a new run invalidates an older passing report before network work',()=>{
  const fs=require('node:fs');const path=require('node:path');
  const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'vapi-report-test-'));
  try {
    const output=path.join(directory,'report.json');fs.writeFileSync(output,JSON.stringify({ready:true}));
    initializeRunReport({outputPath:path.relative(path.resolve(__dirname,'..'),output),runSafe:true});
    const report=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(report.ready,false);assert.equal(report.status,'incomplete');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
