const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,secret}=require('./helpers/number-fallback-fixture');
const {buildProvisioningResourceName,verifySignupProvisioningAuthorization}=require('../server/signupProvisioning');
const {loadSignupProvisioningContext,registerSignupProvisioningContext}=require('../server/signupProvisioningContext');
const {runProvisioningStep,provisioningStateKey}=require('../server/provisioningState');
const {readRecoveryCopy,saveRecoveryCopy}=require('../server/intakeRecoveryJournal');

test('dry run makes no changes or purchases and returns the exact hash for later approval',async()=>{
 const f=await fixture(),result=await f.run({apply:false});assert.equal(result.applied,false);assert.deepEqual(result.areaOrder,['289','905','365','742']);
 assert.equal(result.numbersPurchased,0);assert.equal(result.expectedContextHash,f.hash);
 assert.deepEqual((await f.prisma.runtimeStore.findUnique({where:{key:f.contextKey}})).data,f.context);
 assert.deepEqual((await f.prisma.runtimeStore.findUnique({where:{key:f.numberKey}})).data,f.number);
});
test('amendment preserves identity, original context/receipt/intake and encrypted replay compatibility',async()=>{
 const f=await fixture(),r=await f.run();assert.equal(r.applied,true);assert.notEqual(r.contextHash,f.hash);
 const context=(await f.prisma.runtimeStore.findUnique({where:{key:f.contextKey}})).data;
 assert.equal(verifySignupProvisioningAuthorization(context.payload,secret),true);assert.equal(context.payload.provisioning.idempotencyKey,f.key);
 const archived=(await f.prisma.runtimeStore.findUnique({where:{key:context.fallbackRecovery.journalKey}})).data;
 assert.deepEqual(archived.priorContext,f.context);assert.deepEqual(archived.priorNumberStage,f.number);assert.ok(archived.priorIntake.sealed);
 const copy=await readRecoveryCopy({prisma:f.prisma,eventKey:f.record.signupAttemptId,secret});assert.deepEqual(copy.payload,context.payload);
 await saveRecoveryCopy({prisma:f.prisma,payload:context.payload,secret});
 assert.equal((await registerSignupProvisioningContext({prisma:f.prisma,payload:f.payload})).provisioning.contextHash,r.contextHash);
 await assert.rejects(loadSignupProvisioningContext({prisma:f.prisma,idempotencyKey:f.key,contextHash:f.hash}),{code:'PROVISIONING_CONTEXT_NOT_REGISTERED'});
});
test('concurrent preparation has one winner; repeated preparation cannot rearm dispatch',async()=>{
 const f=await fixture(),out=await Promise.allSettled([f.run(),f.run()]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(f.run());
});
test('amended paid stage allows one dispatch, preserves evidence and blocks an ambiguous second send',async()=>{
 const f=await fixture(),r=await f.run();let calls=0;
 const input={prisma:f.prisma,kind:'twilio-number',idempotencyKey:f.key,contextHash:r.contextHash,
   execute:async()=>{calls++;throw Object.assign(Error('lost purchase response'),{code:'UND_ERR_SOCKET'});}};
 await Promise.allSettled([runProvisioningStep(input),runProvisioningStep(input)]);
 await assert.rejects(runProvisioningStep(input),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});assert.equal(calls,1);
 const row=(await f.prisma.runtimeStore.findUnique({where:{key:f.numberKey}})).data;
 assert.ok(row.fallbackRecovery);assert.equal(row.originalErrorCode,f.number.originalErrorCode);
 await assert.rejects(f.run());
});
for(const [name,changes] of Object.entries({timeout:{originalErrorCode:'UND_ERR_SOCKET',lastErrorCode:'UND_ERR_SOCKET'},
 generic:{originalErrorCode:'MAKE_SIGNUP_RESPONSE_INCOMPLETE'},changedFailure:{lastErrorCode:'P2028'},
 processing:{status:'processing'},completed:{status:'completed',result:{sid:'PNexisting'}},multipleAttempts:{attempts:2},
 tooRecent:{failedAt:new Date().toISOString()},lease:{leaseExpiresAt:new Date(Date.now()+3600000).toISOString()},
 staleHash:{contextHash:'f'.repeat(64)},previousRecovery:{fallbackRecovery:{at:'already'}},unknownTime:{failedAt:'unknown'}})) {
 test('rejects unsafe number stage: '+name,async()=>{const f=await fixture();await f.patch(f.numberKey,changes);await assert.rejects(f.run());});
}
for(const kind of ['vapi-assistant','vapi-import'])test('rejects any downstream stage: '+kind,async()=>{
 const f=await fixture();await f.prisma.runtimeStore.create({data:{key:provisioningStateKey(kind,f.key),data:{status:'failed'}}});await assert.rejects(f.run(),{code:'DOWNSTREAM_STAGE_EXISTS'});
});
for(const [name,change] of Object.entries({closed:{status:'rejected'},unverified:{smsVerified:false},number:{twilioPhoneNumber:'+13655550123'},
 assistant:{vapiAssistantId:'existing'},phone:{vapiPhoneNumberId:'existing'},billing:{subscriptionId:'sub_existing'},checkout:{checkoutSessionId:'cs_existing'}})) {
 test('rejects changed signup: '+name,async()=>{const f=await fixture();Object.assign(f.record,change);await assert.rejects(f.run());});
}
test('missing, truncated or failed inventory never authorizes amendment',async()=>{
 for(const mutate of [i=>i.complete=false,i=>delete i.twilioNumbers,i=>delete i.vapiPhones]){const f=await fixture();mutate(f.inventory);await assert.rejects(f.run(),{code:'INVENTORY_INCOMPLETE'});}
 const f=await fixture();await assert.rejects(f.run({readInventory:async()=>{throw Error('provider timeout');}}));
});
test('existing resources block amendment, even if malformed; reserve numbers are never selected',async()=>{
 for(const [collection,field,type] of [['twilioNumbers','friendly_name','twilio-number'],['vapiAssistants','name','vapi-assistant'],['vapiPhones','name','vapi-phone']]){
   const f=await fixture();f.inventory[collection].push({[field]:buildProvisioningResourceName(type,f.key)});await assert.rejects(f.run(),{code:'EXISTING_PROVIDER_RESOURCE'});
 }
 const f=await fixture();for(let n=1;n<=5;n++)f.inventory.twilioNumbers.push({friendly_name:'myaipa-reserve-held-20261110-'+n,phone_number:'+1365555012'+n});
 const before=structuredClone(f.inventory);assert.equal((await f.run()).reservesAssigned,0);assert.deepEqual(f.inventory,before);
});
test('stale request hash, disabled flag or invalid actor fail closed',async()=>{
 for(const args of [{expectedContextHash:'f'.repeat(64)},{enabled:false},{actorHash:''},{apply:undefined}]){const f=await fixture();await assert.rejects(f.run(args));}
});
test('record or stage changes during inventory reads invalidate the entire plan',async()=>{
 const f=await fixture();await assert.rejects(f.run({readInventory:async()=>{f.record.ownerPhone='+19055550111';return f.inventory;}}),{code:'SIGNUP_CHANGED'});
 const g=await fixture();await assert.rejects(g.run({readInventory:async()=>{await g.patch(g.numberKey,{attempts:2});return g.inventory;}}),{code:'SAVED_STATE_CHANGED'});
});
test('intake corruption fails closed and partial transaction failure rolls all changes back',async()=>{
 const f=await fixture();const {journalKey}=require('../server/intakeRecoveryJournal');await f.patch(journalKey(f.record.signupAttemptId),{payloadHash:'f'.repeat(64)});await assert.rejects(f.run());
 const g=await fixture(),original=g.prisma.runtimeStore.update;let updates=0;
 g.prisma.runtimeStore.update=async args=>{if(++updates===2)throw Error('simulated transaction failure');return original(args);};
 await assert.rejects(g.run());assert.deepEqual((await g.prisma.runtimeStore.findUnique({where:{key:g.contextKey}})).data,g.context);
});
