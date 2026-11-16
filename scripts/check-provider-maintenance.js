'use strict';
// Standalone public-feed diagnostic. Runs outside Render, but is not a scheduled external uptime monitor.
const {fetchProviderStatus,PROVIDERS}=require('../server/providerMaintenance');
async function main(){
 if(process.argv.length>2)throw Error('No arguments accepted; provider URLs are fixed.');
 const providers=[];for(const provider of Object.keys(PROVIDERS)){
  const report=await fetchProviderStatus(provider);
  providers.push({provider,outcome:report.outcome,checkedAt:report.checkedAt,indicator:report.indicator||'unknown',noticeCount:report.notices?.length??null,
   ...(provider==='render'?{maintenance:report.notices?.filter(n=>n.kind==='maintenance').map(n=>({title:n.title,start:n.start,end:n.end,sourceUrl:n.sourceUrl}))}:{}),
   ...(report.failure?{failure:report.failure}:{})});
 }
 console.log(JSON.stringify({readOnly:true,providers,applicationUptimeVerified:false,privateAccountCoverage:false},null,2));
}
if(require.main===module)main().catch(()=>{console.error('Public status diagnostic failed. No provider availability or recovery is implied.');process.exitCode=1;});
module.exports={main};
