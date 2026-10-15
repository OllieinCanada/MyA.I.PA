const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { provisioningStateKey } = require('../server/provisioningState');
const {receiptKey,WORKER_KEY}=require('../server/twilioStatusInbox');
const databaseUrl = process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL;
const reportPath = path.resolve('diagnostics/signup-failure-recovery-audit/postgres-restart.json');

async function main() {
  if (!databaseUrl) throw Error('Set SIGNUP_RECOVERY_DRILL_DATABASE_URL to an isolated loopback PostgreSQL database named myaipa_recovery_drill_<suffix>. Production DATABASE_URL is never used.');
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname)) throw Error('Refusing a non-isolated/non-loopback database.');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // Full application startup requires its normal schema, applied independently
  // to this disposable database. This script never migrates or truncates a DB.
  await prisma.runtimeStore.count().catch(async error => { await prisma.$disconnect(); throw error; });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-pg-restart-'));
  const children = new Set(), keys = new Set(), cases = [];
  async function start(args=[]) {
    const child = fork(path.resolve('tests/helpers/signup-postgres-restart-worker.js'), args, {
      execArgv: ['--max-old-space-size=96'],
      cwd, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test', DATABASE_URL: databaseUrl,
        DATA_DIR: path.join(cwd, 'data'),
        DISABLE_LOCAL_ENV_FILES: '1',
        JWT_SECRET: 'isolated-recovery-drill-secret-not-for-production', ADMIN_PASSWORD: 'isolated-drill-admin-not-for-production' },
    });
    children.add(child);
    let startupError = '';
    child.stderr.on('data', chunk => { startupError = (startupError + String(chunk)).slice(-2000).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]'); });
    const exited = new Promise(resolve => child.once('exit', code => { children.delete(child); resolve(code); }));
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(Error('Full application startup timed out')); }, 15000);
      child.once('message', msg => { clearTimeout(timer); resolve(msg.port); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Full application exited before readiness: ${startupError}`)); });
    });
    return { child, exited, call: async (body, endpoint = '/__local-signup-recovery-drill') => (await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })).json() };
  }
  try {
    for (const kind of ['twilio-number', 'vapi-assistant', 'vapi-import', 'signup-sms', 'stripe-trial', 'crm']) {
      for (const fault of ['before-dispatch', 'after-provider', 'after-commit']) {
        const identity = `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const key = provisioningStateKey(kind, identity), providerKey = `drill-provider:${identity}:${kind}`;
        keys.add(key); keys.add(providerKey);
        const first = await start();
        await first.call({ identity, kind, fault }).catch(() => {});
        assert.equal(await first.exited, 86);
        const second = await start();
        let competitor;
        try {
          if (fault !== 'after-commit') {
            assert.equal((await second.call({ identity, kind })).code, 'PROVISIONING_ALREADY_IN_PROGRESS');
            // Expire only this drill's exact synthetic claim, not a real lease.
            const row = await prisma.runtimeStore.findUnique({ where: { key } });
            await prisma.runtimeStore.update({ where: { key }, data: { data: { ...row.data, leaseExpiresAt: new Date(0).toISOString() } } });
          }
          competitor = await start();
          const results = await Promise.all([second.call({ identity, kind }), competitor.call({ identity, kind })]);
          assert.ok(results.some(result => result.id));
          assert.equal((await prisma.runtimeStore.findUnique({ where: { key: providerKey } })).data.creates, 1);
          cases.push({ kind, fault, recovered: true, providerCreates: 1, independentProcesses: 2 });
          console.log(JSON.stringify({ kind, fault, passed: true }));
        } finally {
          second.child.kill(); await second.exited;
          if (competitor) { competitor.child.kill(); await competitor.exited; }
        }
      }
    }
    for (const purpose of ['owner-test', 'customer-test', 'setup-complete']) {
      for (const fault of ['after-provider', 'after-commit']) {
        const identity = `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dispatchKey = crypto.createHash('sha256').update(JSON.stringify([identity, purpose, '', '+19055550123', '+12895550123'])).digest('hex');
        const key = provisioningStateKey('signup-sms', dispatchKey), providerKey = `drill-sms-provider:${identity}:${purpose}`;
        keys.add(key); keys.add(providerKey);
        const endpoint = '/__local-signup-sms-drill';
        const first = await start();
        await first.call({ identity, purpose, fault }, endpoint).catch(() => {});
        assert.equal(await first.exited, 86);
        if (fault === 'after-provider') {
          const row = await prisma.runtimeStore.findUnique({ where: { key } });
          await prisma.runtimeStore.update({ where: { key }, data: { data: { ...row.data, leaseExpiresAt: new Date(0).toISOString() } } });
        }
        const second = await start(), competitor = await start();
        try {
          const results = await Promise.all([second.call({ identity, purpose }, endpoint), competitor.call({ identity, purpose }, endpoint)]);
          if (fault === 'after-provider') assert.ok(results.every(result => ['PROVISIONING_RECONCILIATION_REQUIRED', 'PROVISIONING_ALREADY_IN_PROGRESS'].includes(result.code)));
          else assert.ok(results.every(result => result.sid === 'SMisolated'));
          assert.equal((await prisma.runtimeStore.findUnique({ where: { key: providerKey } })).data.creates, 1);
          cases.push({ kind: purpose, actualSmsDispatchHelper: true, fault, providerCreates: 1, independentProcesses: 2,
            outcome: fault === 'after-provider' ? 'safe_reconciliation_hold_no_resend' : 'saved_receipt_reused' });
          console.log(JSON.stringify({ kind: purpose, fault, passed: true }));
        } finally { second.child.kill(); competitor.child.kill(); await Promise.all([second.exited, competitor.exited]); }
      }
    }
    for(const fault of ['after-receipt','after-send']){
      const sid='SM'+crypto.randomBytes(16).toString('hex'),endpoint='/__local-twilio-receipt-drill';
      const key=receiptKey({MessageSid:sid,MessageStatus:'delivered'}),providerKey='drill-status-provider:'+sid;
      const dispatchIdentity=crypto.createHash('sha256').update(JSON.stringify([sid,'status-drill','','+19055550123',''])).digest('hex');
      keys.add(key);keys.add(WORKER_KEY);keys.add(providerKey);keys.add(provisioningStateKey('signup-sms',dispatchIdentity));
      const first=await start(['--status-inbox-drill']);
      if(fault==='after-send')await first.call({sid,action:'enqueue'},endpoint);
      await first.call({sid,action:fault==='after-receipt'?'enqueue':'drain',fault},endpoint).catch(()=>{});
      assert.equal(await first.exited,86);
      if(fault==='after-send'){
        for(const target of [key,WORKER_KEY]){
          const row=await prisma.runtimeStore.findUnique({where:{key:target}});
          await prisma.runtimeStore.update({where:{key:target},data:{data:{...row.data,leaseExpiresAt:0}}});
        }
      }
      const second=await start(['--status-inbox-drill']),competitor=await start(['--status-inbox-drill']);
      try{
        await Promise.all([second.call({sid,action:'drain'},endpoint),competitor.call({sid,action:'drain'},endpoint)]);
        assert.equal((await prisma.runtimeStore.findUnique({where:{key:providerKey}})).data.creates,1);
        assert.equal((await prisma.runtimeStore.findUnique({where:{key}})).data.status,'completed');
        await second.call({sid,action:'enqueue'},endpoint);await second.call({sid,action:'drain'},endpoint);
        assert.equal((await prisma.runtimeStore.findUnique({where:{key:providerKey}})).data.creates,1);
        cases.push({kind:'twilio-status-inbox',fault,recovered:true,providerCreates:1,independentProcesses:2});
        console.log(JSON.stringify({kind:'twilio-status-inbox',fault,passed:true}));
      }finally{second.child.kill();competitor.child.kill();await Promise.all([second.exited,competitor.exited]);}
    }
    return { passed: true, realPostgresLocks: true, fullApplicationProcessRestarts: true, externalProvidersMocked: true, leaseExpirySimulated: true, productionTouched: false, cases };
  } finally {
    await Promise.all([...children].map(child => new Promise(resolve => { child.once('exit', resolve); child.kill(); })));
    await prisma.runtimeStore.deleteMany({ where: { key: { in: [...keys] } } });
    await prisma.$disconnect();
    const resolvedCwd = fs.realpathSync(cwd), tempRoot = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolvedCwd) !== tempRoot || !path.basename(resolvedCwd).startsWith('myaipa-pg-restart-') || fs.lstatSync(cwd).isSymbolicLink()) {
      throw Error('Refusing cleanup outside the exact temporary drill directory');
    }
    fs.rmSync(resolvedCwd, { recursive: true });
  }
}
main().then(report => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}).catch(error => {
  const report = { passed: false, blocked: true, reason: error.message, productionTouched: false };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.error(error.message); process.exitCode = 1;
});
