'use strict';
// Disposable fixture controller only. All data is generated; never a production writer.
const assert=require('node:assert/strict');
const CHECKS=['optional-real-three-models','optional-foreign-tenant-shared-identity',
 'optional-support-mixed-null','optional-appointment-mixed-null','optional-sync-mixed-null',
 'optional-support-parent-tenant-conflict','optional-appointment-parent-tenant-conflict','optional-sync-parent-tenant-conflict',
 'optional-staff-tenant-conflict','optional-connection-tenant-conflict','optional-other-caller-not-matched-by-contact',
 'optional-null-extra-links','optional-orphan-parent-fk-refused','optional-orphan-extra-fk-refused','optional-inaccessible-model-refused'];
async function seed({use,source,linked}){
 const uniqueCall=await use(source,async c=>{const r=(await c.query('SELECT id FROM "Call" WHERE "businessId"=11 AND "callerId"=22')).rows;assert.equal(r.length,1);return r[0].id;});
 await use(source,async c=>{
  for(const [suffix,businessId,callId,leadId]of [['a',11,linked.callA,linked.leadA],['b',12,linked.callB,linked.leadB]]){
   await c.query('INSERT INTO "StaffMember" (id,"businessId",name,"updatedAt") VALUES($1,$2,\'Fictitious staff\',now())',['optional-staff-'+suffix,businessId]);
   await c.query('INSERT INTO "FieldServiceConnection" (id,"businessId",provider,"accessTokenEncrypted","updatedAt") VALUES($1,$2,\'FIXTURE\',\'fixture-unusable-not-a-credential\',now())',['optional-connection-'+suffix,businessId]);
   for(const n of [1,2]){
    await c.query('INSERT INTO "SupportReport" (id,"businessId","callId",description,suggestions,diagnostics,"updatedAt") VALUES($1,$2,$3,\'Fictitious support\',\'{}\',\'{}\',now())',[`optional-support-${suffix}${n}`,businessId,callId]);
    await c.query('INSERT INTO "AppointmentRequest" (id,"businessId","callId","staffMemberId","customerName","customerPhone",service,"requestedStart","calendarToken","updatedAt") VALUES($1,$2,$3,$4,\'Same fictitious contact\',\'+15555550121\',\'Fixture service\',\'2035-01-01\',$5,now())',[`optional-appointment-${suffix}${n}`,businessId,callId,'optional-staff-'+suffix,`fixture-calendar-${suffix}${n}`]);
    await c.query('INSERT INTO "FieldServiceSync" (id,"businessId","connectionId","leadId",provider,"entityType","idempotencyKey","updatedAt") VALUES($1,$2,$3,$4,\'FIXTURE\',\'fixture\',$5,now())',[`optional-sync-${suffix}${n}`,businessId,'optional-connection-'+suffix,leadId,`fixture-sync-${suffix}${n}`]);
   }
  }
 });
 return {uniqueCall};
}
async function exercise({check,use,source,preview,role,linked,optional}){
 const target={businessId:11,callerId:21};const sql=(text,params)=>use(source,c=>c.query(text,params));
 async function change(text,values,restore,oldValues,work){await sql(text,values);try{await work();}finally{await sql(restore,oldValues);}}
 const refuse=()=>assert.rejects(preview()(target),e=>e.code==='PRIVACY_OPTIONAL_BINDING_CONFLICT');
 await check('optional-real-three-models',async()=>{const r=await preview()(target);for(const s of ['SupportReport','AppointmentRequest','FieldServiceSync'])assert.equal(r.inventory.filter(v=>v.surface==='database:'+s).length,2);
  assert.equal(r.inventory.length,17);assert.equal(r.coverage.covered.length,14);assert.equal(r.coverage.missing.length,26);assert.equal(r.partialInventory.length,0);assert.equal(r.ready,false);assert.equal(r.applyAllowed,false);});
 await check('optional-foreign-tenant-shared-identity',async()=>{const r=await preview()({businessId:12,callerId:21});assert.equal(r.sharedIdentity,true);assert.equal(r.inventory.length,17);assert.ok(!JSON.stringify(r).includes('optional-support-a'));});
 for(const [kind,table,key,old]of [['support','SupportReport','callId',linked.callA],['appointment','AppointmentRequest','callId',linked.callA],['sync','FieldServiceSync','leadId',linked.leadA]]){
  await check('optional-'+kind+'-mixed-null',()=>change('UPDATE "'+table+'" SET "'+key+'"=NULL WHERE id=$1',[`optional-${kind}-a2`],
   'UPDATE "'+table+'" SET "'+key+'"=$2 WHERE id=$1',[`optional-${kind}-a2`,old],async()=>{
    const r=await preview()(target),surface='database:'+table;assert.equal(r.inventory.filter(v=>v.surface===surface).length,0);assert.equal(r.partialInventory.filter(v=>v.surface===surface).length,1);
    assert.ok(r.partialInventory.every(v=>v.candidateOnly===true));assert.ok(r.coverage.missing.includes(surface));assert.ok(!r.coverage.covered.includes(surface));assert.equal(r.coverage.missing.length,27);
    assert.equal(r.ready,false);assert.equal(r.applyAllowed,false);assert.ok(!JSON.stringify(r).includes(`optional-${kind}-a1`));
   }));
  const foreign=kind==='sync'?linked.leadB:linked.callB;
  await check('optional-'+kind+'-parent-tenant-conflict',()=>change('UPDATE "'+table+'" SET "'+key+'"=$2 WHERE id=$1',[`optional-${kind}-a1`,foreign],
   'UPDATE "'+table+'" SET "'+key+'"=$2 WHERE id=$1',[`optional-${kind}-a1`,old],refuse));
 }
 await check('optional-staff-tenant-conflict',()=>change('UPDATE "AppointmentRequest" SET "staffMemberId"=$2 WHERE id=$1',['optional-appointment-a1','optional-staff-b'],
  'UPDATE "AppointmentRequest" SET "staffMemberId"=$2 WHERE id=$1',['optional-appointment-a1','optional-staff-a'],refuse));
 await check('optional-connection-tenant-conflict',()=>change('UPDATE "FieldServiceSync" SET "connectionId"=$2 WHERE id=$1',['optional-sync-a1','optional-connection-b'],
  'UPDATE "FieldServiceSync" SET "connectionId"=$2 WHERE id=$1',['optional-sync-a1','optional-connection-a'],refuse));
 await check('optional-other-caller-not-matched-by-contact',()=>change('UPDATE "AppointmentRequest" SET "callId"=$2 WHERE id=$1',['optional-appointment-a2',optional.uniqueCall],
  'UPDATE "AppointmentRequest" SET "callId"=$2 WHERE id=$1',['optional-appointment-a2',linked.callA],async()=>{
   const r=await preview()(target);assert.equal(r.inventory.filter(v=>v.surface==='database:AppointmentRequest').length,1);assert.equal(r.partialInventory.length,0);assert.equal(r.coverage.missing.length,26);
   // customerName/customerPhone were deliberately identical before/after; only Call.callerId changed the discovery.
  }));
 await check('optional-null-extra-links',()=>change('UPDATE "AppointmentRequest" SET "staffMemberId"=NULL WHERE id=$1',['optional-appointment-a1'],
  'UPDATE "AppointmentRequest" SET "staffMemberId"=$2 WHERE id=$1',['optional-appointment-a1','optional-staff-a'],()=>change('UPDATE "FieldServiceSync" SET "connectionId"=NULL WHERE id=$1',['optional-sync-a1'],
   'UPDATE "FieldServiceSync" SET "connectionId"=$2 WHERE id=$1',['optional-sync-a1','optional-connection-a'],async()=>assert.equal((await preview()(target)).inventory.length,17))));
 await check('optional-orphan-parent-fk-refused',()=>use(source,async c=>{
  for(const [table,key,id]of [['SupportReport','callId','optional-support-a1'],['AppointmentRequest','callId','optional-appointment-a1'],['FieldServiceSync','leadId','optional-sync-a1']]){
   await c.query('BEGIN');try{await assert.rejects(c.query('UPDATE "'+table+'" SET "'+key+'"=2147483000 WHERE id=$1',[id]),e=>e.code==='23503');}finally{await c.query('ROLLBACK');}
  }
 }));
 await check('optional-orphan-extra-fk-refused',()=>use(source,async c=>{
  for(const [table,key,id]of [['AppointmentRequest','staffMemberId','optional-appointment-a1'],['FieldServiceSync','connectionId','optional-sync-a1']]){
   await c.query('BEGIN');try{await assert.rejects(c.query('UPDATE "'+table+'" SET "'+key+'"=\'fixture-absent\' WHERE id=$1',[id]),e=>e.code==='23503');}finally{await c.query('ROLLBACK');}
  }
 }));
 await check('optional-inaccessible-model-refused',async()=>{
  assert.match(role,/^privacy_read_[a-f0-9]{12}$/);
  for(const table of ['SupportReport','AppointmentRequest','FieldServiceSync']){
   await sql('REVOKE SELECT ON "'+table+'" FROM "'+role+'"');try{
    assert.equal((await sql('SELECT has_table_privilege($1,$2,\'SELECT\') AS allowed',[role,'"'+table+'"'])).rows[0].allowed,false);await assert.rejects(preview()(target));
   }finally{await sql('GRANT SELECT ON "'+table+'" TO "'+role+'"');}
  }assert.equal((await preview()(target)).ready,false);
 });
}
module.exports={seed,exercise,CHECKS};
