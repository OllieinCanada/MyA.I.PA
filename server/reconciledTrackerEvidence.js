'use strict';
const {digest}=require('./signupAssociationRepair');

// Presentation-only recovery of a business ID. Never writes the signup or
// promotes content, billing, delivery, account eligibility or overall readiness.
async function readReconciledBusiness({prisma,record,context,receipts}) {
 const mark=record.resourceAssociationRepair;
 if(!mark||mark.sourceId!==record.signupAttemptId||mark.sourceId===mark.phantomId
   ||!/^signup_[a-f0-9]{32}$/.test(mark.phantomId||'')||typeof prisma.$transaction!=='function')return null;
 const values={twilioPhoneNumber:record.twilioPhoneNumber,vapiAssistantId:record.vapiAssistantId,vapiPhoneNumberId:record.vapiPhoneNumberId};
 if(Object.values(values).some(v=>typeof v!=='string'||!v)||digest(mark.values)!==digest(values))return null;
 const repairId=digest({ids:[mark.sourceId,mark.phantomId],contextHash:context.contextHash,values});
 if(mark.id!==repairId||receipts['twilio-number']?.status!=='completed'||receipts['vapi-assistant']?.status!=='completed'
  ||receipts['vapi-import']?.status!=='completed'||receipts['twilio-number'].result?.twilioPhoneNumber!==values.twilioPhoneNumber
  ||receipts['vapi-assistant'].result?.assistantId!==values.vapiAssistantId||receipts['vapi-import'].result?.id!==values.vapiPhoneNumberId
  ||receipts['vapi-import'].result?.number!==values.twilioPhoneNumber||receipts['vapi-import'].result?.assistantId!==values.vapiAssistantId)return null;
 return prisma.$transaction(async tx=>{
  const operationId=digest({version:1,phoneId:values.vapiPhoneNumberId});
  const association=(await tx.runtimeStore.findUnique({where:{key:'signup-association-repair:v1:'+repairId}}))?.data;
  const mapping=(await tx.runtimeStore.findUnique({where:{key:'bounded-business-mapping:v1:'+operationId}}))?.data;
  if(association?.phase!=='completed'||association.repairId!==repairId
    ||association.scope?.sourceId!==mark.sourceId||association.scope?.phantomId!==mark.phantomId
    ||association.scope?.number!==values.twilioPhoneNumber||association.scope?.assistantId!==values.vapiAssistantId
    ||association.scope?.phoneId!==values.vapiPhoneNumberId||mapping?.phase!=='completed'||mapping.operationId!==operationId)return null;
  const expected=[['phoneNumber',values.twilioPhoneNumber],['phoneNumberId',values.vapiPhoneNumberId],['assistantId',values.vapiAssistantId]];
  const aliases=[...Object.values(values),values.twilioPhoneNumber.replace(/\D/g,''),values.twilioPhoneNumber.slice(2)];
  const rows=await tx.vapiBusinessMapping.findMany({where:{matchValue:{in:aliases}}});
  const inserted=mapping.inserted;
  if(rows.length!==3||!Array.isArray(inserted)||inserted.length!==3||new Set(rows.map(r=>r.id)).size!==3
    ||!expected.every(([type,value])=>rows.filter(r=>r.matchType===type&&r.matchValue===value).length===1)
    ||rows.some(r=>!inserted.some(i=>['id','businessId','matchType','matchValue'].every(k=>i[k]===r[k]))))return null;
  const id=rows[0].businessId;
  if(!Number.isSafeInteger(id)||id<1||rows.some(r=>r.businessId!==id)||(record.businessId!=null&&record.businessId!==id))return null;
  return tx.business.findUnique({where:{id},select:{id:true,vapiMappings:{select:{matchType:true,matchValue:true}}}});
 },{isolationLevel:'RepeatableRead',maxWait:2000,timeout:5000});
}
module.exports={readReconciledBusiness};
