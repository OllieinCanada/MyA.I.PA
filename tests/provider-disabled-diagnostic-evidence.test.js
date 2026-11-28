'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SOURCE_FILES,REQUIRED_CASES,validate}=require('../scripts/verify-provider-disabled-diagnostic-evidence');
const expectedHead='a'.repeat(40),expectedSources=Object.fromEntries(SOURCE_FILES.map(p=>[p,'b'.repeat(64)]));
test('diagnostic proof covers the shared guard trace dependency',()=>{
 assert.ok(SOURCE_FILES.includes('server/provisioningRequestTrace.js'));
 const value=fixture();value.sourceFiles['server/provisioningRequestTrace.js']='c'.repeat(64);
 assert.throws(()=>validate(value,{expectedHead,expectedSources}));
});
function fixture(){return{head:expectedHead,scope:'provider-disabled-diagnostic-disposable-sql-only',passed:true,skips:0,postgresVersion:'18.6',productionUsed:false,providerRequests:0,forbiddenTransportAttempts:0,messages:0,originalHistoricalCauseProven:false,makeEngineVerified:false,osSandboxProven:false,cleanup:{ownedRowsRemaining:0,connectionsClosed:true,httpServerClosed:true,complete:true},cases:REQUIRED_CASES.map(name=>({name,passed:true})),sourceFiles:{...expectedSources}};}
test('complete exact-source SQL fixture proof is accepted only in its synthetic scope',()=>{const r=validate(fixture(),{expectedHead,expectedSources});assert.equal(r.sqlCases,8);assert.equal(r.makeEngineVerified,false);assert.equal(r.originalHistoricalCauseProven,false);});
for(const [name,mutate]of [
 ['wrong head',v=>{v.head='c'.repeat(40);}],['skipped SQL',v=>{v.skips=1;}],['wrong DB major',v=>{v.postgresVersion='17.9';}],
 ['provider traffic',v=>{v.providerRequests=1;}],['unrelated network',v=>{v.forbiddenTransportAttempts=1;}],['messages',v=>{v.messages=1;}],['production',v=>{v.productionUsed=true;}],
 ['historical claim',v=>{v.originalHistoricalCauseProven=true;}],['Make overclaim',v=>{v.makeEngineVerified=true;}],['OS overclaim',v=>{v.osSandboxProven=true;}],
 ['missing case',v=>{v.cases.pop();}],['duplicate case',v=>{v.cases[1]=v.cases[0];}],['failed case',v=>{v.cases[0].passed=false;}],
 ['missing source',v=>{delete v.sourceFiles[SOURCE_FILES[0]];}],['wrong source',v=>{v.sourceFiles[SOURCE_FILES[0]]='c'.repeat(64);}],
 ['extra source',v=>{v.sourceFiles['unrelated']='b'.repeat(64);}],['remaining rows',v=>{v.cleanup.ownedRowsRemaining=1;}],['open DB',v=>{v.cleanup.connectionsClosed=false;}],['open HTTP',v=>{v.cleanup.httpServerClosed=false;}],['cleanup unconfirmed',v=>{v.cleanup.complete=false;}],['failed report',v=>{v.passed=false;}]
])test('refuses incomplete or overclaiming artifact: '+name,()=>{const v=fixture();mutate(v);assert.throws(()=>validate(v,{expectedHead,expectedSources}));});
test('artifact cannot supply its own expected head or source authority',()=>{assert.throws(()=>validate(fixture(),{expectedSources}));assert.throws(()=>validate(fixture(),{expectedHead}));});
