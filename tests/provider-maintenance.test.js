'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {normalizeFeed,fetchProviderStatus,saveObservation,readProviderStatuses,maintenanceMessage,PROVIDERS,PREFIX,HISTORY}=require('../server/providerMaintenance');
const {sendOnce}=require('../scripts/send-provider-maintenance-alert');
const now=Date.parse('2026-11-16T12:00:00Z');
function feed(provider='render'){return {page:{url:PROVIDERS[provider].origin},status:{indicator:'none'},components:[{id:'fixture-component',name:'Public API',status:'operational'}],incidents:[],scheduled_maintenances:[{id:'fixture1',name:'Scheduled fixture',status:'scheduled',scheduled_for:'2026-11-18T02:00:00Z',scheduled_until:'2026-11-18T03:00:00Z',components:[{name:'Administration'}],incident_updates:[{created_at:'2026-11-16T11:00:00Z',body:'Dashboard unavailable. Deployed services are not expected to be interrupted. password=private-secret email@private.invalid'}]}]};}
function db(){const rows=new Map();let tail=Promise.resolve(),writes=0,ordinal=0;
 const store=map=>({findUnique:async({where})=>structuredClone(map.get(where.key)||null),create:async({data})=>{writes++;if(map.has(data.key))throw Error('duplicate');map.set(data.key,{...structuredClone(data),createdAt:new Date(++ordinal)});},upsert:async({where,create,update})=>{writes++;const old=map.get(where.key);map.set(where.key,old?{...old,...structuredClone(update)}:{...structuredClone(create),createdAt:new Date(++ordinal)});},findMany:async({where,orderBy,take,cursor,skip=0})=>{
 let found=[...map.values()].filter(r=>r.key.startsWith(where.key.startsWith));if(orderBy)found.sort((a,b)=>b.createdAt-a.createdAt||b.key.localeCompare(a.key));if(cursor)found=found.slice(found.findIndex(r=>r.key===cursor.key)+skip);return structuredClone(found.slice(0,take));}});
 const prisma={runtimeStore:store(rows),$transaction:fn=>{const op=tail.then(async()=>{const copy=new Map(structuredClone([...rows]));const value=await fn({runtimeStore:store(copy),$queryRaw:async()=>[]});rows.clear();for(const row of copy)rows.set(...row);return value;});tail=op.catch(()=>{});return op;}};
 return {prisma,rows,get writes(){return writes;}};
}
test('official source binding, Toronto window, redaction and provider attribution without claiming a customer outage',()=>{
 const report=normalizeFeed('render',feed(),now),notice=report.notices[0],text=maintenanceMessage(notice);
 assert.equal(notice.sourceUrl,'https://status.render.com/incidents/fixture1');assert.match(text,/Nov 17, 2026, 9:00 p.m./);assert.match(text,/not proof/);assert.doesNotMatch(JSON.stringify(report),/private-secret|email@private/);
 assert.equal(notice.kind,'maintenance');assert.match(notice.customerImpact,/Not verified/);
});
test('malformed/nested tag delimiters cannot survive the plain-text notice projection',()=>{
 const body=feed();body.scheduled_maintenances[0].incident_updates[0].body='<scr<script>ipt>malformed</script <script';const report=normalizeFeed('render',body,now);assert.doesNotMatch(report.notices[0].description,/[<>]/);assert.doesNotMatch(maintenanceMessage(report.notices[0]),/[<>]/);
});
test('Toronto windows retain cross-midnight dates and distinguish the repeated DST hour',()=>{
 const body=feed(),event=body.scheduled_maintenances[0];event.scheduled_for='2026-11-01T05:30:00Z';event.scheduled_until='2026-11-01T06:30:00Z';
 let text=maintenanceMessage(normalizeFeed('render',body,now).notices[0]);assert.match(text,/1:30 a.m. EDT/);assert.match(text,/1:30 a.m. EST/);
 event.scheduled_for='2026-11-18T04:30:00Z';event.scheduled_until='2026-11-18T05:30:00Z';text=maintenanceMessage(normalizeFeed('render',body,now).notices[0]);assert.match(text,/Nov 17, 2026, 11:30 p.m. EST/);assert.match(text,/Nov 18, 2026, 12:30 a.m. EST/);
});
test('wrong origin, absent/malformed inventories, unknown states and inconsistent windows refuse',()=>{
 for(const mutate of [x=>delete x.components,x=>x.components=[],x=>delete x.incidents,x=>x.page.url='https://untrusted.invalid',x=>x.status.indicator='invented',x=>x.scheduled_maintenances[0].status='invented',x=>x.scheduled_maintenances[0].scheduled_until='2020-01-01',x=>x.scheduled_maintenances[0].incident_updates=[]]){const body=feed();mutate(body);assert.throws(()=>normalizeFeed('render',body,now),{code:'PROVIDER_STATUS_INVALID'});}
});
test('only fixed public GET URLs, redirects refused, no credentials; broken/oversized/non-JSON reads stay unknown',async()=>{
 let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.equal(url,'https://status.make.com/api/v2/summary.json');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});return new Response(JSON.stringify(feed('make')),{headers:{'content-type':'application/json'}});};
 assert.equal((await fetchProviderStatus('make',{fetchImpl,now:()=>now})).outcome,'observed');assert.equal(calls,1);
 for(const response of [()=>new Response('bad',{status:503}),()=>new Response('<html>bad</html>'),()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}}),()=>{throw Error('private transport details');}]){
  const result=await fetchProviderStatus('render',{fetchImpl:async()=>response(),now:()=>now});assert.equal(result.outcome,'unavailable');assert.doesNotMatch(JSON.stringify(result),/private transport/);
 }
 let requested=false;assert.equal((await fetchProviderStatus('vapi',{fetchImpl:async()=>{requested=true;},now:()=>now})).outcome,'unsupported');assert.equal(requested,false);
});
test('snapshot failure retains last-known notices; stale, unsupported or unobserved providers cannot be green',async()=>{
 const f=db();await saveObservation(f.prisma,normalizeFeed('render',feed(),now));let result=await readProviderStatuses({prisma:f.prisma,now:()=>now});assert.equal(result.providers[0].fresh,true);assert.equal(result.providers[1].indicator,'unknown');
 result=await readProviderStatuses({prisma:f.prisma,now:()=>now+16*60000});assert.equal(result.providers[0].indicator,'unknown');
 await saveObservation(f.prisma,{version:1,provider:'render',outcome:'unavailable',checkedAt:new Date(now+1000).toISOString(),failure:'Public feed unavailable'});
 result=await readProviderStatuses({prisma:f.prisma,now:()=>now+1000});assert.equal(result.providers[0].notices.length,1);assert.equal(result.providers[0].indicator,'unknown');assert.equal(result.history.length,1);
 assert.equal(result.ready,false);
});
test('concurrent identical revisions archive once, changed versions retain history and omission never invents resolution',async()=>{
 const f=db(),one=normalizeFeed('render',feed(),now);await Promise.all([saveObservation(f.prisma,one),saveObservation(f.prisma,one)]);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith(HISTORY)).length,1);
 const changed=feed();changed.scheduled_maintenances[0].status='in_progress';await saveObservation(f.prisma,normalizeFeed('render',changed,now+1000));
 const empty=feed();empty.scheduled_maintenances=[];await saveObservation(f.prisma,normalizeFeed('render',empty,now+2000));
 const before=f.writes,report=await readProviderStatuses({prisma:f.prisma,now:()=>now+2000});assert.equal(report.history.length,2);assert.equal(report.providers[0].notices.length,0);assert.ok(report.history.every(r=>r.notice.status!=='completed'));assert.equal(f.writes,before);
 const late=await saveObservation(f.prisma,one);assert.equal(late.superseded,true);assert.equal(f.rows.get(PREFIX+'render').data.checkedAt,new Date(now+2000).toISOString());
});
test('history older-page cursor is bounded and no journal is silently pruned',async()=>{
 const f=db();for(let i=0;i<35;i++){const b=feed();b.scheduled_maintenances[0].name='version '+i;await saveObservation(f.prisma,normalizeFeed('render',b,now+i));}
 const first=await readProviderStatuses({prisma:f.prisma,now:()=>now+100}),second=await readProviderStatuses({prisma:f.prisma,now:()=>now+100,cursor:first.nextCursor});assert.equal(first.history.length,30);assert.equal(second.history.length,5);assert.equal(second.hasMore,false);
 await assert.rejects(readProviderStatuses({prisma:f.prisma,cursor:'x'}),{statusCode:400});assert.equal(f.rows.size,36);
});
test('malformed persisted status does not become empty success',async()=>{const f=db();f.rows.set(PREFIX+'render',{key:PREFIX+'render',data:{version:99}});await assert.rejects(readProviderStatuses({prisma:f.prisma}),{code:'PROVIDER_STATUS_INVALID'});});
test('stored source links cannot redirect admin users; corrupt provider ownership and dates fail closed',async()=>{
 const f=db();await saveObservation(f.prisma,normalizeFeed('render',feed(),now));const snapshot=f.rows.get(PREFIX+'render').data;
 snapshot.lastGood.notices[0].sourceUrl='https://foreign.invalid/?token=private';let result=await readProviderStatuses({prisma:f.prisma,now:()=>now});assert.equal(result.providers[0].notices[0].sourceUrl,'https://status.render.com/incidents/fixture1');assert.doesNotMatch(JSON.stringify(result),/foreign.invalid|token=private/);
 snapshot.lastGood.notices[0].provider='twilio';await assert.rejects(readProviderStatuses({prisma:f.prisma,now:()=>now}),{code:'PROVIDER_STATUS_INVALID'});
});
test('incomplete archive persistence rolls back the snapshot rather than implying history was captured',async()=>{
 const f=db(),run=f.prisma.$transaction;f.prisma.$transaction=fn=>run(tx=>fn({...tx,runtimeStore:{...tx.runtimeStore,create:async()=>{throw Error('synthetic database failure');}}}));
 await assert.rejects(saveObservation(f.prisma,normalizeFeed('render',feed(),now)),/synthetic database failure/);assert.equal(f.rows.size,0);
});
test('one-shot Telegram alert records acceptance, blocks repeats and fences uncertain outcomes without exposing credentials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-maintenance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const notice=normalizeFeed('render',feed(),now).notices[0];
 let calls=0;const input={notice,token:'synthetic-token',chatId:'synthetic-chat',ledger:path.join(dir,'accepted.json'),fetchImpl:async(url,options)=>{calls++;assert.ok(url.startsWith('https://api.telegram.org/'));const payload=JSON.parse(options.body);assert.equal(payload.chat_id,'synthetic-chat');assert.match(payload.text,/Window \(Toronto\)/);return new Response(JSON.stringify({ok:true,result:{message_id:123}}));}};
 const result=await sendOnce(input);assert.equal(result.accepted,true);await assert.rejects(sendOnce(input),{code:'EEXIST'});assert.equal(calls,1);assert.doesNotMatch(fs.readFileSync(input.ledger,'utf8'),/synthetic-token|synthetic-chat/);
 const uncertain={...input,ledger:path.join(dir,'uncertain.json'),fetchImpl:async()=>{calls++;throw Error('timeout secret');}};
 await assert.rejects(sendOnce(uncertain),/unconfirmed/);await assert.rejects(sendOnce(uncertain),{code:'EEXIST'});assert.equal(calls,2);assert.equal(JSON.parse(fs.readFileSync(uncertain.ledger)).outcome,'attempt_recorded');
});
module.exports={db,feed};
