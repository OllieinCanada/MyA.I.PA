'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {NAMES,readRecoveryFileStore}=require('./recoveryFileStore');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function requiredSurfaces(schema){const models=[...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m=>'database:'+m[1]);
 if(!models.length||new Set(models).size!==models.length)fail('PRIVACY_SCHEMA_REQUIRED');return [...models,...NAMES.map(n=>'file:'+n)];}
function createReadOnlyInventoryReader({prisma,directory,discoverLinked=false,discoverOptional=false}){
 const fileSnapshot=()=>Object.fromEntries(NAMES.map(name=>{const data=readRecoveryFileStore(path.join(directory,name));return [name,crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')];}));
 return async target=>{
  const before=fileSnapshot();
  const result=await prisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const [business,caller]=await Promise.all([tx.business.findUnique({where:{id:target.businessId},select:{id:true}}),tx.caller.findUnique({where:{id:target.callerId},select:{id:true,phone:true}})]);
   if(!business||!caller)fail('PRIVACY_IDENTITY_NOT_FOUND');
   const where={businessId:target.businessId,callerId:target.callerId},select={id:true,businessId:true,callerId:true};
   const [calls,leads,foreignCalls,foreignLeads,suppression]=await Promise.all([
    tx.call.findMany({where,select:{...select,...(discoverLinked?{externalProvider:true,externalId:true}:{})},take:1001}),tx.lead.findMany({where,select,take:1001}),
    tx.call.findMany({where:{callerId:target.callerId,businessId:{not:target.businessId}},select:{businessId:true},distinct:['businessId'],take:1001}),
    tx.lead.findMany({where:{callerId:target.callerId,businessId:{not:target.businessId}},select:{businessId:true},distinct:['businessId'],take:1001}),
    tx.smsSuppression.findUnique({where:{phoneNumber:caller.phone},select:{id:true,suppressed:true}})
   ]);
   if(!calls.length&&!leads.length)fail('PRIVACY_TARGET_NOT_OWNED');
   if([calls,leads,foreignCalls,foreignLeads].some(rows=>rows.length>1000))fail('PRIVACY_INVENTORY_TRUNCATED');
   // Caller and suppression are shared/global. They are candidates, never disposable tenant-owned rows.
   const linked=discoverLinked?await require('./privacyLinkedInventory').discoverSubjectLinks({tx,target,calls,leads,syncStore:readRecoveryFileStore(path.join(directory,'vapi-call-sync.json'))}):{records:[],coveredSurfaces:[],unresolvedSurfaces:[]};
   const optional=discoverOptional?await require('./privacyOptionalInventory').discoverOptionalLinks({tx,target,calls,leads}):{records:[],partialRecords:[],coveredSurfaces:[],unresolvedSurfaces:[]};
   return {identity:{...target,exact:true},foreignTenantCount:new Set([...foreignCalls,...foreignLeads].map(r=>r.businessId)).size,
    coveredSurfaces:['database:Caller','database:Call','database:Lead','database:SmsSuppression',...linked.coveredSurfaces,...optional.coveredSurfaces],
    unresolvedSurfaces:[...linked.unresolvedSurfaces,...optional.unresolvedSurfaces],partialRecords:optional.partialRecords,
    records:[{surface:'database:Caller',id:caller.id,...target},...calls.map(r=>({...r,surface:'database:Call'})),...leads.map(r=>({...r,surface:'database:Lead'})),
     ...(suppression?[{surface:'database:SmsSuppression',id:suppression.id,...target}]:[]),...linked.records,...optional.records]};
  },{isolationLevel:'RepeatableRead',maxWait:1000,timeout:5000});
  if(JSON.stringify(fileSnapshot())!==JSON.stringify(before))fail('PRIVACY_FILE_SNAPSHOT_CHANGED');
  // Four files were strictly read and canonical values compared, NOT subject-complete discovery.
  // All file adapters and remaining model adapters stay missing in the preview.
  return result;
 };
}
module.exports={requiredSurfaces,createReadOnlyInventoryReader};
