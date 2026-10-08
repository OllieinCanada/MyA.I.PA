const test=require('node:test');
const assert=require('node:assert/strict');
const {providerFailureDetail}=require('../server/providerFailureDetail');
test('provider diagnostics preserve validation errors but remove exact secrets and private data',()=>{
  const value=providerFailureDetail({message:['Parameter includeAssessment is missing','key abc-def-unknown-secret; owner test@example.com'],body:'must not retain'},['abc-def-unknown-secret']);
  assert.match(value,/includeAssessment is missing/);
  assert.doesNotMatch(value,/abc-def-unknown-secret|test@example.com|must not retain/);
  assert.equal(providerFailureDetail({request:{token:'secret'},data:'arbitrary body'}),'');
  assert.ok(providerFailureDetail({message:'x'.repeat(3000)}).length<=1000);
});
