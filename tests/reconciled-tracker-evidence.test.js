'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {digest}=require('../server/signupAssociationRepair');
const {readSetupEvidence}=require('../server/adminSignupSetup');
const {normalizeSignupProvisioningPayload,buildProvisioningAccountKey}=require('../server/signupProvisioning');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
function fixture(){
 const record={businessName:'Invented Electric',ownerEmail:'fake@example.test',ownerPhone:'+19055550100',twilioPhoneNumber:'+13655550101',vapiAssistantId:'fake-assistant',vapiPhoneNumberId:'fake-phone',smsVerified:true,status:'setup_error'};
 const payload=normalizeSignupProvisioningPayload(record,{signingSecret:'invented-fixture-signing-secret'}),key=buildProvisioningAccountKey(record.ownerEmail,record.ownerPhone,record.businessName);
 record.signupAttemptId=buildMakeSignupEventKey(payload);
 const context={payload,contextHash:payload.provisioning.contextHash},phantomId='signup_'+'a'.repeat(32);
 const values={twilioPhoneNumber:record.twilioPhoneNumber,vapiAssistantId:record.vapiAssistantId,vapiPhoneNumberId:record.vapiPhoneNumberId};
 const id=digest({ids:[record.signupAttemptId,phantomId],contextHash:context.contextHash,values});
 record.resourceAssociationRepair={id,sourceId:record.signupAttemptId,phantomId,values};
 const rows=[['phoneNumber',record.twilioPhoneNumber],['phoneNumberId',record.vapiPhoneNumberId],['assistantId',record.vapiAssistantId]].map(([matchType,matchValue],i)=>({id:i+10,businessId:7,matchType,matchValue}));
 const operationId=digest({version:1,phoneId:record.vapiPhoneNumberId});
 const association={phase:'completed',repairId:id,scope:{sourceId:record.signupAttemptId,phantomId,number:record.twilioPhoneNumber,assistantId:record.vapiAssistantId,phoneId:record.vapiPhoneNumberId}};
 const mapping={phase:'completed',operationId,inserted:structuredClone(rows)};
 const store=new Map([[contextStoreKey(key),{data:context}],['signup-association-repair:v1:'+id,{data:association}],['bounded-business-mapping:v1:'+operationId,{data:mapping}]]);
 for(const [kind,result]of [['twilio-number',{twilioPhoneNumber:record.twilioPhoneNumber}],['vapi-assistant',{assistantId:record.vapiAssistantId,contentFingerprint:'f'.repeat(64)}],['vapi-import',{id:record.vapiPhoneNumberId,number:record.twilioPhoneNumber,assistantId:record.vapiAssistantId}]])store.set(provisioningStateKey(kind,key),{data:{status:'completed',contextHash:context.contextHash,result}});
 let transactions=0;
 const prisma={runtimeStore:{findUnique:async({where})=>store.get(where.key)},vapiBusinessMapping:{findMany:async()=>rows},business:{findUnique:async()=>({id:7,vapiMappings:rows})},$transaction:async(fn,opts)=>{assert.equal(opts.isolationLevel,'RepeatableRead');transactions++;return fn(prisma);}};
 return {record,context,rows,association,mapping,store,prisma,key,transactions:()=>transactions};
}
test('completed journals and current exact mappings fix only the read-only projection',async()=>{
 const f=fixture(),before=JSON.stringify(f.record),result=await readSetupEvidence(f);
 for(const id of ['business','number-mapping','phone-id-mapping','assistant-mapping'])assert.equal(result.groups[1].checks.find(c=>c.id===id).state,'verified');
 assert.equal(result.businessEvidenceSource,'completed_guarded_reconciliation_and_current_mappings');
 assert.equal(result.groups[1].checks.find(c=>c.id==='script').state,'pending');
 assert.match(result.groups[1].checks.find(c=>c.id==='script').detail,/not a live comparison/);
 assert.ok(result.groups[2].checks.every(c=>c.state==='pending'));
 assert.ok(result.groups[3].checks.every(c=>c.state==='pending'));
 assert.equal(JSON.stringify(f.record),before);assert.equal(f.transactions(),1);
});
for(const [name,change]of [
 ['association uncertain',f=>f.association.phase='prepared'],['mapping uncertain',f=>f.mapping.phase='attempt_started'],
 ['changed journal target',f=>f.association.scope.number='+13655550199'],['changed journal receipt',f=>f.association.repairId='e'.repeat(64)],
 ['different owner business',f=>f.rows[2].businessId=9],['shared mapping',f=>f.rows.push({...f.rows[0],id:99,businessId:9})],
 ['missing mapping',f=>f.rows.pop()],['duplicate mapping',f=>f.rows[2]={...f.rows[1]}],
 ['changed mapping id',f=>f.rows[0].id=90],['missing journal',f=>f.store.delete('bounded-business-mapping:v1:'+f.mapping.operationId)],
 ['changed source values',f=>f.record.vapiAssistantId='changed'],['conflicting saved business',f=>f.record.businessId=9],
 ['foreign receipt context',f=>f.store.get(provisioningStateKey('vapi-assistant',f.key)).data.contextHash='e'.repeat(64)],
 ['conflicting import receipt',f=>f.store.get(provisioningStateKey('vapi-import',f.key)).data.result.assistantId='foreign'],
 ['no transaction adapter',f=>delete f.prisma.$transaction]
])test(name+' does not promote mapping evidence',async()=>{const f=fixture();change(f);const r=await readSetupEvidence(f);assert.notEqual(r.businessEvidenceSource,'completed_guarded_reconciliation_and_current_mappings');assert.ok(r.groups[3].checks.every(c=>c.state==='pending'));});
test('database errors remain unavailable instead of a false green',async()=>{const f=fixture();f.prisma.$transaction=async()=>{throw Error('synthetic unavailable');};await assert.rejects(readSetupEvidence(f),/synthetic unavailable/);});
test('a retained ready label cannot make a recovered projection grant overall readiness',async()=>{const f=fixture();f.record.status='setup_ready';const r=await readSetupEvidence(f);assert.equal(r.groups[3].checks.find(c=>c.id==='ready').state,'pending');assert.equal(f.record.status,'setup_ready');});
