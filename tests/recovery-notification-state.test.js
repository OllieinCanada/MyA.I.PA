const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { dispatchPrepared: dispatchWithExplicitPolicy } = require('../scripts/recovery-notification-state');
const preparationPolicy = require('./fixtures/recovery-policy.synthetic.json');
const dispatchPrepared = (report, options) => dispatchWithExplicitPolicy(report, { ...options, preparationPolicy });
const { openNotificationStore, resolveLocalDirectory } = require('../scripts/recovery-notification-store');
const model = require('../scripts/recovery-notification-model');
const base = Date.parse('2026-11-02T00:00:00.000Z');
const report = (sequence = 1, code = 'BACKUP_FAILED', severity = 'critical') => ({ checkedAt: new Date(base + sequence * 1000).toISOString(), severity: code ? severity : 'healthy', issues: code ? [{ code, severity }] : [] });
function fixture(t, initialize = true) {
  const parent = path.resolve(process.env.TMPDIR || os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'recovery-notice-fixture-'));
  const store = openNotificationStore({ directory, monitorId: 'synthetic-monitor' });
  if (initialize) store.initialize();
  t.after(() => { const target = path.resolve(directory); assert.ok(target.startsWith(parent + path.sep) && path.basename(target).startsWith('recovery-notice-fixture-')); fs.rmSync(target, { recursive: true, force: true }); });
  return { directory, store, filename: path.join(directory, 'notification-state.json') };
}
const acceptedTransports = calls => Object.fromEntries(model.CHANNELS.map(channel => [channel, async message => { calls.push({ channel, ...message }); return { accepted: true }; }]));
const dispatch = (store, health, transports) => dispatchPrepared(health, { store, transports, approvedActivation: true });
const worker = path.join(__dirname, 'helpers/recovery-notification-worker.js');
const runChild = (directory, mode, health) => spawnSync(process.execPath, [worker, directory, mode, JSON.stringify(health)], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
const acceptedRows = directory => {
  const filename = path.join(directory, 'synthetic-accepted.jsonl');
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
};

test('default and false-like activation cannot send or mutate an explicitly supplied store', async t => {
  const { store } = fixture(t), initial = store.readState(), calls = [];
  for (const approvedActivation of [undefined, false, 'false', 'true', 1, null]) {
    const out = await dispatchPrepared(report(), { store, transports: acceptedTransports(calls), approvedActivation });
    assert.equal(out.activated, false); assert.equal(out.networkRequests, 0);
  }
  assert.equal(calls.length, 0); assert.deepEqual(store.readState(), initial);
});

test('unconditional persistence callbacks and counterfeit stores are rejected before transport', async () => {
  const calls = [];
  for (const options of [{ persist: async () => {} }, { store: { transaction: callback => callback({}) } }]) await assert.rejects(dispatchPrepared(report(), { ...options, approvedActivation: true, transports: acceptedTransports(calls) }), /EXPLICIT_EXCLUSIVE_DURABLE_STORE/);
  assert.equal(calls.length, 0);
});

test('each durable intent precedes its simulated send and stable keys do not claim recipient receipt', async t => {
  const { store } = fixture(t), calls = [];
  const transports = Object.fromEntries(model.CHANNELS.map(channel => [channel, async message => {
    const state = store.readState(), event = state.events.find(value => value.id === message.eventId);
    assert.equal(event.attempts[channel].status, 'started_outcome_unconfirmed');
    assert.ok(event.attempts[channel].token); assert.equal(state.observation.fingerprint, event.fingerprint);
    calls.push(message.idempotencyKey); return { accepted: true };
  }]));
  const out = await dispatch(store, report(), transports);
  assert.equal(calls.length, 2); assert.equal(new Set(calls).size, 2); assert.equal(out.recipientReceiptProven, false);
  assert.equal(out.state.events[0].attempts.telegram.status, 'accepted_not_recipient_receipt');
});

test('unchanged healthy and unhealthy observations are quiet after completed notices', async t => {
  const { store } = fixture(t), calls = [], transports = acceptedTransports(calls);
  await dispatch(store, report(0, null), transports); assert.equal(calls.length, 0);
  await dispatch(store, report(1), transports);
  assert.equal((await dispatch(store, report(2), transports)).action, 'quiet-unchanged');
  await dispatch(store, report(3, null), transports);
  assert.equal((await dispatch(store, report(4, null), transports)).action, 'quiet');
  assert.equal(calls.length, 4); assert.equal(store.readState().eventSequence, 2);
});

test('failure A to failure B to failure A has three distinct durable transition IDs in one episode', async t => {
  const { store } = fixture(t), calls = [], transports = acceptedTransports(calls);
  for (const [index, code] of ['BACKUP_FAILED','KEY_RECOVERY_UNPROVEN_OR_FAILED','BACKUP_FAILED'].entries()) await dispatch(store, report(index + 1, code), transports);
  const state = store.readState();
  assert.equal(calls.length, 6); assert.equal(state.events.length, 3); assert.equal(state.episodeSequence, 1);
  assert.equal(new Set(state.events.map(event => event.id)).size, 3);
  assert.equal(new Set(state.events.map(event => event.episodeId)).size, 1);
  assert.equal(state.events[0].fingerprint, state.events[2].fingerprint);
});

test('recovery and a later identical failure start a new episode rather than reusing channel attempts', async t => {
  const { store } = fixture(t), calls = [], transports = acceptedTransports(calls);
  await dispatch(store, report(1), transports); await dispatch(store, report(2, null), transports); await dispatch(store, report(3), transports);
  const state = store.readState();
  assert.equal(calls.length, 6); assert.equal(state.episodeSequence, 2);
  assert.notEqual(state.events[0].episodeId, state.events[2].episodeId);
  assert.equal(state.events[0].fingerprint, state.events[2].fingerprint);
});

test('unconfirmed outcomes are held per event/channel across reload, not globally across future episodes', async t => {
  const { directory, store } = fixture(t), calls = [];
  const uncertain = Object.fromEntries(model.CHANNELS.map(channel => [channel, async message => { calls.push({ channel, ...message }); throw Error('synthetic response lost'); }]));
  await dispatch(store, report(1), uncertain);
  const reopened = openNotificationStore({ directory, monitorId: 'synthetic-monitor' });
  assert.equal((await dispatch(reopened, report(2), uncertain)).action, 'hold-uncertain-no-repeat');
  assert.equal(calls.length, 2);
  await dispatch(reopened, report(3, null), acceptedTransports(calls));
  await dispatch(reopened, report(4), acceptedTransports(calls));
  assert.equal(calls.length, 6);
  assert.equal(reopened.readState().events[0].attempts.telegram.status, 'outcome_unconfirmed');
});

test('definite rejections remain review-required and are not automatically repeated', async t => {
  const { store } = fixture(t); let calls = 0;
  const reject = async () => { calls++; throw Object.assign(Error('synthetic rejection'), { definiteRejection: true }); };
  await dispatch(store, report(1), { telegram: reject, email: reject });
  await dispatch(store, report(2), { telegram: reject, email: reject });
  assert.equal(calls, 2); assert.equal(store.readState().events[0].attempts.telegram.status, 'rejected_requires_review');
});

test('a failed durable write prevents every simulated transport call', async t => {
  const { store, filename } = fixture(t), calls = [], original = fs.renameSync;
  const mocked = t.mock.method(fs, 'renameSync', (from, to) => { if (to === filename) throw Error('synthetic write failed'); return original(from, to); });
  await assert.rejects(dispatch(store, report(), acceptedTransports(calls)), /synthetic write failed/);
  mocked.mock.restore(); assert.equal(calls.length, 0); assert.equal(store.readState().events.length, 0);
});

test('lost result persistence preserves the durable unknown intent and permits only the unattempted other channel', async t => {
  const { store, filename } = fixture(t), calls = [], original = fs.renameSync; let failNext = false;
  const mocked = t.mock.method(fs, 'renameSync', (from, to) => { if (to === filename && failNext) { failNext = false; throw Error('synthetic crash while saving outcome'); } return original(from, to); });
  const transports = { ...acceptedTransports(calls), telegram: async message => { calls.push({ channel: 'telegram', ...message }); failNext = true; return { accepted: true }; } };
  await assert.rejects(dispatch(store, report(1), transports), /synthetic crash/);
  mocked.mock.restore();
  assert.equal(store.readState().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
  await dispatch(store, report(2), acceptedTransports(calls));
  assert.deepEqual(calls.map(call => call.channel), ['telegram','email']);
});

test('a hung channel times out as uncertain so the backup channel can proceed without replay', async t => {
  const { store } = fixture(t), calls = []; let signal;
  await dispatchPrepared(report(1), { store, approvedActivation:true, transportTimeoutMs:100, transports:{telegram:async (message,options)=>{calls.push({channel:'telegram',...message});signal=options.signal;return new Promise(()=>{});},email:acceptedTransports(calls).email} });
  assert.equal(signal.aborted,true); assert.equal(store.readState().events[0].attempts.telegram.status,'outcome_unconfirmed');
  await dispatch(store,report(2),acceptedTransports(calls));assert.deepEqual(calls.map(value=>value.channel),['telegram','email']);
});

test('acceptance arriving after a transport deadline cannot clear held uncertainty or trigger another send', async t => {
  const {store}=fixture(t),calls=[];let late;
  await dispatchPrepared(report(1),{store,approvedActivation:true,transportTimeoutMs:100,transports:{telegram:async message=>{calls.push({channel:'telegram',...message});return new Promise(resolve=>{late=resolve;});},email:acceptedTransports(calls).email}});
  late({accepted:true});await new Promise(resolve=>setImmediate(resolve));
  await dispatch(store,report(2),acceptedTransports(calls));assert.equal(calls.length,2);assert.equal(store.readState().events[0].attempts.telegram.status,'outcome_unconfirmed');
});

test('invalid or unbounded transport deadline settings fail before state mutation or transport', async t => {
  const {store}=fixture(t),calls=[],before=store.readState();
  for(const transportTimeoutMs of [0,-1,'100',Infinity,30001,99,100.5]) await assert.rejects(dispatchPrepared(report(),{store,approvedActivation:true,transportTimeoutMs,transports:acceptedTransports(calls)}),/BOUNDED_TRANSPORT_REQUIRED/);
  assert.deepEqual(store.readState(),before);assert.equal(calls.length,0);
});

for (const kind of ['plain-acceptance','resolved-promise','thrown-rejection','rejected-promise']) test(`an overdue synchronous ${kind} cannot beat a delayed cooperative timer`, async t => {
  const {store}=fixture(t),calls=[];let signal;
  const telegram=(message,options)=>{
    calls.push({channel:'telegram',...message});signal=options.signal;
    const until=performance.now()+250;while(performance.now()<until){} // Deliberately block this disposable test process.
    if(kind==='plain-acceptance')return{accepted:true};
    if(kind==='resolved-promise')return Promise.resolve({accepted:true});
    const error=Object.assign(Error('synthetic overdue rejection'),{definiteRejection:true});
    if(kind==='thrown-rejection')throw error;
    return Promise.reject(error);
  };
  const started=performance.now();
  await dispatchPrepared(report(1),{store,approvedActivation:true,transportTimeoutMs:100,transports:{telegram,email:acceptedTransports(calls).email}});
  assert.ok(performance.now()-started>=250,'same-process cancellation is not a hard execution cutoff');
  assert.equal(signal.aborted,true);assert.equal(store.readState().events[0].attempts.telegram.status,'outcome_unconfirmed');
  assert.deepEqual(calls.map(value=>value.channel),['telegram','email']);
  await dispatch(store,report(2),acceptedTransports(calls));assert.equal(calls.length,2);
});

test('a rejection arriving after an already expired asynchronous timer remains held uncertainty', async t => {
  const {store}=fixture(t),calls=[];let rejectLate;
  await dispatchPrepared(report(1),{store,approvedActivation:true,transportTimeoutMs:100,transports:{telegram:message=>{calls.push({channel:'telegram',...message});return new Promise((_resolve,reject)=>{rejectLate=reject;});},email:acceptedTransports(calls).email}});
  rejectLate(Object.assign(Error('synthetic late rejection'),{definiteRejection:true}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.readState().events[0].attempts.telegram.status,'outcome_unconfirmed');
  await dispatch(store,report(2),acceptedTransports(calls));assert.equal(calls.length,2);
});

for (const [mode, exitCode, expectedTelegram] of [['crash-before-acceptance',77,0],['crash-after-acceptance',78,1]]) test(`real process ${mode} is not blindly replayed after restart`, async t => {
  const { directory, store } = fixture(t);
  const crashed = runChild(directory, mode, report(1)); assert.equal(crashed.status, exitCode, crashed.stderr);
  assert.equal(store.readState().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
  const resumed = runChild(directory, 'resume', report(2)); assert.equal(resumed.status, 0, resumed.stderr);
  const rows = acceptedRows(directory);
  assert.equal(rows.filter(value => value.channel === 'telegram').length, expectedTelegram);
  assert.equal(rows.filter(value => value.channel === 'email').length, 1);
});

test('an interrupted recovery notice can finish its unattempted channel without suppressing a later failure', async t => {
  const { directory, store } = fixture(t), calls = [];
  await dispatch(store, report(1), acceptedTransports(calls));
  assert.equal(runChild(directory, 'crash-after-acceptance', report(2, null)).status, 78);
  assert.equal(runChild(directory, 'resume', report(3, null)).status, 0);
  const rows = acceptedRows(directory); assert.equal(rows.length, 2); assert.equal(new Set(rows.map(value => value.key)).size, 2);
  await dispatch(store, report(4), acceptedTransports(calls));
  assert.equal(calls.length, 4); assert.equal(store.readState().episodeSequence, 2);
});

test('two overlapping dispatchers can claim each event/channel only once', async t => {
  const { directory, store } = fixture(t), calls = [];
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; }), claimed = new Promise(resolve => { started = resolve; });
  const first = dispatch(store, report(1), { telegram: async message => { calls.push({ channel:'telegram', ...message }); started(); await waiting; return { accepted:true }; }, email: acceptedTransports(calls).email });
  await claimed;
  const secondStore = openNotificationStore({ directory, monitorId:'synthetic-monitor' });
  await dispatch(secondStore, report(1), acceptedTransports(calls)); release(); await first;
  assert.equal(calls.length,2); assert.equal(new Set(calls.map(value=>value.idempotencyKey)).size,2);
});

test('late outcomes cannot roll back newer observed health or send an obsolete unattempted channel', async t => {
  const { store } = fixture(t), calls = [];
  let release, started;
  const waiting = new Promise(resolve=>{release=resolve;}), claimed = new Promise(resolve=>{started=resolve;});
  const first = dispatch(store,report(1),{telegram:async message=>{calls.push({channel:'telegram',...message});started();await waiting;return{accepted:true};},email:acceptedTransports(calls).email});
  await claimed;
  await dispatch(store,report(2,'FILE_COVERAGE_INVALID_OR_UNKNOWN'),acceptedTransports(calls));
  release();await first;
  const state=store.readState();assert.equal(state.observation.eventId,state.events[1].id);assert.equal(calls.length,3);
  assert.equal(state.events[0].attempts.email.status,'superseded_without_attempt');
});

test('stale reports and conflicting equal timestamps cannot invent reverse health transitions', async t => {
  const { store } = fixture(t), calls = [], transports=acceptedTransports(calls);
  await dispatch(store,report(2),transports);
  await assert.rejects(dispatch(store,report(1,null),transports),/OBSERVATION_STALE/);
  await assert.rejects(dispatch(store,report(2,null),transports),/OBSERVATION_ORDER_CONFLICT/);
  assert.equal(calls.length,2);assert.equal(store.readState().events.length,1);
});

test('revision CAS rejects stale snapshots and terminal attempts cannot be reset', async t => {
  const {store}=fixture(t), stale=store.readState(),calls=[];
  await dispatch(store,report(),acceptedTransports(calls));
  assert.throws(()=>store.transaction((_saved,commit)=>commit(stale,stale.revision)),/REVISION_CONFLICT/);
  assert.throws(()=>store.transaction((saved,commit)=>{saved.events[0].attempts.telegram={status:'not_attempted'};commit(saved,saved.revision);}),/ATTEMPT_REWRITE/);
  assert.equal(calls.length,2);assert.equal(store.readState().events[0].attempts.telegram.status,'accepted_not_recipient_receipt');
});

for (const status of ['started_outcome_unconfirmed','outcome_unconfirmed','accepted_not_recipient_receipt']) test(`legacy ${status} state requires review without reset or automatic migration`, async t => {
  const {store,filename}=fixture(t),calls=[];
  const bytes=JSON.stringify({openFingerprint:'a'.repeat(64),uncertainFingerprint:'a'.repeat(64),attempts:{['a'.repeat(64)+':telegram']:{status}}});
  fs.writeFileSync(filename,bytes);
  await assert.rejects(dispatch(store,report(),acceptedTransports(calls)),/LEGACY_OR_UNKNOWN_STATE_REQUIRES_REVIEW/);
  assert.throws(()=>store.initialize(),/ALREADY_EXISTS_DO_NOT_RESET/);assert.equal(fs.readFileSync(filename,'utf8'),bytes);assert.equal(calls.length,0);
});

test('missing state never implicitly initializes itself before dispatch', async t => {
  const {store}=fixture(t,false),calls=[];
  await assert.rejects(dispatch(store,report(),acceptedTransports(calls)),/ENOENT/);assert.equal(calls.length,0);
});

test('stale or unknown lock ownership is never stolen or deleted', async t => {
  const {store,directory}=fixture(t), lock=path.join(directory,'notification-state.lock');
  fs.mkdirSync(lock);const owner=path.join(lock,'owner.json'),bytes=JSON.stringify({token:crypto.randomUUID(),createdAt:'2000-01-01T00:00:00.000Z'});fs.writeFileSync(owner,bytes);
  await assert.rejects(dispatch(store,report(),acceptedTransports([])),/LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE/);
  assert.equal(fs.readFileSync(owner,'utf8'),bytes);
});

test('real-process crashes during state ownership leave a visible lock and cannot trigger sends', async t => {
  const {store,directory}=fixture(t);
  assert.equal(runChild(directory,'crash-with-lock',report()).status,79);
  await assert.rejects(dispatch(store,report(),acceptedTransports([])),/LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE/);
  assert.equal(acceptedRows(directory).length,0);
});

test('real competing processes cannot both dispatch one channel claim', async t => {
  const {directory,store}=fixture(t);
  const processes=[1,2].map(()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,directory,'race',JSON.stringify(report())],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>{stderr+=data;});child.on('error',reject);child.on('close',status=>resolve({status,stderr}));
  }));
  fs.writeFileSync(path.join(directory,'start-barrier'),'synthetic-only');
  const outcomes=await Promise.all(processes);assert.ok(outcomes.every(value=>[0,75].includes(value.status)),JSON.stringify(outcomes));
  const resumed=runChild(directory,'resume',report(2));assert.equal(resumed.status,0,resumed.stderr);
  const rows=acceptedRows(directory);assert.equal(rows.length,2);assert.equal(new Set(rows.map(value=>value.key)).size,2);
  assert.equal(store.readState().events[0].attempts.email.status,'accepted_not_recipient_receipt');
});

test('redirected state directories are rejected before reading or claiming', t => {
  const {directory}=fixture(t), parent=path.dirname(directory), link=directory+'-junction';
  fs.symlinkSync(directory,link,process.platform==='win32'?'junction':'dir');
  t.after(()=>{assert.ok(path.resolve(link).startsWith(parent+path.sep));fs.unlinkSync(link);});
  assert.throws(()=>openNotificationStore({directory:link,monitorId:'synthetic-monitor'}),/DIRECTORY_REDIRECTED/);
});

test('monitor identity, corrupted histories and ambiguous attempt records fail closed', t => {
  const {directory,store,filename}=fixture(t), original=store.readState();
  assert.throws(()=>openNotificationStore({directory,monitorId:'another-monitor'}).readState(),/MONITOR_MISMATCH/);
  for(const change of [state=>{state.schemaVersion=99;},state=>{state.eventSequence=1;},state=>{state.episodeSequence=3;},state=>{state.revision=-1;},state=>{state.uncertainFingerprint='legacy';}]){const value=structuredClone(original);change(value);fs.writeFileSync(filename,JSON.stringify(value));assert.throws(()=>store.readState());}
});

test('invalid JSON and UTF-8 are sanitized without exposing source bytes or initializing state', t => {
  const {store,filename}=fixture(t);
  for(const bytes of [Buffer.from('PRIVATE_SYNTHETIC_VALUE_DO_NOT_ECHO'),Buffer.from([0xff,0xfe,0xff])]){
    fs.writeFileSync(filename,bytes);
    assert.throws(()=>store.readState(),error=>error.code==='RECOVERY_NOTIFICATION_STATE_ENCODING_OR_JSON_INVALID_NO_RESET'&&!error.message.includes('PRIVATE_SYNTHETIC'));
    assert.deepEqual(fs.readFileSync(filename),bytes);
  }
});

test('a hardlinked state cannot alias another file or authorize dispatch', async t => {
  const {store,filename,directory}=fixture(t),alias=path.join(directory,'synthetic-alias.json'),calls=[];
  fs.linkSync(filename,alias);
  await assert.rejects(dispatch(store,report(),acceptedTransports(calls)),/STATE_FILE_INVALID/);assert.equal(calls.length,0);
});

test('Windows UNC, slash-style UNC and device namespace paths fail before filesystem inspection', t => {
  let filesystemCalls=0;const original=fs.lstatSync;
  const mocked=t.mock.method(fs,'lstatSync',(...args)=>{filesystemCalls++;return original(...args);});
  for(const directory of ['//synthetic-server/synthetic-share/state','\\\\synthetic-server\\synthetic-share\\state','//?/UNC/synthetic-server/share/state','\\\\?\\UNC\\synthetic-server\\share\\state','\\\\?\\C:\\state','\\state','C:state'])assert.throws(()=>resolveLocalDirectory(directory,'win32',path.win32),/EXPLICIT_LOCAL_DIRECTORY_REQUIRED/);
  assert.throws(()=>resolveLocalDirectory('C:/','win32',path.win32),/DEDICATED_DIRECTORY_REQUIRED/);
  assert.equal(resolveLocalDirectory('C:/synthetic/state','win32',path.win32),'C:\\synthetic\\state');
  mocked.mock.restore();assert.equal(filesystemCalls,0);
});

test('dangling-entry presence is not treated as absence during initialization without requiring symlink privilege', t => {
  const {store,filename,directory}=fixture(t,false),original=fs.lstatSync;
  const mocked=t.mock.method(fs,'lstatSync',(value,options)=>value===filename?{isSymbolicLink:()=>true,isFile:()=>false}:original(value,options));
  assert.throws(()=>store.initialize(),/STATE_ALREADY_EXISTS_DO_NOT_RESET/);
  mocked.mock.restore();assert.equal(fs.existsSync(filename),false);assert.deepEqual(fs.readdirSync(directory),[]);
});

test('only explicit ENOENT permits initialization; permission failures cannot look absent', t => {
  const {store,filename,directory}=fixture(t,false),original=fs.lstatSync;
  const mocked=t.mock.method(fs,'lstatSync',(value,options)=>{if(value===filename)throw Object.assign(Error('synthetic inaccessible state'),{code:'EACCES'});return original(value,options);});
  assert.throws(()=>store.initialize(),error=>error.code==='EACCES');
  mocked.mock.restore();assert.equal(fs.existsSync(filename),false);assert.deepEqual(fs.readdirSync(directory),[]);
});

test('exclusive initialization cannot replace an entry created after the absence check', t => {
  const {store,filename}=fixture(t,false),original=fs.linkSync,bytes='SYNTHETIC_EXISTING_ENTRY_DO_NOT_REPLACE';
  const mocked=t.mock.method(fs,'linkSync',(from,to)=>{if(to===filename)fs.writeFileSync(filename,bytes,{flag:'wx'});return original(from,to);});
  assert.throws(()=>store.initialize(),error=>error.code==='EEXIST');
  mocked.mock.restore();assert.equal(fs.readFileSync(filename,'utf8'),bytes);
});
