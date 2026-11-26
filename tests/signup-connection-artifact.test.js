'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate,SOURCE_FILES,CRITICAL}=require('../scripts/verify-no-send-connection-evidence');
function fixture(){const expectedHead='a'.repeat(40),sourceHashes=Object.fromEntries(SOURCE_FILES.map(f=>[f,'b'.repeat(64)]));
 return{binding:{expectedHead,sourceHashes},report:{head:expectedHead,scope:'synthetic-no-send-connection-only',passed:true,skips:0,postgresVersion:'18.6',providerNetworkRequests:0,
  realMessages:0,productionUsed:false,liveReadinessProven:false,cleanup:{fixtures:23,failures:0},sourceFiles:{...sourceHashes},
  cases:[...CRITICAL,...Array.from({length:23-CRITICAL.length},(_,i)=>'invented-case-'+i)].map(name=>({name,passed:true}))}};}
test('complete independently exact-head/source-bound artifact grants only synthetic proof',()=>{
 const x=fixture(),r=validate(x.report,x.binding);assert.equal(r.accepted,true);assert.equal(r.liveReadinessProven,false);
});
test('missing/skipped/failed/mismatched/overclaimed proof is refused',()=>{
 for(const change of [x=>x.report.head='c'.repeat(40),x=>x.binding.expectedHead=undefined,x=>x.report.passed=false,x=>x.report.skips=1,
  x=>x.report.cases.pop(),x=>x.report.cases[0].passed=false,x=>x.report.cases[1].name=x.report.cases[0].name,x=>x.report.cases[0].name='omitted-critical',
  x=>x.report.cleanup.failures=1,x=>x.report.cleanup.fixtures=22,x=>x.report.liveReadinessProven=true,x=>x.report.productionUsed=true,
  x=>x.report.realMessages=1,x=>x.report.providerNetworkRequests=1,x=>x.report.postgresVersion='16.9',
  x=>delete x.report.sourceFiles[SOURCE_FILES[0]],x=>x.report.sourceFiles[SOURCE_FILES[0]]='d'.repeat(64),x=>x.report.sourceFiles.extra='b'.repeat(64),
  x=>x.binding.sourceHashes={}]){const x=fixture();change(x);assert.throws(()=>validate(x.report,x.binding));}
});
