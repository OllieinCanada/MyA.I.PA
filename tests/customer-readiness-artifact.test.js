const test=require('node:test'),assert=require('node:assert/strict');
const {valid,SOURCES}=require('../scripts/verify-customer-readiness-evidence');
const {ENGINES,WIDTHS}=require('../scripts/customer-readiness-browser-coverage');
function fixture(){const expected={head:'a'.repeat(40),manifest:'b'.repeat(64),hashes:Object.fromEntries(SOURCES.map(f=>[f,'c'.repeat(64)]))};
 return {expected,report:{scope:'local-built-UI-with-inert-fixtures',sourceHead:expected.head,buildManifestSha256:expected.manifest,sourceSha256:{...expected.hashes},buildUnchanged:true,
 completeMatrixPassed:true,focusedRun:false,focusedCasesPassed:true,shippingReady:false,realDeliveryProven:false,providerActions:0,productionWrites:0,blockedSockets:0,failures:[],unexpectedWrites:[],
 cases:ENGINES.flatMap(engine=>WIDTHS.map(width=>({engine,width,passed:true,routeChunkLoaded:true,adminTimelinePassed:true})))}};}
test('exact independent head, build and source proof is required',()=>{const {report,expected}=fixture();assert.equal(valid(report,expected),true);});
for(const [label,change]of [
 ['wrong head',r=>{r.sourceHead='d'.repeat(40);}],['wrong build',r=>{r.buildManifestSha256='d'.repeat(64);}],
 ['wrong source',r=>{r.sourceSha256[SOURCES[0]]='d'.repeat(64);}],['missing source',r=>{delete r.sourceSha256[SOURCES[0]];}],
 ['focused proof',r=>{r.focusedRun=true;}],['partial engine coverage',r=>{r.cases.pop();}],['overclaim',r=>{r.shippingReady=true;}],
 ['cleanup failure',r=>{r.failures.push({phase:'cleanup'});}],['network write',r=>{r.unexpectedWrites.push({});}],['unknown completion',r=>{delete r.completeMatrixPassed;}]
])test(label+' is refused',()=>{const {report,expected}=fixture();change(report);assert.equal(valid(report,expected),false);});
