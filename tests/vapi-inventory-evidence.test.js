const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {buildMappingReadinessReport}=require('../scripts/audit-vapi-business-mappings');
// Extract only these read functions, never import index.js or start workers.
const file=path.join(__dirname,'../server/index.js'),source=fs.readFileSync(file,'utf8');
const cut=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function harness(responses){
 const calls=[];
 const collection=vm.runInNewContext('('+cut('async function fetchVapiCollection(','async function requestVapiResource(')+')',{
  VAPI_API_KEY:'synthetic-only',VAPI_API_BASE_URL:'https://provider.invalid',URL,require:createRequire(file),
  fetchProviderReadText:async url=>{const key=new URL(url).pathname.slice(1);calls.push(key);const value=responses[key];return {response:{ok:value.status===200,status:value.status},text:typeof value.body==='string'?value.body:JSON.stringify(value.body)};},
  parseJsonObject:JSON.parse,createProviderHttpError:()=>Object.assign(Error('synthetic provider failure'),{code:'PROVIDER_READ_FAILED'}),
 });
 const inventory=vm.runInNewContext('('+cut('async function getVapiAccountInventory()','function mergeVapiEndOfCallReport(')+')',{
  fetchVapiCollection:collection,prisma:{vapiBusinessMapping:{findMany:async()=>[]}},
  getVapiAssistantId:r=>r.assistantId||'',getVapiPhoneNumber:r=>r.number||'',getVapiAssistantName:r=>r.name||'',findVapiInventoryMapping:()=>null,
  getVapiNestedString:()=>'',normalizeVapiServerUrl:x=>x,TRIAL_USAGE_GATE_WEBHOOK_URL:'https://app.invalid/voice',
 });
 return {inventory,calls};
}
const good=()=>({'phone-number':{status:200,body:[{id:'phone-a',number:'+19055550123',assistantId:'assistant-a'}]},assistant:{status:200,body:[{id:'assistant-a',name:'Customer'}]}});
test('inventory endpoint forwards explicit successful complete evidence from real read-function plumbing',async()=>{const h=harness(good()),r=await h.inventory();assert.equal(r.collectionReads.phoneNumbers.successful,true);assert.equal(r.collectionReads.phoneNumbers.complete,true);assert.equal(r.collectionReads.assistants.count,1);assert.equal(r.warnings.length,0);assert.deepEqual(h.calls.sort(),['assistant','phone-number']);});
test('invalid declared tenant IDs are preserved for fail-closed assessment, not hidden as absent',async()=>{const responses=good();responses['phone-number'].body[0].businessId=0;responses.assistant.body[0].metadata={businessId:false};const r=await harness(responses).inventory();assert.equal(r.phoneNumbers[0].providerBusinessId,0);assert.equal(r.assistants[0].providerBusinessId,false);});
for(const [name,value] of [['HTTP failure',{status:503,body:{}}],['truncated JSON',{status:200,body:'{'}],['partial page',{status:200,body:{results:[{id:'phone-a'}],metadata:{totalItems:2,currentPage:1}}}]])test(`inventory endpoint preserves ${name} as failed evidence, never a ready empty fleet`,async()=>{const responses=good();responses['phone-number']=value;const r=await harness(responses).inventory();assert.equal(r.collectionReads.phoneNumbers.successful,false);assert.equal(r.collectionReads.phoneNumbers.complete,false);assert.equal(r.collectionReads.assistants.successful,true);assert.equal(r.warnings.length,1);const report=buildMappingReadinessReport({phones:Array.from(r.phoneNumbers),assistants:Array.from(r.assistants),warnings:Array.from(r.warnings),inventoryEvidence:r.collectionReads});assert.equal(report.ready,false);assert.equal(report.assessmentStatus,'unverified_provider_inventory');});
