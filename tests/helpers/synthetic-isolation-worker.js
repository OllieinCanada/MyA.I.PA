// Trusted application rehearsal: synthetic DB double, loopback HTTP, no workers or providers.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const stateFile = path.join(process.env.DATA_DIR, 'fixture-db.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : { runtime:[], calls:[], callers:[], leads:[] };
const runtime = new Map(state.runtime), calls = new Map(state.calls), callers = new Map(state.callers), leads = new Map(state.leads);
const copy = value => structuredClone(value);
const snapshot = () => ({ runtime:[...runtime], calls:[...calls], callers:[...callers], leads:[...leads] });
function persist() { const temporary=stateFile+'.tmp'; fs.writeFileSync(temporary,JSON.stringify(snapshot()),{mode:0o600}); fs.renameSync(temporary,stateFile); }
let tail = Promise.resolve();
const db = {
  runtimeStore:{
    findUnique:async({where})=>runtime.has(where.key)?{key:where.key,data:copy(runtime.get(where.key))}:null,
    upsert:async({where,create,update})=>{const data=copy(runtime.has(where.key)?update.data:create.data);runtime.set(where.key,data);return{key:where.key,data:copy(data)};},
    findMany:async()=>[],
  },
  caller:{upsert:async({where,create})=>{if(!callers.has(where.phone))callers.set(where.phone,{id:101,...create});return copy(callers.get(where.phone));}},
  call:{findUnique:async({where})=>copy(where.id?[...calls.values()].find(c=>c.id===where.id):calls.get(where.externalProvider_externalId.externalId))||null,
    create:async({data})=>{const value={id:501,...data};calls.set(data.externalId,value);return copy(value);}},
  lead:{findUnique:async({where})=>copy(where.id?[...leads.values()].find(v=>v.id===where.id):leads.get(where.callId))||null,
    upsert:async({where,create,update})=>{const value=leads.has(where.callId)?{...leads.get(where.callId),...update}:{id:901,...create};leads.set(where.callId,value);return copy(value);}},
  vapiBusinessMapping:{findFirst:async({where})=>where.matchValue.in.includes('fixture-isolation-assistant')?{businessId:701}:null},
  $queryRaw:async()=>[],
  $transaction(work){const job=tail.then(async()=>{const before=copy(snapshot());try{const value=await work(db);persist();return value;}catch(error){for(const [map,name]of[[runtime,'runtime'],[calls,'calls'],[callers,'callers'],[leads,'leads']]){map.clear();for(const item of before[name])map.set(...item);}throw error;}});tail=job.catch(()=>{});return job;},
};
global.__myAiPaPrisma = new Proxy(db,{get:(target,key)=>{
  if(key in target)return target[key];
  if(typeof key!=='string'||key==='then')return undefined;
  const forbidden=async()=>{throw Error('Unexpected database query in synthetic rehearsal: '+key);};
  return key.startsWith('$')?forbidden:new Proxy({},{get:(_model,method)=>method==='then'?undefined:forbidden});
}});
const permitted = new Set(); let blocked = 0, unexpected = 0, probing = false;
const deny = () => { blocked++; if(!probing)unexpected++; throw Object.assign(Error('Synthetic staging outbound transport denied'),{code:'STAGING_EGRESS_DENIED'}); };
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];const host=typeof first==='object'?first.host:args[1];const port=typeof first==='object'?first.port:first;if(host!=='127.0.0.1'||!permitted.has(Number(port)))return deny();return nativeConnect.apply(this,args);};
for(const name of ['node:http','node:https']){const transport=require(name),request=transport.request;transport.request=function(input,...args){let u;try{u=input instanceof URL?input:typeof input==='string'?new URL(input):null;}catch{}const host=u?.hostname||input?.hostname||input?.host;const port=Number(u?.port||input?.port);if(host!=='127.0.0.1'||!permitted.has(port))return deny();return request.call(this,input,...args);};transport.get=function(...args){const request=this.request(...args);request.end();return request;};}
const nativeFetch = global.fetch;
global.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname!=='127.0.0.1'||!permitted.has(Number(u.port)))return Promise.reject((()=>{try{deny();}catch(error){return error;}})());return nativeFetch(input,{...options,redirect:'error'});};
const dns = require('node:dns'),nativeLookup=dns.lookup;dns.lookup=(host,...args)=>host==='127.0.0.1'?nativeLookup(host,...args):deny();dns.resolve=deny;
const child = require('node:child_process');for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
require('node:dgram').createSocket=deny;
const {app,__test}=require('../../server/index');
__test.upsertSignupDashboardRecord({signupAttemptId:'fixture-dashboard',businessId:701,businessName:'Synthetic isolation business',ownerEmail:'fixture@example.invalid',ownerPhone:'+15555550101',status:'setup_ready'});
const server=app.listen(0,'127.0.0.1',()=>{assert.equal(server.address().address,'127.0.0.1');permitted.add(server.address().port);process.send({kind:'ready',port:server.address().port});});
process.on('message',async message=>{
  if(message.action==='inspect'){
    const ledger=[...runtime.values()].find(v=>v.schemaVersion===1&&Array.isArray(v.receipts));
    const outbox=[...runtime.entries()].filter(([key])=>key.startsWith('staging:intake-outbox:')).map(([,value])=>value);
    process.send({kind:'inspection',id:message.id,leadCount:leads.size,callCount:calls.size,version:ledger?.version,finalized:ledger?.finalized,correctedSummary:[...leads.values()].every(v=>v.summary.includes('20 Fixture Road')&&!v.summary.includes('10 Fixture Road')),outboxCount:outbox.length,outboxPending:outbox.every(v=>v.status==='pending'),unexpectedOutboundAttempts:unexpected,blockedTransportAttempts:blocked,workersEnabled:process.env.STAGING_INTAKE_WORKER_ENABLED==='true',strictFileReadsEnabled:process.env.RECOVERY_STRICT_FILE_READS==='true',databaseUrlPresent:Boolean(process.env.DATABASE_URL),dashboardFileCreated:fs.existsSync(path.join(process.env.DATA_DIR,'signup-dashboard.json'))});
  }
  if(message.action==='probes'){
    probing=true;let rejected=0;
    for(const probe of [()=>fetch('https://example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>new net.Socket().connect({host:'203.0.113.1',port:443}),()=>dns.lookup('example.invalid'),()=>child.spawn('untrusted-command'),()=>require('node:dgram').createSocket('udp4')]){try{await probe();}catch(error){if(error.code==='STAGING_EGRESS_DENIED')rejected++;else throw error;}}
    probing=false;process.send({kind:'probes',id:message.id,rejected,unexpectedOutboundAttempts:unexpected});
  }
  if(message.action==='stop'){server.closeAllConnections?.();server.close(()=>process.exit(0));}
});
