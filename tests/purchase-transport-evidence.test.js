'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SOURCE_FILES,REQUIRED_CASES,validate}=require('../scripts/verify-purchase-transport-evidence');
const head='a'.repeat(40),sources=Object.fromEntries(SOURCE_FILES.map(p=>[p,'b'.repeat(64)]));
function good(){return {head,sourceFiles:{...sources},scope:'synthetic-purchase-transport-sql-http-only',passed:true,skips:0,postgresVersion:'18.1',productionUsed:false,providerRequests:0,messages:0,makeEngineVerified:false,originalFailureCauseProven:false,osSandboxProven:false,unexpectedOutboundAttempts:0,cases:REQUIRED_CASES.map(name=>({name,passed:true})),cleanup:{complete:true,ownedRowsRemaining:0,serversClosed:true,connectionsClosed:true,unrelatedPreserved:true}};}
const check=v=>validate(v,{expectedHead:head,expectedSources:sources});
test('only complete exact-head synthetic SQL evidence is accepted',()=>assert.equal(check(good()).accepted,true));
for(const key of ['productionUsed','makeEngineVerified','originalFailureCauseProven','osSandboxProven'])test('reject '+key+' overclaim',()=>{const v=good();v[key]=true;assert.throws(()=>check(v));});
for(const key of ['providerRequests','messages','skips','unexpectedOutboundAttempts'])test('reject nonzero '+key,()=>{const v=good();v[key]=1;assert.throws(()=>check(v));});
for(const name of REQUIRED_CASES)test('reject omitted or failed '+name,()=>{for(const remove of [true,false]){const v=good();if(remove)v.cases=v.cases.filter(c=>c.name!==name);else v.cases.find(c=>c.name===name).passed=false;assert.throws(()=>check(v));}});
test('reject wrong/missing head, sources, SQL version, cleanup and duplicate cases',()=>{
 const mutations=[v=>v.head='c'.repeat(40),v=>delete v.head,v=>v.sourceFiles[SOURCE_FILES[0]]='c'.repeat(64),v=>delete v.sourceFiles[SOURCE_FILES[0]],v=>v.postgresVersion='17.1',v=>v.cleanup.complete=false,v=>v.cleanup.unrelatedPreserved=false,v=>v.cleanup.ownedRowsRemaining=1,v=>v.cleanup.serversClosed=false,v=>v.cleanup.connectionsClosed=false,v=>v.cases[1]=v.cases[0]];
 for(const change of mutations){const v=good();change(v);assert.throws(()=>check(v));}
 assert.throws(()=>validate(good(),{expectedSources:sources}));assert.throws(()=>validate(good(),{expectedHead:head}));
});
