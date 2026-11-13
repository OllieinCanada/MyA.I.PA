const test=require('node:test'),assert=require('node:assert/strict');
const {FILES,SQL_CASES,validCoverage}=require('../scripts/compose-bounded-mapping-entry');
test('entry publication allowlist excludes operational evidence and pins exact dependencies',()=>{
  assert.equal(FILES.length,8);assert.equal(new Set(FILES).size,8);assert.ok(FILES.every(x=>!x.includes('diagnostics/')));
  const pins=require('../scripts/bounded-mapping-entry-pins.json');
  assert.equal(pins.association,'f452de511657c41b3ced081aed07b49379656cf3');
  assert.equal(pins.writer,'932346e199636732d19ccb8bb73c80059447530e');
  assert.equal(pins.adapter,'0765667d0226db61eec81ec08f8de373922987b9');
});
test('SQL readiness refuses subsets, duplicate cases, skips, synthetic mode or unproven cleanup',()=>{
  const good={sqlMode:'real-postgresql',providerMode:'synthetic-no-send',disposableDatabaseRemoved:true,outcomes:SQL_CASES.map(id=>({id,status:'passed'}))};
  assert.equal(validCoverage(good),true);
  for(const bad of [{...good,outcomes:good.outcomes.slice(1)},{...good,outcomes:good.outcomes.map((x,i)=>i?x:{...x,status:'skipped'})},
    {...good,outcomes:good.outcomes.map((x,i)=>i?x:good.outcomes[1])},{...good,sqlMode:'synthetic'}, {...good,disposableDatabaseRemoved:false}])assert.equal(validCoverage(bad),false);
});
