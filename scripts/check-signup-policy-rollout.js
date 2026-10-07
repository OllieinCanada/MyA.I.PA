// Checks fetched published configuration and executes fetched summary code with
// fake credentials and a stub transport only. Never contacts SMS recipients.
const fs=require('node:fs');
const {loadProjectEnv}=require('./_helpers');
const {clients,inventory,plansFor,assistantPatch}=require('./rollout-signup-assistant-policy');
const {speechSnapshot}=require('./repair-signup-speech');
const {definitionMatches}=require('./vapi-release-evidence');
const {toolPatch}=require('./refresh-vapi-job-type');
async function checkSummary(tool,args){
 // Never execute arbitrary provider-returned code, even with a fake fetch.
 if(tool.code!==toolPatch(tool).code)throw Error('Summary code does not match the audited local definition.');
 const messages=[];
 const fakeFetch=async(url,options)=>{
   if(String(options.headers?.['Content-Type']||'').includes('application/json')) return {ok:true,status:200,json:async()=>({allowed:true,suppressed:false})};
   const form=new URLSearchParams(String(options.body||''));messages.push({body:form.get('Body'),to:form.get('To'),from:form.get('From')});
   return {ok:true,status:201,json:async()=>({sid:`SM_FAKE_${messages.length}`,status:'queued'})};
 };
 const env={TWILIO_ACCOUNT_SID:'AC_FAKE',TWILIO_AUTH_TOKEN:'FAKE',TWILIO_API_KEY_SID:'SK_FAKE',TWILIO_API_KEY_SECRET:'FAKE',DEFAULT_FROM_NUMBER:'+19055550100',DEFAULT_OWNER_TO_NUMBER:'+19055550101',SMS_SUPPRESSION_CHECK_URL:'https://stub.invalid/check',SMS_SUPPRESSION_API_KEY:'FAKE',CALL_ID:'stub-'+args.requestType,OWNER_SMS_ENABLED:'true'};
 const runner=new Function('args','env','fetch','btoa','URLSearchParams',`return (async()=>{${tool.code}\n})()`);
 const result=await runner({...args,businessName:'QA Business',name:'Test caller',rawPhoneNumber:'+19055550102',jobDetails:'QA request',message:'QA message',streetAddress:'1 Test St',city:'Test City'},env,fakeFetch,v=>Buffer.from(String(v)).toString('base64'),URLSearchParams);
 if(!result.complete||messages.length!==2||messages[0].to!==env.DEFAULT_OWNER_TO_NUMBER||messages[1].to!=='+19055550102'||messages.some(m=>m.from!==env.DEFAULT_FROM_NUMBER))throw Error('Fake summary routing failed.');
 if(messages.some(m=>!m.body.includes('Job type:')))throw Error('Summary job type missing.');
 if(args.pricingDiscussed&&args.safetyConcern!=='reported_hazard'&&messages.some(m=>!m.body.includes('Parts are extra')))throw Error('Pricing caveat missing.');
 if(args.safetyConcern==='reported_hazard'&&!messages.some(m=>m.body.includes('Safety:')))throw Error('Safety reminder missing.');
 if(args.safetyConcern==='none'&&messages.some(m=>m.body.includes('Safety:')))throw Error('False hazard reminder.');
 return true;
}
async function main(){
 fs.mkdirSync('diagnostics',{recursive:true});
 const io=await clients(loadProjectEnv()),data=await inventory(io),{plans,skipped}=await plansFor(data,io.api),results=[];
 for(const p of plans){
  const checks={assistant:definitionMatches(assistantPatch(p.assistant,p.tool),speechSnapshot(p.assistant)),tool:definitionMatches(toolPatch(p.tool),{function:p.tool.function,code:p.tool.code})};
  for(const [key,args] of [['repairPricing',{requestType:'repair',pricingDiscussed:true,safetyConcern:'none'}],['hazard',{requestType:'message',safetyConcern:'reported_hazard'}],['noHazard',{requestType:'installation',safetyConcern:'none'}]]) checks[key]=await checkSummary(p.tool,args);
  results.push({business:p.signup.businessName,assistantVersion:p.assistant.latestVersion,toolVersion:p.tool.latestVersion,checks,pass:Object.values(checks).every(Boolean)});
 }
 const report={mode:'published-readback-and-stubbed-SMS',results,skipped,realSmsSent:0,realCallsPlaced:0,pass:results.length>0&&results.every(r=>r.pass)};
 fs.writeFileSync('diagnostics/vapi-policy-rollout-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=2;
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={checkSummary};
