// One explicit admin request. Never resumes Make, buys numbers or sends texts.
async function main(argv=process.argv.slice(2)) {
  const args=Object.fromEntries(argv.filter(x=>x.startsWith('--')&&x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
  const apply=argv.includes('--apply');
  if(argv.some(x=>!['--apply'].includes(x)&&!/^--(?:attempt|expected-context-hash|confirm)=/.test(x))
    || !/^signup_[a-f0-9]{32}$/.test(args.attempt||'') || !process.env.ADMIN_PASSWORD
    || (apply&&(!/^[a-f0-9]{64}$/.test(args['expected-context-hash']||'')||args.confirm!=='PREPARE_NUMBER_FALLBACK_RECOVERY'))) {
    throw Error('Exact --attempt and ADMIN_PASSWORD required; --apply additionally needs --expected-context-hash and --confirm=PREPARE_NUMBER_FALLBACK_RECOVERY.');
  }
  const response=await fetch('https://api.myaipa.ca/api/admin/signups/prepare-number-fallback-recovery',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json',
      origin:'https://www.myaipa.ca','x-myaipa-number-recovery':'1','x-admin-password':process.env.ADMIN_PASSWORD},
    body:JSON.stringify({signupAttemptId:args.attempt,expectedContextHash:args['expected-context-hash'],apply,
      confirmation:'PREPARE_NUMBER_FALLBACK_RECOVERY'}),
  });
  // Never retry an ambiguous apply. Obtain fresh saved state before any follow-up.
  const body=await response.json();
  if(!response.ok)throw Error('Preparation rejected (HTTP '+response.status+'); inspect the saved state before any retry.');
  console.log(JSON.stringify(Object.fromEntries(['ok','eligible','applied','signupAttemptId','areaOrder','expectedContextHash',
    'contextHash','numbersPurchased','reservesAssigned','textsSent','callsPlaced','requiresSeparateResume'].map(k=>[k,body[k]])),null,2));
}
if(require.main===module)main().catch(()=>{console.error('Preparation did not return a verified success. No automatic retry; inspect saved state.');process.exitCode=1;});
module.exports={main};
