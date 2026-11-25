'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const React=Module.createRequire(require.resolve('react-dom/package.json'))('react'),{renderToStaticMarkup}=require('react-dom/server');
const loaded=new Map();
function load(file){const full=path.resolve(__dirname,'../src',file);if(loaded.has(full))return loaded.get(full).exports;
 const code=require('@babel/core').transformFileSync(full,{configFile:false,babelrc:false,presets:[require.resolve('@babel/preset-react')],plugins:[require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
 const mod=new Module(full,module);loaded.set(full,mod);mod.filename=full;mod.paths=Module._nodeModulePaths(path.dirname(full));const original=mod.require.bind(mod);
 mod.require=name=>name==='react'?React:name.endsWith('.css')?{}:name.startsWith('.')?load(path.resolve(path.dirname(full),name.endsWith('.js')?name:name+'.js')):original(name);
 mod._compile(code,full);return mod.exports;}
test('actual bug-history component starts unknown with no repair, resend or deletion controls',()=>{
 const Component=load('SignupBugHistory.js').default,html=renderToStaticMarkup(React.createElement(Component,{attemptId:'signup_'+'a'.repeat(32)}));
 assert.match(html,/Bug history for this signup/);assert.match(html,/No automatic repair/);assert.match(html,/History is not loaded/);assert.doesNotMatch(html,/No captured reports|Resend|Buy number|Delete history/);
});

test('actual tracker control room clearly renders recorded assistant error and preserves uncertain outcome wording',()=>{
 const record={signupAttemptId:'signup_'+'a'.repeat(32),identityVerified:true,smsVerified:true,status:'setup_error',makeFailedStage:'VAPI_ASSISTANT_CREATE',makeProviderCode:'PROVIDER_REQUEST_FAILED'};
 const e=require('../server/signupAssistantError').assistantErrorEvidence({phase:'create',contextHash:'b'.repeat(64),env:{},error:{code:'ETIMEDOUT',statusCode:504,message:'Assistant request timed out; outcome unknown'}});
 const setup=require('../server/adminSignupSetup').projectSetup(record,{assistantError:{...e,capturedAt:'2026-01-01T12:00:00Z'}}),row={...require('../server/adminSignupTracker').trackerRow(record),setup};
 const Component=load('SignupControlRoom.js').default,html=renderToStaticMarkup(React.createElement(Component,{row}));
 assert.match(html,/Assistant creation/);assert.match(html,/ETIMEDOUT/);assert.match(html,/HTTP 504/);assert.match(html,/Assistant request timed out; outcome unknown/);assert.match(html,/Do not buy another number or rerun signup/);assert.doesNotMatch(html,/>Retry assistant|>Recover now|>Buy number/);
 const legacy={...row,setup:require('../server/adminSignupSetup').projectSetup(record)};
 assert.match(renderToStaticMarkup(React.createElement(Component,{row:legacy})),/underlying error is unavailable/);
});
test('bug-history buttons override the tracker nowrap rule instead of hiding 320px overflow',()=>{
 const css=require('node:fs').readFileSync(path.resolve(__dirname,'../src/SignupBugHistory.css'),'utf8');
 assert.match(css,/\.signup-tracker \.signup-bug-history button\s*\{[^}]*white-space:\s*normal;[^}]*max-width:\s*100%/);
 assert.doesNotMatch(css,/overflow-x:\s*hidden/);
});

test('actual tracker renders purchase checkpoint, redacted error and unknown outcome even with a failed receipt',()=>{
 const record={signupAttemptId:'signup_'+'a'.repeat(32),identityVerified:true,smsVerified:true,status:'setup_error',makeFailedStage:'TWILIO_NUMBER_PURCHASE',makeProviderCode:'PROVIDER_REQUEST_FAILED'};
 const e=require('../server/signupProvisioningError').provisioningErrorEvidence({operation:'purchase',phase:'purchase',contextHash:'b'.repeat(64),env:{},error:{code:'ETIMEDOUT',statusCode:504,message:'Synthetic purchase timeout; outcome unknown'}});
 const setup=require('../server/adminSignupSetup').projectSetup(record,{purchaseError:{...e,capturedAt:'2026-01-01T12:00:00Z'},receipts:{'twilio-number':{status:'failed',dispatchStartedAt:'2026-01-01T11:59:00Z'}}});
 const row={...require('../server/adminSignupTracker').trackerRow(record),setup},Component=load('SignupControlRoom.js').default;
 const html=renderToStaticMarkup(React.createElement(Component,{row}));assert.match(html,/Number purchase request failed/);assert.match(html,/HTTP 504/);assert.match(html,/Synthetic purchase timeout; outcome unknown/);assert.match(html,/Do not buy another number or rerun signup/);assert.doesNotMatch(html,/>Buy number|>Retry purchase|>Recover now/);
 const {BugErrorDetail}=load('SignupBugHistory.js');const auth={...e,operation:'purchase',phaseLabel:'Verify signed provisioning request',detail:'Invalid signed request <script>unsafe</script>'};
 const detail=renderToStaticMarkup(React.createElement(BugErrorDetail,{event:{provisioningFailure:auth}}));assert.match(detail,/Verify signed provisioning request/);assert.match(detail,/&lt;script&gt;/);assert.doesNotMatch(detail,/<script|<button|<form/);assert.match(detail,/does not authorize a retry/);
});

test('recovery guidance shows failed/unknown steps with no execute controls and marks stale evidence',()=>{
 const {RecoveryGuidance}=load('SignupLiveDiagnostics.js');
 const guidance=require('../server/signupRecoveryGuidance').buildSignupRecoveryGuidance({live:{readOnly:true,groups:[{checks:[{id:'route',state:'failed'}]}]}});
 const html=renderToStaticMarkup(React.createElement(RecoveryGuidance,{guidance}));
 assert.match(html,/Phone routing<\/strong><small>Failed/);assert.match(html,/Unknown/);assert.match(html,/No automatic resend/);
 assert.match(html,/<details><summary>/);assert.doesNotMatch(html,/<details open/);
 assert.doesNotMatch(html,/<button|<a\b|<form/);
 const stale=renderToStaticMarkup(React.createElement(RecoveryGuidance,{guidance,stale:true}));assert.match(stale,/Last-known guidance/);
});
test('actual maintenance component and notices use Toronto time and do not promise application health',()=>{
 const {default:Component,MaintenanceNotice}=load('ProviderMaintenance.js'),initial=renderToStaticMarkup(React.createElement(Component));
 assert.match(initial,/availability is not verified/);assert.doesNotMatch(initial,/All systems operational/);
 const notice={title:'Synthetic <SCRIPT>',kind:'maintenance',status:'scheduled',start:'2026-11-18T02:00:00Z',end:'2026-11-18T03:00:00Z',components:['Administration'],description:'Provider report only',updatedAt:'2026-11-16T10:00:00Z',sourceUrl:'https://status.render.com/incidents/fixture1'};
 const html=renderToStaticMarkup(React.createElement(MaintenanceNotice,{notice}));assert.match(html,/Nov 17, 2026, 9:00 p.m. EST/);assert.match(html,/not proof/i);assert.match(html,/&lt;script&gt;/i);assert.doesNotMatch(html,/<script\b|<button\b|Resend|Retry purchase/i);
});
