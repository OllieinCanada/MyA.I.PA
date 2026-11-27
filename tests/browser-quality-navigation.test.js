'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../scripts/test-browser-quality'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('    await clickVisibleByText(page, "Back");',source.indexOf('async function testSignupJourney('));
const end=source.indexOf('\n\n    return { engine:',start);assert.ok(start>=0&&end>start);
const snippet=source.slice(start,end);
function run({step='Step 5 of 7',visible=true,waitError}={}){
 let committed=false,clicked=0,waited=0;
 const page={locator(selector){if(selector==='form')return {innerText:async()=>{assert.equal(committed,true,'Do not inspect before destination render');return step;}};assert.equal(selector,'#signup-pricing');return {waitFor:async options=>{assert.equal(options.state,'visible');assert.equal(clicked,1);waited++;if(waitError)throw waitError;await Promise.resolve();committed=true;},isVisible:async()=>visible};}};
 return vm.runInNewContext('(async()=>{'+snippet+'})()',{page,clickVisibleByText:async(_page,text)=>{assert.equal(text,'Back');clicked++;}}).then(()=>({clicked,waited}));
}
test('browser gate awaits the destination commit before checking exact pricing step',async()=>assert.deepEqual(await run(),{clicked:1,waited:1}));
test('missing destination, wrong step and hidden pricing still fail closed',async()=>{await assert.rejects(run({waitError:Error('Synthetic bounded destination timeout')}),/destination timeout/);await assert.rejects(run({step:'Step 6 of 7'}),/did not return/);await assert.rejects(run({visible:false}),/did not return/);});
