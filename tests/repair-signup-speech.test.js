const test=require("node:test");
const assert=require("node:assert/strict");
const {repair}=require("../scripts/repair-signup-speech");
function fixture(){
  let a={id:"a",firstMessage:"Thanks for calling Test Electric. How are you today?",voice:{provider:"vapi",voiceId:"Jess",version:2},model:{provider:"openai",model:"gpt-4o",toolIds:["tenant-tool","end-call"],messages:[{role:"system",content:"Business instructions.\nAfter the caller answers how they are, give the recording notice."}]}};
  const patches=[];
  const api=async(path,options={})=>{if(path.startsWith("/phone-number"))return{id:"p",number:"+12895550123",assistantId:"a"};if(options.method==="PATCH"){patches.push(options.body);a={...a,...options.body};}return structuredClone(a);};
  return{api,patches};
}
const params={assistantId:"a",phoneId:"p",number:"+12895550123"};
test("dry-run never writes",async()=>{const f=fixture();const r=await repair({...f,...params});assert.equal(f.patches.length,0);assert.ok(Object.values(r.after).every(Boolean));});
test("repair changes speech but preserves model and tenant tools",async()=>{const f=fixture();const r=await repair({...f,...params,apply:true});assert.equal(r.toolsPreserved,true);assert.equal(r.liveAudioTest,"required");assert.deepEqual(f.patches[0].model.toolIds,["tenant-tool","end-call"]);assert.equal(f.patches[0].model.model,"gpt-4o");});
test("wrong pairing cannot be patched",async()=>{const f=fixture();await assert.rejects(repair({...f,...params,assistantId:"another",apply:true}),/pairing/);assert.equal(f.patches.length,0);});
test("concurrent edits cannot be overwritten",async()=>{const f=fixture();let n=0;const api=async(p,o)=>{const a=await f.api(p,o);if(p==="/assistant/a"&&++n===2)a.firstMessage="New opening.";return a;};await assert.rejects(repair({...params,api,apply:true}),/changed during review/);assert.equal(f.patches.length,0);});
test("trial-gated phones require authenticated exact CRM pairing",async()=>{const f=fixture();const api=async(p,o)=>p.startsWith("/phone-number")?{id:"p",number:params.number,server:{url:"https://api.myaipa.ca/api/webhooks/voice"}}:f.api(p,o);await assert.rejects(repair({...params,api}),/pairing/);const r=await repair({...params,api,verifyGatedPairing:async()=>true});assert.equal(r.mode,"dry-run");assert.equal(f.patches.length,0);});
