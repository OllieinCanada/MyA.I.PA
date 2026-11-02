// Fixed synthetic worker. Never loads application credentials, a .env file,
// a provider SDK or an arbitrary module/function supplied by its caller.
const fs=require('node:fs');
const contract=require('../../scripts/recovery-supervision-contract');
let request;
try { request=contract.validateRequest(JSON.parse(process.argv[2]||'null')); }
catch { console.error('SYNTHETIC_SUPERVISION_INPUT_INVALID');process.exit(76); }
if(process.env.RECOVERY_SUPERVISION_SYNTHETIC_ONLY!=='1'){console.error('SYNTHETIC_SUPERVISION_ENV_REQUIRED');process.exit(76);}
const forbidden=Object.keys(process.env).filter(key=>/^(?:TWILIO_|VAPI_|RENDER_|TELEGRAM_|SMTP_|MAKE_|STRIPE_|GOOGLE_|OPENAI_|MICROSOFT_|CALENDAR_|FIELD_SERVICE_|BACKUP_|AWS_)/.test(key)||['NODE_OPTIONS','NODE_PATH','DATABASE_URL','OPERATIONS_ENV_FILE'].includes(key));
if(forbidden.length){console.error('SYNTHETIC_SUPERVISION_CREDENTIAL_ENV_REJECTED');process.exit(76);}
const guard=require('../../scripts/local-staging-egress').install({ports:[]});
const emit=value=>fs.writeSync(process.stdout.fd,JSON.stringify(value)+'\n');
const scope='synthetic-only-no-provider-data';
emit({type:'ready',scope,executionId:request.executionId,pid:process.pid,mode:request.mode,credentialKeysPresent:[]});
const result=value=>emit({type:'result',scope,executionId:request.executionId,mode:request.mode,unexpectedOutboundAttempts:guard.status().unexpectedOutboundAttempts,...value});
// Ignore a graceful termination request where supported; the native parent
// supervisor must use its merged SIGKILL fallback, not a cooperative JS timer.
process.on('SIGTERM',()=>{});
if(request.mode==='block'){while(true){}}
if(request.mode==='hang'){setInterval(()=>{},1000);}
else if(request.mode==='accepted-then-hang'){contract.recordAcceptance(request);setInterval(()=>{},1000);}
else if(request.mode==='crash')process.exit(77);
else if(request.mode==='malformed'){fs.writeSync(process.stdout.fd,'deliberately-not-a-result\n');}
else if(request.mode==='reject')result({outcome:'rejected'});
else if(request.mode==='accept')result({outcome:'accepted',acceptanceId:contract.recordAcceptance(request)});
else if(request.mode==='probes')guard.probes().then(proof=>result({outcome:'probe-only',probesRejected:proof.rejected})).catch(()=>{console.error('SYNTHETIC_SUPERVISION_PROBE_FAILED');process.exitCode=1;});
