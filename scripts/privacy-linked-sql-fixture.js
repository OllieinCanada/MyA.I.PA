'use strict';
// Controller-owned fictitious rows only; no production reader or mutation route.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const CHECKS=['six-real-linked-model-readers','shared-foreign-tenant-linked-preview','nullable-links-use-required-parent','handoff-tenant-conflict-refused',
 'handoff-call-conflict-refused','event-attempt-conflict-refused','required-parent-orphan-fk-refused','orphan-file-link-stays-unresolved',
 'file-business-conflict-refused','file-external-identity-conflict-refused','file-provider-conflict-refused','legacy-file-row-stays-unresolved',
 'inaccessible-linked-model-refused','file-change-during-real-sql-read-refused'];
async function seed({use,source}){
 return use(source,async c=>{
  const a=(await c.query('SELECT id FROM "Call" WHERE "businessId"=11 AND "callerId"=21')).rows;
  const b=(await c.query('SELECT id FROM "Call" WHERE "businessId"=12 AND "callerId"=21')).rows;
  const leads=(await c.query('SELECT id FROM "Lead" WHERE "businessId"=11 AND "callerId"=21')).rows;
  assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(leads.length,1);
  const callA=a[0].id,callB=b[0].id,leadA=leads[0].id;
  await c.query('UPDATE "Call" SET "externalProvider"=\'vapi\',"externalId"=$2 WHERE id=$1',[callA,'fixture-index-a']);
  await c.query('UPDATE "Call" SET "externalProvider"=\'vapi\',"externalId"=$2 WHERE id=$1',[callB,'fixture-index-b']);
  await c.query('UPDATE "Lead" SET "callId"=$2 WHERE id=$1',[leadA,callA]);
  const leadB=(await c.query('INSERT INTO "Lead" ("businessId","callerId","callId",intent,urgency,summary,"callbackNumber",name) VALUES(12,21,$1,\'GENERAL\',\'LOW\',\'Fictitious foreign enquiry\',\'+15555550121\',\'Fictitious person\') RETURNING id',[callB])).rows[0].id;
  for(const [suffix,businessId,callId,leadId]of [['a',11,callA,leadA],['b',12,callB,leadB]]){
   await c.query('INSERT INTO "CallNote" ("callId",body) VALUES($1,\'Fictitious note\')',[callId]);
   await c.query('INSERT INTO "CallTask" ("callId",title,"updatedAt") VALUES($1,\'Fictitious task\',now())',[callId]);
   await c.query('INSERT INTO "LeadOutcomeEvent" (id,"leadId","businessId","fromStatus","toStatus",source) VALUES($1,$2,$3,\'NEW\',\'REVIEWED\',\'fixture\')',['fixture-outcome-'+suffix,leadId,businessId]);
   await c.query('INSERT INTO "LeadHandoff" (id,"leadId","businessId","callId","ownerPhone","acknowledgementKey","acknowledgementExpiresAt","updatedAt") VALUES($1,$2,$3,$4,\'+15555550111\',$5,\'2035-01-01\',now())',['fixture-handoff-'+suffix,leadId,businessId,callId,'fixture-ack-'+suffix]);
   await c.query('INSERT INTO "LeadNotificationAttempt" (id,"handoffId","recipientRole","recipientPhone","attemptNumber",status,"updatedAt") VALUES($1,$2,\'OWNER\',\'+15555550111\',1,\'DELIVERED\',now())',['fixture-attempt-'+suffix,'fixture-handoff-'+suffix]);
   await c.query('INSERT INTO "LeadNotificationEvent" (id,"handoffId","attemptId",status,source) VALUES($1,$2,$3,\'delivered\',\'fixture\')',['fixture-event-'+suffix,'fixture-handoff-'+suffix,'fixture-attempt-'+suffix]);
  }
  return {callA,callB,leadA,leadB,syncStore:{'fixture-index-a':{vapiCallId:'fixture-index-a',localCallId:callA,businessId:11},'fixture-index-b':{vapiCallId:'fixture-index-b',localCallId:callB,businessId:12}}};
 });
}
async function exercise({check,use,source,root,preview,actor,role,linked}){
 const target={businessId:11,callerId:21},file=path.join(root,'vapi-call-sync.json');
 const sql=(text,params)=>use(source,c=>c.query(text,params));
 async function changed(text,values,restore,restoreValues,work){await sql(text,values);try{await work();}finally{await sql(restore,restoreValues);}}
 async function changedFile(transform,work){const old=fs.readFileSync(file);fs.writeFileSync(file,JSON.stringify(transform(JSON.parse(old))));try{await work();}finally{fs.writeFileSync(file,old);}}
 const refusal=code=>assert.rejects(preview()(target),e=>e.code===code);
 await check('six-real-linked-model-readers',async()=>{const r=await preview()(target);for(const n of ['CallNote','CallTask','LeadOutcomeEvent','LeadHandoff','LeadNotificationAttempt','LeadNotificationEvent'])assert.equal(r.inventory.filter(x=>x.surface==='database:'+n).length,1);
  assert.equal(r.inventory.filter(x=>x.surface==='file:vapi-call-sync.json').length,1);assert.equal(r.coverage.covered.length,11);assert.equal(r.coverage.missing.length,29);assert.equal(r.ready,false);assert.equal(r.applyAllowed,false);});
 await check('shared-foreign-tenant-linked-preview',async()=>{const r=await preview()({businessId:12,callerId:21});assert.equal(r.sharedIdentity,true);assert.equal(r.foreignTenantCount,1);assert.equal(r.inventory.length,11);assert.ok(!JSON.stringify(r).includes('fixture-handoff-a'));});
 await check('nullable-links-use-required-parent',async()=>{
  await changed('UPDATE "LeadHandoff" SET "callId"=NULL WHERE id=$1',['fixture-handoff-a'],'UPDATE "LeadHandoff" SET "callId"=$2 WHERE id=$1',['fixture-handoff-a',linked.callA],async()=>{
   await changed('UPDATE "LeadNotificationEvent" SET "attemptId"=NULL WHERE id=$1',['fixture-event-a'],'UPDATE "LeadNotificationEvent" SET "attemptId"=$2 WHERE id=$1',['fixture-event-a','fixture-attempt-a'],async()=>assert.equal((await preview()(target)).inventory.length,11));
  });
 });
 await check('handoff-tenant-conflict-refused',()=>changed('UPDATE "LeadHandoff" SET "businessId"=12 WHERE id=$1',['fixture-handoff-a'],'UPDATE "LeadHandoff" SET "businessId"=11 WHERE id=$1',['fixture-handoff-a'],()=>refusal('PRIVACY_LINK_BINDING_CONFLICT')));
 await check('handoff-call-conflict-refused',()=>changed('UPDATE "LeadHandoff" SET "callId"=$2 WHERE id=$1',['fixture-handoff-a',linked.callB],'UPDATE "LeadHandoff" SET "callId"=$2 WHERE id=$1',['fixture-handoff-a',linked.callA],()=>refusal('PRIVACY_LINK_BINDING_CONFLICT')));
 await check('event-attempt-conflict-refused',()=>changed('UPDATE "LeadNotificationEvent" SET "attemptId"=$2 WHERE id=$1',['fixture-event-a','fixture-attempt-b'],'UPDATE "LeadNotificationEvent" SET "attemptId"=$2 WHERE id=$1',['fixture-event-a','fixture-attempt-a'],()=>refusal('PRIVACY_LINK_BINDING_CONFLICT')));
 await check('required-parent-orphan-fk-refused',()=>use(source,async c=>{await c.query('BEGIN');try{await assert.rejects(c.query('INSERT INTO "CallNote" (id,"callId",body) VALUES(2147483000,2147483000,\'fake orphan\')'),e=>e.code==='23503');}finally{await c.query('ROLLBACK');}}));
 await check('orphan-file-link-stays-unresolved',()=>changedFile(v=>{v['fixture-index-a'].localCallId=2147483000;return v;},async()=>{const r=await preview()(target);assert.equal(r.coverage.missing.length,30);assert.ok(r.coverage.unresolved.some(s=>s.surface==='file:vapi-call-sync.json'));assert.equal(r.inventory.filter(x=>x.surface.startsWith('file:')).length,0);assert.equal(r.applyAllowed,false);}));
 await check('file-business-conflict-refused',()=>changedFile(v=>{v['fixture-index-a'].businessId=12;return v;},()=>refusal('PRIVACY_FILE_BINDING_CONFLICT')));
 await check('file-external-identity-conflict-refused',()=>changedFile(v=>({...v,'fixture-wrong-index':{vapiCallId:'fixture-wrong-index',localCallId:linked.callA,businessId:11}}),()=>refusal('PRIVACY_FILE_BINDING_CONFLICT')));
 await check('file-provider-conflict-refused',()=>changed('UPDATE "Call" SET "externalProvider"=\'other\' WHERE id=$1',[linked.callA],'UPDATE "Call" SET "externalProvider"=\'vapi\' WHERE id=$1',[linked.callA],()=>refusal('PRIVACY_FILE_BINDING_CONFLICT')));
 await check('legacy-file-row-stays-unresolved',()=>changedFile(v=>({...v,legacy:{ownerEmail:'fixture@example.invalid'}}),async()=>{const r=await preview()(target);assert.equal(r.coverage.missing.length,30);assert.equal(r.coverage.complete,false);assert.equal(r.ready,false);}));
 await check('inaccessible-linked-model-refused',async()=>{
  assert.match(role,/^privacy_read_[a-f0-9]{12}$/);await sql('REVOKE SELECT ON "CallNote" FROM "'+role+'"');
  try{const grant=(await sql('SELECT has_table_privilege($1,\'"CallNote"\',\'SELECT\') AS allowed',[role])).rows[0];assert.equal(grant.allowed,false);await assert.rejects(preview()(target));}
  finally{await sql('GRANT SELECT ON "CallNote" TO "'+role+'"');}assert.equal((await preview()(target)).ready,false);
 });
 await check('file-change-during-real-sql-read-refused',async()=>{
  const old=fs.readFileSync(file);let changedOnce=false;
  const concurrent=actor.$extends({query:{call:{$allOperations:async({args,query})=>{const rows=await query(args);if(!changedOnce){changedOnce=true;fs.writeFileSync(file,JSON.stringify({...JSON.parse(old),concurrent:{syntheticOnly:true}}));}return rows;}}}});
  const readInventory=require('../server/privacyInventoryReader').createReadOnlyInventoryReader({prisma:concurrent,directory:root,discoverLinked:true});
  try{await assert.rejects(preview({readInventory})(target),e=>e.code==='PRIVACY_FILE_SNAPSHOT_CHANGED');assert.equal(changedOnce,true);}finally{fs.writeFileSync(file,old);}
 });
}
module.exports={seed,exercise,CHECKS};
