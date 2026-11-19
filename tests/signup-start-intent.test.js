const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),babel=require('@babel/core');
const filename=path.resolve(__dirname,'../src/features/signup/signupStartIntent.js');
function load(){const c=new Module(filename,module);c.filename=filename;c.paths=module.paths;c._compile(babel.transformFileSync(filename,{configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-modules-commonjs')]}).code,filename);return c.exports;}
function store(){const saved=new Map();return{saved,getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};}
test('only a fresh explicit intent is consumed; passive loads, future/stale/malformed pointers do not create starts',()=>{
 const s=store(),m=load();assert.equal(m.consumeSignupStart(s,1000),false);m.noteSignupStart(s,1000);assert.equal(m.consumeSignupStart(s,1001),true);assert.equal(m.consumeSignupStart(s,1002),false);
 m.noteSignupStart(s,1000);assert.equal(m.consumeSignupStart(s,121001),false);m.noteSignupStart(s,2000);assert.equal(m.consumeSignupStart(s,1000),false);
 for(const value of ['not-json','{"version":1,"at":"1000"}','{"version":1,"at":1000,"name":"PRIVATE"}']){s.setItem('myaipa_signup_start_intent_v1',value);assert.equal(load().consumeSignupStart(s,1001),false);}
});
test('intent survives only same-tab navigation, holds no identity/form data and has a memory fallback',()=>{
 const s=store(),m=load();m.noteSignupStart(s,1000);assert.deepEqual(JSON.parse([...s.saved.values()][0]),{version:1,at:1000});assert.equal(load().consumeSignupStart(s,1001),true);
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};m.noteSignupStart(broken,1000);assert.equal(m.consumeSignupStart(broken,1001),true);assert.equal(m.consumeSignupStart(broken,1002),false);
});
test('same-origin signup anchors are tracked, not passive loads, external links, modified clicks or other routes',()=>{
 const previous=global.window,s=store(),listeners=new Map();global.window={sessionStorage:s,location:{origin:'https://www.fixture.test',href:'https://www.fixture.test/#/'}};
 try{const m=load(),doc={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},stop=m.installSignupStartLinks(doc);assert.equal(m.consumeSignupStart(),false);
  const click=(href,extra={})=>listeners.get('click')({button:0,target:{closest:()=>({href,target:'',hasAttribute:()=>false})},...extra});
  click('https://www.fixture.test/#/signup');assert.equal(m.consumeSignupStart(),true);
  for(const [url,extra]of [['https://other.test/#/signup',{}],['https://www.fixture.test/#/admin',{}],['https://www.fixture.test/#/signup',{ctrlKey:true}],['https://www.fixture.test/#/signup',{defaultPrevented:true}]]){click(url,extra);assert.equal(m.consumeSignupStart(),false);}
  stop();assert.equal(listeners.size,0);m.navigateToSignup();assert.equal(global.window.location.hash,'/signup');assert.equal(m.consumeSignupStart(),true);
 }finally{global.window=previous;}
});
