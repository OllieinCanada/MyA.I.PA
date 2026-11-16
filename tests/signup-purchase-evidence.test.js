const { test } = require('node:test');
const assert = require('node:assert/strict');
const { purchaseEvidence } = require('../server/signupPurchaseEvidence');
const { projectSetup } = require('../server/adminSignupSetup');
const coverage = 'exact_context_and_saved_receipts';
const record = { twilioPhoneNumber: '+12895550111', vapiAssistantId: 'private-assistant' };
const receipt = { status:'failed', dispatchStartedAt:'2026-11-15T10:58:40Z', failedAt:'2026-11-15T10:58:45Z', lastErrorCode:'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE', lastProviderStatus:400 };
test('failed dispatch remains unknown; error and evidence timestamps are surfaced safely', () => {
  const e = purchaseEvidence(record, {'twilio-number':receipt},coverage);
  assert.equal(e.outcome,'unknown'); assert.equal(e.recordedError,receipt.lastErrorCode);
  assert.equal(e.httpStatus,400); assert.equal(e.evidenceAt,new Date(receipt.failedAt).toISOString());
  assert.match(e.explanation,/no suitable number/); assert.equal(e.resumeAllowed,false); assert.equal(e.liveProviderVerified,false);
  assert.doesNotMatch(JSON.stringify(e),/private-assistant|12895550111/);
});
test('receipt mismatch never surfaces a foreign error or outcome', () => {
  const e = purchaseEvidence(record, {'twilio-number':receipt},'receipt_context_mismatch');
  assert.equal(e.receiptStatus,'unknown'); assert.equal(e.recordedError,'Not recorded'); assert.equal(e.evidenceAt,null);
});
test('explicit pre-dispatch failure is qualified to this attempt, not all historic purchases', () => {
  const e = purchaseEvidence({}, {'twilio-number':{...receipt,dispatchStartedAt:null}},coverage);
  assert.equal(e.outcome,'not_dispatched'); assert.match(e.outcomeLabel,/this attempt/); assert.equal(e.resumeAllowed,false);
});
test('missing legacy dispatch marker cannot prove non-purchase', () => {
  const {dispatchStartedAt,...legacy} = receipt;
  assert.equal(purchaseEvidence({}, {'twilio-number':legacy},coverage).outcome,'unknown');
});
test('matching completed purchase is saved proof only; mismatched number, missing SID and empty result stay unknown', () => {
  const completed = {status:'completed',completedAt:receipt.failedAt,result:{phoneNumber:record.twilioPhoneNumber,twilioSid:'PN'+'a'.repeat(32)}};
  const e = purchaseEvidence(record,{'twilio-number':completed},coverage);
  assert.equal(e.outcome,'purchase_recorded'); assert.equal(e.liveProviderVerified,false); assert.equal(e.resumeAllowed,false);
  for (const result of [{},{...completed.result,phoneNumber:'+13655550199'},{phoneNumber:record.twilioPhoneNumber}])
    assert.equal(purchaseEvidence(record,{'twilio-number':{...completed,result}},coverage).outcome,'unknown');
});
test('raw provider detail, credentials and unrecognized error codes never leave the projection', () => {
  const e = purchaseEvidence({...record,ownerEmail:'private@example.test'}, {'twilio-number':{...receipt,
    lastErrorCode:'PRIVATE_FIXTURE_SECRET',lastProviderDetail:'Bearer sensitive fixture',claimToken:'sensitive-claim',lastProviderStatus:999}},coverage);
  assert.equal(e.recordedError,'Unrecognized saved code'); assert.equal(e.httpStatus,null);
  assert.doesNotMatch(JSON.stringify(e),/PRIVATE_FIXTURE_SECRET|sensitive|private@example|claimToken|lastProviderDetail/);
});
test('numeric Twilio code is retained but cannot imply purchase or recovery completion', () => {
  const e=purchaseEvidence({}, {'twilio-number':{...receipt,lastErrorCode:'21452'}},coverage);
  assert.equal(e.recordedError,'21452'); assert.equal(e.outcome,'unknown');
});
test('summary and unavailable context never promote receipt claims', () => {
  for(const c of ['saved_record_only','exact_context_unavailable','unknown']) {
    const e=purchaseEvidence(record,{'twilio-number':receipt},c);assert.equal(e.recordedError,'Not recorded');assert.equal(e.receiptStatus,'unknown');
  }
  assert.equal(projectSetup({}).purchaseEvidence.resumeAllowed,false);
});
