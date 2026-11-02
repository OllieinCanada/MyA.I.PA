// Offline evaluation. This command cannot send messages or fetch production metadata.
const{assess,notificationPlan,validatePolicy}=require('./approved-recovery-policy');
const{createMetadataIO}=require('./recovery-metadata-io');
function main(args=process.argv.slice(2),{metadataIO=createMetadataIO()}={}){
  const options=name=>args.filter(arg=>arg.startsWith('--'+name+'=')),value=name=>options(name)[0]?.slice(name.length+3);
  if(args.some(arg=>!/^--(facts|out-dir|state|policy)=.+$/.test(arg))||['facts','out-dir','policy'].some(name=>options(name).length!==1)||options('state').length>1)throw Error('Explicit synthetic --policy, local --facts and new --out-dir required; live dispatch is unsupported');
  const paths={policy:{path:value('policy'),kind:'input'},facts:{path:value('facts'),kind:'input'},out:{path:value('out-dir'),kind:'output-dir'}};
  if(value('state'))paths.state={path:value('state'),kind:'input'};
  const plan=metadataIO.prepare(paths);
  const policy=validatePolicy(metadataIO.readJson(plan,'policy').value);
  const facts=metadataIO.readJson(plan,'facts').value,state=value('state')?metadataIO.readJson(plan,'state').value:{};
  const report=assess(facts,policy);
  const body={...report,scope:'synthetic-plan-only',notification:notificationPlan(report,state,policy),schedule:{monitorMinutes:policy.monitor.intervalMinutes,captureMinutes:policy.capture.intervalMinutes,installed:false},messagesSent:0,productionRequests:0};
  const directory=metadataIO.createDirectory(plan,'out');metadataIO.writeJsonInDirectory(directory,'monitor-plan.json',body);
  console.log(JSON.stringify({severity:report.severity,issues:report.issues.map(v=>v.code),messagesSent:0,productionRequests:0,scheduleInstalled:false}));return body;
}
if(require.main===module){try{main();}catch{console.error('Offline recovery monitor requires valid explicit local metadata.');process.exitCode=1;}}
module.exports={main};
