const crypto=require('node:crypto');
const {NAMES}=require('../server/recoveryFileStore');
const KEY_VERSIONS=Object.freeze({backup:'fixture-backup-v1',calendar:'fixture-calendar-v1',field:'fixture-field-v1'});
const REQUIRED_CHECKS=['pins-and-pg18-identity','actual-schema-and-every-model-seeded','synthetic-capture-boundary',
  'omission-tamper-and-inconsistent-generation-refused','unsafe-target-refusals','actual-schema-encrypted-restore',
  'all-model-row-and-catalog-roundtrip','four-files-and-recovered-key-versions','completed-replay-refused-without-reset',
  'nonempty-archive-replay-refused','provider-transports-disabled'];
const OMITTED_BEHAVIORS=['production-wide-writer-fence','independently-current-privacy-journal-and-erasure-replay',
  'uncertain-provider-action-reconciliation','application-HTTP-rehydration-and-dispatch',
  'all-optional-field-enum-and-operational-state-variations','other-legacy-files-logs-and-projections',
  'independent-production-key-custody','live-RPO-RTO-and-cutover'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const rowsHash=rows=>sha(JSON.stringify(rows.map(r=>JSON.stringify(canonical(r))).sort()));
function expectedModels(schema){const names=[...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m=>m[1]);if(!names.length||new Set(names).size!==names.length)throw Error('COMPOSITE_SCHEMA_MODELS_REQUIRED');return names;}
function validateFiles(files,expected){
  if(!Array.isArray(files)||files.length!==NAMES.length||new Set(files.map(f=>f.name)).size!==NAMES.length)throw Error('COMPOSITE_FILE_SET_REQUIRED');
  for(const f of files){const e=expected[f.name];if(!NAMES.includes(f.name)||!e||f.generation!==e.generation||f.boundary!==e.boundary||f.keyVersion!==e.keyVersion||f.plainSha256!==e.plainSha256)throw Error('COMPOSITE_FILE_BINDING_REQUIRED');}
  return true;
}
async function seedEveryModel(client,datamodel,encrypt){
  const records=new Map(),visiting=new Set(),models=datamodel.models;
  const scalar=(model,field)=>{
    if(field.kind==='enum'){const e=datamodel.enums.find(e=>e.name===field.type);if(!e?.values?.length)throw Error('COMPOSITE_ENUM_REQUIRED');return typeof e.values[0]==='string'?e.values[0]:e.values[0].name;}
    if(field.type==='String')return /Encrypted$/.test(field.name)?encrypt(model.name,'synthetic-'+model.name+'-'+field.name)
      :/phone/i.test(field.name)?'+15555550101':/email/i.test(field.name)?'fixture@example.invalid':'fixture-'+model.name+'-'+field.name;
    if(field.type==='Int'||field.type==='Float'||field.type==='Decimal')return 1;
    if(field.type==='BigInt')return 1n;if(field.type==='Boolean')return false;
    if(field.type==='DateTime')return new Date('2035-01-01T00:00:00.000Z');
    if(field.type==='Json')return {syntheticOnly:true};if(field.type==='Bytes')return Buffer.from('synthetic');
    throw Error('COMPOSITE_UNHANDLED_SCALAR');
  };
  async function seed(model){
    if(records.has(model.name))return records.get(model.name);if(visiting.has(model.name))throw Error('COMPOSITE_REQUIRED_RELATION_CYCLE');visiting.add(model.name);
    const data={};for(const f of model.fields)if(f.kind!=='object'&&f.isRequired&&!f.hasDefaultValue&&!f.isUpdatedAt)data[f.name]=f.isList?[]:scalar(model,f);
    for(const f of model.fields)if(f.kind==='object'&&f.isRequired&&!f.isList&&f.relationFromFields?.length){
      const parent=models.find(m=>m.name===f.type);if(!parent)throw Error('COMPOSITE_RELATION_REQUIRED');const row=await seed(parent);
      f.relationFromFields.forEach((name,i)=>{data[name]=row[f.relationToFields[i]];});
    }
    const row=await client[model.name[0].toLowerCase()+model.name.slice(1)].create({data});records.set(model.name,row);visiting.delete(model.name);return row;
  }
  for(const model of models)await seed(model);
  // Representative optional relationships are explicit rather than silently omitted.
  await client.lead.update({where:{id:records.get('Lead').id},data:{callId:records.get('Call').id}});
  await client.supportReport.update({where:{id:records.get('SupportReport').id},data:{callId:records.get('Call').id}});
  await client.appointmentRequest.update({where:{id:records.get('AppointmentRequest').id},data:{callId:records.get('Call').id}});
  await client.webhookReplayClaim.update({where:{key:records.get('WebhookReplayClaim').key},data:{status:'COMPLETED',completedAt:new Date('2026-01-01T00:00:00.000Z'),expiresAt:new Date('2035-01-01T00:00:00.000Z')}});
  await client.vapiToolExecution.update({where:{id:records.get('VapiToolExecution').id},data:{status:'COMPLETED',result:{syntheticOnly:true,receipt:'accepted-preserve-only'}}});
  await client.leadNotificationAttempt.update({where:{id:records.get('LeadNotificationAttempt').id},data:{status:'DELIVERED',providerMessageId:'SM_SYNTHETIC_COMPOSITE',
    acceptedAt:new Date('2026-01-01T00:00:00.000Z'),sentAt:new Date('2026-01-01T00:00:00.000Z'),deliveredAt:new Date('2026-01-01T00:00:00.000Z')}});
  await client.leadNotificationEvent.update({where:{id:records.get('LeadNotificationEvent').id},data:{status:'delivered',source:'synthetic-fixture',details:{syntheticOnly:true}}});
  for(const status of ['pending','accepted','uncertain'])await client.runtimeStore.create({data:{key:'synthetic:preserved-action:'+status,data:{syntheticOnly:true,status,dispatchEnabled:false}}});
  return records;
}
function verifyComposite(report,expected,aborted=false){
  const checks=aborted?['pins-and-pg18-identity','actual-schema-and-every-model-seeded','synthetic-capture-boundary']:REQUIRED_CHECKS;
  const eq=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===b.length&&b.every(x=>a.includes(x));
  return /^[a-f0-9]{40}$/.test(expected?.head||'')&&report?.head===expected.head&&report.schemaVersion===1
    &&report.scope==='actual-prisma-four-file-synthetic-recovery-only'&&report.passed===!aborted
    &&(!aborted||report.failureCode==='COMPOSITE_EXPECTED_ABORT')&&report.schemaSha256===expected.schemaSha256
    &&report.dependencyHead===expected.dependencyHead&&report.pinsVerified===true
    &&expected.sourceSha256&&Object.keys(expected.sourceSha256).length>0&&report.sourceSha256
    &&Object.keys(report.sourceSha256).length===Object.keys(expected.sourceSha256).length
    &&Object.keys(expected.sourceSha256).every(k=>/^[a-f0-9]{64}$/.test(expected.sourceSha256[k])&&report.sourceSha256[k]===expected.sourceSha256[k])
    &&Array.isArray(report.checks)&&eq(report.checks.map(c=>c.name),checks)&&report.checks.every(c=>c.passed===true)
    &&eq(report.modelInventory,expected.models)&&eq(report.fileInventory,[...NAMES])
    &&report.modelsSeeded===expected.models.length&&report.ownedDatabaseCount===3
    &&report.cleanup?.databasesRemoved===true&&report.cleanup.filesRemoved===true&&report.cleanup.unrelatedDatabasesUnchanged===true
    &&report.cleanup.privateDirectoryInventoryRestored===true
    &&report.keyVersions&&Object.keys(report.keyVersions).length===3&&Object.keys(KEY_VERSIONS).every(k=>report.keyVersions[k]===KEY_VERSIONS[k])
    &&report.productionDataUsed===false&&report.providerCallsOrMessages===0&&report.applicationWorkersStarted===false
    &&report.liveRecoveryProven===false&&report.productionWriterFenceProven===false&&report.privacyReplayProven===false
    &&report.uncertainReconciliationProven===false&&report.osSandboxProven===false
    &&eq(report.unexercisedBehaviors,OMITTED_BEHAVIORS)
    &&(aborted||(Array.isArray(report.modelRoundtrip)&&eq(report.modelRoundtrip.map(m=>m.model),expected.models)
      &&report.modelRoundtrip.every(m=>Number.isInteger(m.rows)&&m.rows>0&&/^[a-f0-9]{64}$/.test(m.sourceSha256)&&m.sourceSha256===m.targetSha256)
      &&Array.isArray(report.fileRoundtrip)&&eq(report.fileRoundtrip.map(f=>f.name),[...NAMES])&&report.fileRoundtrip.every(f=>f.verified===true&&f.keyVersion===KEY_VERSIONS.backup)));
}
module.exports={sha,rowsHash,expectedModels,validateFiles,seedEveryModel,verifyComposite,REQUIRED_CHECKS,OMITTED_BEHAVIORS,KEY_VERSIONS};
