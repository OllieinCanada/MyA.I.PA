const crypto = require('node:crypto');
const {normalizeSignupProvisioningPayload} = require('../../server/signupProvisioning');
const {buildMakeSignupEventKey} = require('../../server/makeSignupWebhook');
const {contextStoreKey} = require('../../server/signupProvisioningContext');
const {provisioningStateKey} = require('../../server/provisioningState');
const {saveRecoveryCopy} = require('../../server/intakeRecoveryJournal');
const {prepareNumberFallbackRecovery} = require('../../server/signupNumberFallbackRecovery');
const secret = 'isolated-number-recovery-fixture-secret';
function memoryPrisma() {
  let rows = new Map(), tail = Promise.resolve();
  const store = {
    async findUnique({where}) {return rows.has(where.key)?{key:where.key,data:structuredClone(rows.get(where.key))}:null;},
    async create({data}) {if(rows.has(data.key))throw Error('duplicate');rows.set(data.key,structuredClone(data.data));return data;},
    async update({where,data}) {if(!rows.has(where.key))throw Error('missing');rows.set(where.key,structuredClone(data.data));return data;},
    async upsert({where,update,create}) {rows.set(where.key,structuredClone(rows.has(where.key)?update.data:create.data));},
  };
  return {runtimeStore:store,$transaction(work){const job=tail.then(async()=>{const before=structuredClone(rows);try{return await work({runtimeStore:store,$queryRaw:async()=>[]});}catch(e){rows=before;throw e;}});tail=job.catch(()=>{});return job;}};
}
async function fixture(prisma=memoryPrisma()) {
  const suffix=crypto.randomUUID(), now=Date.now();
  // Match the JSON storage boundary, including removal of undefined properties.
  const payload=JSON.parse(JSON.stringify(normalizeSignupProvisioningPayload({submissionId:suffix,businessName:'Fixture Electrical '+suffix,
    ownerEmail:suffix+'@example.test',ownerPhone:'+19055550198',businessPhone:'+19055550199',
    businessAddress:'23 Robb Street, Hamilton, ON L8L 1A1'}, {signingSecret:secret})));
  const key=payload.provisioning.idempotencyKey, hash=payload.provisioning.contextHash;
  const record={signupAttemptId:buildMakeSignupEventKey(payload),businessName:payload.businessName,
    ownerEmail:payload.ownerEmail,ownerPhone:payload.ownerPhone,status:'setup_error',smsVerified:true};
  const contextKey=contextStoreKey(key), numberKey=provisioningStateKey('twilio-number',key);
  const at=new Date(now-3600000).toISOString();
  const context={payload,contextHash:hash,idempotencyKey:key,lockedAt:at};
  const number={kind:'twilio-number',contextHash:hash,status:'failed',attempts:1,failedAt:at,firstFailedAt:at,
    dispatchStartedAt:at,originalErrorCode:'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE',
    lastErrorCode:'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE'};
  await prisma.runtimeStore.create({data:{key:contextKey,data:context}});
  await prisma.runtimeStore.create({data:{key:numberKey,data:number}});
  await saveRecoveryCopy({prisma,payload,secret,now});
  const inventory={complete:true,twilioNumbers:[],vapiAssistants:[],vapiPhones:[]};
  const options={prisma,getRecord:id=>id===record.signupAttemptId?record:null,readInventory:async()=>inventory,
    signupAttemptId:record.signupAttemptId,expectedContextHash:hash,actorHash:'a'.repeat(32),signingSecret:secret,
    enabled:true,apply:true,now};
  const patch=async(k,changes)=>{const row=await prisma.runtimeStore.findUnique({where:{key:k}});await prisma.runtimeStore.update({where:{key:k},data:{data:{...row.data,...changes}}});};
  return {prisma,key,hash,payload,record,context,number,contextKey,numberKey,inventory,options,patch,
    run:overrides=>prepareNumberFallbackRecovery({...options,...overrides})};
}
module.exports={fixture,memoryPrisma,secret};
