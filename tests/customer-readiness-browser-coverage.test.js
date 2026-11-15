const test=require('node:test'),assert=require('node:assert/strict');
const {complete,ENGINES,WIDTHS}=require('../scripts/customer-readiness-browser-coverage');
const {roomyCard}=require('../scripts/customer-readiness-browser-coverage');
test('narrow card uses measured content width including border and padding deductions',()=>{
 assert.equal(roomyCard(158,158),true);
 assert.equal(roomyCard(79,158),false);
 assert.equal(roomyCard(199,600),true);
 assert.equal(roomyCard(150,600),false);
 assert.equal(roomyCard(0,0),false);
 assert.equal(roomyCard(NaN,158),false);
});
function fixture(){return{scope:'local-built-UI-with-inert-fixtures',buildUnchanged:true,shippingReady:false,realDeliveryProven:false,failures:[],unexpectedWrites:[],cases:ENGINES.flatMap(engine=>WIDTHS.map(width=>({engine,width,passed:true,adminTimelinePassed:true,routeChunkLoaded:true})))};}
test('only the complete independent engine/width/admin matrix passes',()=>assert.equal(complete(fixture()),true));
for(const [name,mutate]of [
 ['focused run',r=>{r.cases=r.cases.filter(c=>c.engine!=='firefox');}],
 ['duplicate coverage',r=>{r.cases[1]={...r.cases[0]};}],
 ['missing admin check',r=>{delete r.cases[0].adminTimelinePassed;}],
 ['build changed',r=>{r.buildUnchanged=false;}],
 ['cleanup failure',r=>{r.failures.push({phase:'cleanup'});}],
 ['unexpected write',r=>{r.unexpectedWrites.push({});}],
 ['overclaim',r=>{r.shippingReady=true;}]
])test(name+' cannot count as complete proof',()=>{const r=fixture();mutate(r);assert.equal(complete(r),false);});
