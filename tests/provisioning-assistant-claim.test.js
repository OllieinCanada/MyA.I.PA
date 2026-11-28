'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runProvisioningStep,provisioningStateKey}=require('../server/provisioningState');

// Deterministic rollback/acknowledgement model, not real SQL timing evidence.
function fixture({claimMs=0,loseClaimAck=false,failLock=false}={}){
 let rows=new Map(),transactions=0;const calls=[];
 const store=map=>({findUnique:async({where})=>map.has(where.key)?{data:structuredClone(map.get(where.key))}:null,
  upsert:async({where,update,create})=>{const data=structuredClone(map.has(where.key)?update.data:create.data);map.set(where.key,data);return {data};}});
 const prisma={runtimeStore:{findUnique:args=>store(rows).findUnique(args)},async $transaction(fn,options){
  const ordinal=++transactions,working=new Map(structuredClone([...rows])),sql=[];calls.push({ordinal,options,sql});
  const result=await fn({runtimeStore:store(working),$executeRaw:async parts=>{sql.push(parts.join('?'));},$queryRaw:async()=>{
   if(failLock&&ordinal===1)throw Object.assign(Error('Synthetic lock wait exceeded'),{code:'P2010'});return [];
  }});
  if(ordinal===1&&claimMs>(options?.timeout??5000))throw Object.assign(Error('Synthetic expired claim'),{code:'P2028'});
  rows=working;
  if(ordinal===1&&loseClaimAck)throw Object.assign(Error('Synthetic committed claim acknowledgement lost'),{code:'P2028'});
  return result;
 }};
 return {prisma,calls,read:key=>structuredClone(rows.get(key))};
}
const args=(prisma,execute,kind='vapi-assistant')=>({prisma,kind,idempotencyKey:'synthetic-claim-only',contextHash:'synthetic-context',execute,verifyCompleted:async()=>true});

test('assistant claim uses a 15-second deadline, two-second admission and transaction-local lock bound only',async()=>{
 const f=fixture({claimMs:12173});let creates=0;const input=args(f.prisma,async()=>{creates++;return {assistantId:'synthetic-only'};});
 await runProvisioningStep(input);assert.equal(creates,1);
 assert.deepEqual(f.calls.map(c=>c.options),[{maxWait:2000,timeout:15000},{timeout:10000},undefined]);
 assert.deepEqual(f.calls[0].sql,["SET LOCAL lock_timeout = '5s'"]);
 assert.equal(f.calls[1].sql.length+f.calls[2].sql.length,0);
 assert.equal((await runProvisioningStep(input)).reused,true);assert.equal(creates,1);
});
test('purchase, import and message claim budgets are unchanged',async()=>{
 for(const kind of ['twilio-number','vapi-import','signup-sms','signup-completion-email']){
  const f=fixture();await runProvisioningStep(args(f.prisma,async()=>({synthetic:true}),kind));
  assert.equal(f.calls[0].options,undefined);assert.equal(f.calls[0].sql.length,0);
 }
});
for(const scenario of [{claimMs:15001},{failLock:true}])test('failed assistant claim never dispatches or retries: '+JSON.stringify(scenario),async()=>{
 const f=fixture(scenario);let creates=0,reconciles=0;
 const input={...args(f.prisma,async()=>{creates++;return {};}),reconcile:async()=>{reconciles++;return null;}};
 await assert.rejects(runProvisioningStep(input),{code:scenario.failLock?'P2010':'P2028'});
 assert.equal(creates,0);assert.equal(reconciles,0);assert.equal(f.calls.length,1);
 assert.equal(f.read(provisioningStateKey(input.kind,input.idempotencyKey)),undefined);
});
test('lost claim acknowledgement remains leased; a manual second request cannot create an agent',async()=>{
 const f=fixture({loseClaimAck:true});let creates=0;const input=args(f.prisma,async()=>{creates++;return {};});
 await assert.rejects(runProvisioningStep(input),{code:'P2028'});
 await assert.rejects(runProvisioningStep(input),{code:'PROVISIONING_ALREADY_IN_PROGRESS'});assert.equal(creates,0);
 const row=f.read(provisioningStateKey(input.kind,input.idempotencyKey));assert.equal(row.status,'processing');assert.equal(row.dispatchStartedAt,null);
});
