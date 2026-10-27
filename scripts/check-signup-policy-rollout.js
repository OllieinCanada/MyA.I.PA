// Checks fetched published configuration and executes fetched summary code with
// fake credentials and a stub transport only. Never contacts SMS recipients.
const fs=require('node:fs');
const {loadProjectEnv}=require('./_helpers');
const {clients,inventory,plansFor,assistantPatch}=require('./rollout-signup-assistant-policy');
const {speechSnapshot}=require('./repair-signup-speech');
const {definitionMatches}=require('./vapi-release-evidence');
const {toolPatch}=require('./refresh-vapi-job-type');
const {toolRejectionPlan,acceptsConfirmation}=require('../server/callConfirmation');
const {isDeepStrictEqual}=require('node:util');
function checkPublishedConfiguration(assistant,tool){
 return {assistant:definitionMatches(assistantPatch(assistant,tool),speechSnapshot(assistant)),
  tool:definitionMatches(toolPatch(tool),{function:tool.function,code:tool.code}),
  statusReceipts:(tool.environmentVariables||[]).some(v=>v.name==='TWILIO_STATUS_CALLBACK_URL'&&v.value==='https://api.myaipa.ca/api/webhooks/twilio/message-status'),
  trustedCallerId:(tool.environmentVariables||[]).some(v=>v.name==='CALLER_NUMBER'&&v.value==='{{ customer.number }}'),
  confirmationPlan:isDeepStrictEqual(tool.rejectionPlan,toolRejectionPlan()),
  confirmationRegression:acceptsConfirmation('Perfect. Yes.','Should I send this request to the team now?')
   &&!acceptsConfirmation('Yes, but change the city.','Should I send this request to the team now?')
   &&!acceptsConfirmation('Yes.','Would you like to continue?')};
}
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
 env.PRICING_SUMMARY_OPTIONS=(tool.environmentVariables||[]).find(v=>v.name==='PRICING_SUMMARY_OPTIONS')?.value||'';
 const runner=new Function('args','env','fetch','btoa','URLSearchParams',`return (async()=>{${tool.code}\n})()`);
 const result=await runner({pricingDiscussed:false,...args,workDetailsConfirmed:true,businessName:'QA Business',name:'Test caller',rawPhoneNumber:'+19055550102',jobDetails:'QA request',message:'QA message',streetAddress:'1 Test St',city:'Test City',preferredStartDate:'Next week',bestCallbackTime:'After 2 PM'},env,fakeFetch,v=>Buffer.from(String(v)).toString('base64'),URLSearchParams);
 if(!result.complete||messages.length!==2||messages[0].to!==env.DEFAULT_OWNER_TO_NUMBER||messages[1].to!=='+19055550102'||messages.some(m=>m.from!==env.DEFAULT_FROM_NUMBER))throw Error('Fake summary routing failed.');
 if(messages.some(m=>!m.body.includes('Job type:')))throw Error('Summary job type missing.');
 const choices=env.PRICING_SUMMARY_OPTIONS?JSON.parse(env.PRICING_SUMMARY_OPTIONS):{includePartsExtra:true,includeAssessment:true};
 const discussed=args.pricingDiscussed===true&&args.safetyConcern!=='reported_hazard';
 if(messages.some(m=>m.body.includes('Parts are extra.')!==Boolean(discussed&&choices.includePartsExtra)))throw Error('Parts reminder differs from saved pricing policy.');
 if(messages.some(m=>m.body.includes('Final price confirmed after assessment')!==Boolean(discussed&&choices.includeAssessment)))throw Error('Assessment reminder differs from saved pricing policy.');
 if(args.safetyConcern==='reported_hazard'&&!messages.some(m=>m.body.includes('Safety:')))throw Error('Safety reminder missing.');
 if(args.safetyConcern==='none'&&messages.some(m=>m.body.includes('Safety:')))throw Error('False hazard reminder.');
 return true;
}
async function main(){
 fs.mkdirSync('diagnostics',{recursive:true});
 const businessArg=process.argv.find(a=>a.startsWith('--business-id='))?.slice(14);
 if(businessArg!==undefined&&!/^[1-9]\d*$/.test(businessArg))throw Error('An exact positive --business-id is required.');
 const businessId=businessArg?Number(businessArg):undefined;
 const io=await clients(loadProjectEnv()),data=await inventory(io),{plans,skipped}=await plansFor(data,io.api,{businessId}),results=[];
 for(const p of plans){
  const checks=checkPublishedConfiguration(p.assistant,p.tool);
  for(const [key,args] of [['repairPricing',{requestType:'repair',pricingDiscussed:true,safetyConcern:'none'}],['hazard',{requestType:'message',safetyConcern:'reported_hazard'}],['noHazard',{requestType:'installation',safetyConcern:'none'}]]) checks[key]=await checkSummary(p.tool,args);
  results.push({business:p.signup.businessName,assistantVersion:p.assistant.latestVersion,toolVersion:p.tool.latestVersion,checks,pass:Object.values(checks).every(Boolean)});
 }
 const report={mode:'published-readback-and-stubbed-SMS',results,skipped,realSmsSent:0,realCallsPlaced:0,pass:results.length>0&&results.every(r=>r.pass)};
 fs.writeFileSync('diagnostics/vapi-policy-rollout-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=2;
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={checkSummary,checkPublishedConfiguration};
