'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildBlueprint,assertSafeBlueprint,buildPayload,consumeResponse,main}=require('../scripts/prepare-provider-disabled-make-diagnostic');
const options={hookId:42,connectionKey:'synthetic-connection-key',variant:'empty-multipart'};
for(const variant of ['empty-multipart','marker-multipart'])test('fixed '+variant+' targets only dedicated diagnostic, preserving HTTP failures with credential-redacted response',()=>{
 const o={...options,variant},b=buildBlueprint(o);assert.equal(assertSafeBlueprint(b,o),true);assert.deepEqual(b.flow.map(m=>m.id),[16,21,9,30]);assert.equal(b.flow[2].mapper.formDataFields.length,variant==='empty-multipart'?0:1);
 assert.equal(b.flow[2].parameters.handleErrors,false);assert.equal(b.flow[2].mapper.parseResponse,false);assert.equal(b.flow[2].mapper.followRedirect,false);assert.equal(b.flow[3].mapper.status,'{{9.statusCode}}');assert.match(b.flow[2].onerror[0].mapper.body,/^\{\{replace\(replace\(9\.error\.message;/);assert.equal(b.metadata.scenario.confidential,true);
});
for(const [name,change]of [
 ['purchase route',b=>{b.flow[2].mapper.url='https://api.myaipa.ca/api/integrations/twilio/purchase-number';}],
 ['Twilio URL',b=>{b.flow[2].mapper.url='https://api.twilio.com';}],
 ['Vapi URL',b=>{b.flow[2].mapper.url='https://api.vapi.ai';}],
 ['redirects',b=>{b.flow[2].mapper.followRedirect=true;}],
 ['hidden extra HTTP',b=>{b.flow[2].onerror.push(structuredClone(b.flow[2]));}],
 ['opaque orphan metadata',b=>{b.metadata.designer={orphans:[{module:'unsafe'}]};}],
 ['changed token binding',b=>{b.flow[2].mapper.headers[0].value='wrong';}],
 ['added form marker',b=>{b.flow[2].mapper.formDataFields.push({fieldType:'text',key:'unexpected',value:'changed'});}],
 ['discarded HTTP status',b=>{b.flow[3].mapper.status='200';}],
 ['weakened TLS',b=>{b.flow[2].mapper.rejectUnauthorized=false;}],
 ['customer query',b=>{b.flow[2].mapper.qs.push({name:'signupAttemptId',value:'signup_'+'a'.repeat(32)});}]
])test('refuses blueprint mutation: '+name,()=>{const b=buildBlueprint(options);change(b);assert.throws(()=>assertSafeBlueprint(b,options));});
test('payload is synthetic and contains no business/contact identifiers',()=>{const p=buildPayload({diagnosticId:'mdiag_'+'a'.repeat(32),issuedAt:1800000000000,signingSecret:'synthetic-secret'});assert.match(p.provisioning.authorizationToken,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(p),/owner|email|phone|businessName|signup_/);});
test('unrecognized/error response is redacted before output and never counts as server or historical proof',()=>{
 const r=consumeResponse({httpStatus:502,text:'Unexpected end of form; synthetic-private-key; https://example.invalid/private-hook; fixture@example.invalid; +12895550123',diagnosticId:'mdiag_'+'a'.repeat(32),expectedRelease:'a'.repeat(40),connectionKey:'synthetic-private-key',authorizationToken:'f'.repeat(64)});
 assert.equal(r.serverDiagnosticVerified,false);assert.match(r.detail,/Unexpected end of form/);assert.doesNotMatch(JSON.stringify(r),/synthetic-private-key|fixture@example|12895550123|private-hook/);assert.equal(r.retryAllowed,false);
});
test('generic Accepted and mismatched diagnostic IDs remain unverified, never automatically replayed',()=>{
 for(const text of ['Accepted',JSON.stringify({version:1,diagnostic:true,diagnosticId:'mdiag_'+'b'.repeat(32),providerCallsAllowed:false})]){
  const r=consumeResponse({httpStatus:200,text,diagnosticId:'mdiag_'+'a'.repeat(32),expectedRelease:'a'.repeat(40),connectionKey:'synthetic-private-key',authorizationToken:'f'.repeat(64)});assert.equal(r.serverDiagnosticVerified,false);assert.equal(r.retryAllowed,false);
 }
});
test('plan CLI has no create, apply, trigger or URL override mode',()=>{for(const args of [['--apply'],['--trigger'],['--url=https://api.twilio.com']])assert.throws(()=>main(args),/PLAN_ONLY/);});
test('fixed outbound response mappings redact repeated connection credentials and all hexadecimal proof tokens before returning data',()=>{
 const b=buildBlueprint(options),token='f'.repeat(64),message='Unexpected end of form '+options.connectionKey+' '+token+' '+options.connectionKey+' '+token;
 // Deterministic interpreter for the fixed two-replace grammar; not Make-engine proof.
 for(const body of [b.flow[2].onerror[0].mapper.body,b.flow[3].mapper.body]){
  const m=/^\{\{replace\(replace\((9\.error\.message|9\.data); "\/([A-Za-z0-9_-]+)\/g"; "\[redacted\]"\); "\/\[a-fA-F0-9\]\{64\}\/g"; "\[redacted\]"\)\}\}$/.exec(body);
  assert.ok(m);assert.equal(m[2],options.connectionKey);const rendered=message.replace(new RegExp(m[2],'g'),'[redacted]').replace(/[a-fA-F0-9]{64}/g,'[redacted]');assert.match(rendered,/Unexpected end of form/);assert.doesNotMatch(rendered,/synthetic-connection-key|ffffffff/);
 }
 for(const key of ['unsafe-credential/with-delimiter','unsafe-credential"with-quote','unsafe-credential\\with-escape'])assert.throws(()=>buildBlueprint({...options,connectionKey:key}));
});
