const test=require('node:test'),assert=require('node:assert/strict');
const {CONFIRMATION_RULE,confirmationStartSpeakingPlan}=require('../server/signupConfirmationTiming');
test('send-confirmation pause preserves ordinary timing and unrelated endpoint rules',()=>{
 const original={waitSeconds:0.4,smartEndpointingPlan:{provider:'livekit',waitFunction:'existing'},customEndpointingRules:[{type:'assistant',regex:'spell your name',timeoutSeconds:3}]};
 const next=confirmationStartSpeakingPlan(original);
 assert.equal(next.smartEndpointingPlan,original.smartEndpointingPlan);
 assert.equal(next.waitSeconds,original.waitSeconds);
 assert.deepEqual(next.customEndpointingRules[1],original.customEndpointingRules[0]);
 const pattern=new RegExp(CONFIRMATION_RULE.regex,'i');
 assert.equal(pattern.test('Should I send this request to the team now?'),true);
 assert.equal(pattern.test('Is all of that correct, and do you want me to submit it now?'),true);
 assert.equal(pattern.test('What is the address where the work needs to be done?'),false);
 assert.deepEqual(confirmationStartSpeakingPlan(next),next);
});
test('recorded Carboni approval timeline no longer reaches the tool before its final transcript',()=>{
 // Observed offsets from first partial "Yes": endpoint 118ms, tool 1171ms,
 // final "Yes, please" 1252ms. Preserve observed model delay when replaying.
 const observed={endpoint:118,tool:1171,final:1252};
 assert.ok(observed.tool<observed.final);
 const replayTool=CONFIRMATION_RULE.timeoutSeconds*1000+(observed.tool-observed.endpoint);
 assert.ok(replayTool>=observed.final);
});
