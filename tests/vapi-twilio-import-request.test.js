const test = require('node:test');
const assert = require('node:assert/strict');
const {buildTwilioImportRequest} = require('../server/vapiTwilioImportRequest');
const valid = {phoneNumber:'+19055550123',assistantId:'00000000-0000-4000-8000-000000000001',accountSid:'AC'+'a'.repeat(32),authToken:'b'.repeat(32),name:'Isolated import fixture'};
test('validated import references an existing number/assistant and preserves Twilio SMS routing',()=>{
  const p=buildTwilioImportRequest(valid);
  assert.equal(p.twilioPhoneNumber,valid.phoneNumber);assert.equal(p.assistantId,valid.assistantId);assert.equal(p.smsEnabled,false);
});
test('bad phone, assistant, credentials and overlong names stop before dispatch',()=>{
  for(const patch of [{phoneNumber:'3702'},{assistantId:'wrong'},{accountSid:'bad'},{authToken:'bad'},{name:'x'.repeat(41)}])assert.throws(()=>buildTwilioImportRequest({...valid,...patch}),{code:'VAPI_IMPORT_REQUEST_INVALID'});
});
