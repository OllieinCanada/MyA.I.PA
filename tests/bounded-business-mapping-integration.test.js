const test = require('node:test'), assert = require('node:assert/strict');
test('pinned real reader/writer/fence SQL integration (not an injected-evidence substitute)', {
  skip: process.env.RUN_BOUNDED_MAPPING_INTEGRATION !== '1', timeout: 150000,
}, async t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const { spawnSync } = require('node:child_process'), { Client } = require('pg'), { PrismaClient } = require('@prisma/client');
  const { validateSqlTarget, validateCoverage, REQUIRED_CASES } = require('../scripts/compose-bounded-mapping-integration');
  const { createFixture, instrument, digest } = require('./helpers/boundedMappingIntegrationFixture');
  const { hashOperationalTarget } = require('../server/signupDecommission');
  const url = validateSqlTarget(process.env.DATABASE_URL, process.env), database = 'myaipa_adapter_drill_' + crypto.randomBytes(10).toString('hex');
  assert.match(database, /^myaipa_adapter_drill_[a-f0-9]{20}$/);
  const admin = new Client({ connectionString: url.toString() }), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-adapter-fixtures-'));
  const report = { schemaVersion: 1, ready: false, sqlMode: 'real-postgresql', providerMode: 'synthetic-no-send', cases: [], productionActions: 0 };
  let prisma, created = false;
  await admin.connect();
  try {
    assert.deepEqual((await admin.query('SELECT current_database() AS db,current_user AS usr')).rows[0], { db: 'ci', usr: 'ci' });
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    url.pathname = '/' + database; url.search = '?connection_limit=4';
    const cli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
    const r = spawnSync(process.execPath, [cli, 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: url.toString(), DISABLE_LOCAL_ENV_FILES: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
    assert.equal(r.status, 0, 'owned disposable schema initialization must succeed');
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
    async function seed(name) {
      assert.equal((await prisma.$queryRaw`SELECT current_database() AS db`)[0].db, database);
      await prisma.runtimeStore.deleteMany(); await prisma.signupAttempt.deleteMany(); await prisma.vapiBusinessMapping.deleteMany();
      await prisma.settings.deleteMany(); await prisma.business.deleteMany();
      const dir = path.join(directory, name); fs.mkdirSync(dir); const f = createFixture(dir);
      await prisma.business.create({ data: { id: 7, name: f.source.businessName, phone: f.source.ownerPhone, timezone: 'America/Toronto',
        settings: { create: { ownerPhone: f.source.ownerPhone } } } });
      await prisma.vapiBusinessMapping.createMany({ data: f.policy.preservedMappings });
      await prisma.signupAttempt.create({ data: f.attemptData });
      for (const [key, data] of f.records) await prisma.runtimeStore.create({ data: { key, data } });
      return f;
    }
    async function run(name, fn) {
      await t.test(name, { timeout: 10000 }, async () => {
        try { await fn(await seed(name)); report.cases.push({ name, status: 'passed' }); }
        catch (error) { report.cases.push({ name, status: 'failed', code: error.code || 'ASSERTION' }); throw error; }
      });
    }
    async function editor(fn) { const c = new Client({ connectionString: url.toString() }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
    const count = () => prisma.vapiBusinessMapping.count();
    await run('commit_identity_readiness', async f => {
      const before = digest({ store: f.readStore(), source: await prisma.signupAttempt.findUnique({ where: { eventKey: f.policy.sourceId } }),
        business: await prisma.business.findUnique({ where: { id: 7 }, include: { settings: true } }), mappings: await prisma.vapiBusinessMapping.findMany({ orderBy: { id: 'asc' } }) });
      const w = f.writer(prisma), plan = await w.prepare(); await w.apply(plan.planDigest, f.actor);
      assert.equal((await w.apply(plan.planDigest, f.actor)).replayed, true); assert.equal(await count(), 6);
      const after = digest({ store: f.readStore(), source: await prisma.signupAttempt.findUnique({ where: { eventKey: f.policy.sourceId } }),
        business: await prisma.business.findUnique({ where: { id: 7 }, include: { settings: true } }), mappings: await prisma.vapiBusinessMapping.findMany({ where: { id: { in: [24991,24992,24993] } }, orderBy: { id: 'asc' } }) });
      assert.equal(after, before); assert.equal((await w.inspectOutcome()).state, 'committed_exact');
    });
    for (const kind of ['source', 'context', 'receipt']) await run(kind + '_changed_before', async f => {
      const w = f.writer(prisma), plan = await w.prepare();
      if (kind === 'source') await prisma.signupAttempt.update({ where: { eventKey: f.policy.sourceId }, data: { status: 'decommissioned' } });
      else {
        const key = kind === 'context' ? f.contextKey : f.receiptKey, saved = structuredClone(f.records.get(key));
        if (kind === 'context') saved.payload.provisioning.authorizationToken = 'tampered'; else saved.status = 'uncertain';
        await prisma.runtimeStore.update({ where: { key }, data: { data: saved } });
      }
      await assert.rejects(w.apply(plan.planDigest, f.actor)); assert.equal(await count(), 3);
    });
    for (const kind of ['source_update', 'source_insert', 'context_update', 'receipt_update']) await run(kind + '_during', async f => {
      let checked = false;
      const db = instrument(prisma, { onCreate: async ({ index }) => { if (index !== 1) return;
        await editor(async c => { await c.query("SET lock_timeout='100ms'");
          const probe = kind === 'source_update' ? c.query('UPDATE "SignupAttempt" SET status=$1 WHERE "eventKey"=$2', ['decommissioned', f.policy.sourceId])
            : kind === 'source_insert' ? c.query('INSERT INTO "SignupAttempt" (id,"eventKey","publicId","statusTokenHash","businessName","ownerEmail",payload,"expiresAt","updatedAt","assignedPhone") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW(),$9)',
              [crypto.randomUUID(),'signup_'+'e'.repeat(32),crypto.randomUUID(),'f'.repeat(64),'Other synthetic signup','other@example.invalid',JSON.stringify(f.attemptData.payload),new Date('2030-01-01'),f.policy.number])
            : c.query('UPDATE "RuntimeStore" SET data=$1::jsonb WHERE key=$2', [JSON.stringify({ invalid: true }), kind === 'context_update' ? f.contextKey : f.receiptKey]);
          await assert.rejects(probe, { code: '55P03' }); checked = true;
        });
      } });
      const w = f.writer(db), plan = await w.prepare(); await w.apply(plan.planDigest, f.actor);
      assert.equal(checked, true); assert.equal(await count(), 6); assert.equal((await w.inspectOutcome()).state, 'committed_exact');
    });
    for (const kind of ['context', 'source']) await run(kind + '_lock_wait', async f => {
      const w = f.writer(prisma), plan = await w.prepare();
      await editor(async c => {
        await c.query('BEGIN');
        try {
          if (kind === 'source') await c.query('UPDATE "SignupAttempt" SET status=$1 WHERE "eventKey"=$2', ['decommissioned', f.policy.sourceId]);
          else { const changed = structuredClone(f.context); changed.payload.provisioning.authorizationToken = 'tampered';
            await c.query('UPDATE "RuntimeStore" SET data=$1::jsonb WHERE key=$2', [JSON.stringify(changed), f.contextKey]); }
          const rejected = assert.rejects(w.apply(plan.planDigest, f.actor));
          let blocked = false;
          for (let n=0;n<100;n++) { blocked = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock') AS blocked", [database])).rows[0].blocked;
            if(blocked)break; await new Promise(resolve=>setTimeout(resolve,20)); }
          assert.equal(blocked, true, 'writer must actually wait for the second SQL connection');
          await c.query('COMMIT'); await rejected;
        } finally { await c.query('ROLLBACK'); }
      });
      assert.equal(await count(), 3);
    });
    await run('lifecycle_before_external', async f => {
      let external = 0;
      const db = instrument(prisma, { onCreate: async ({ index }) => { if(index!==1)return;
        assert.throws(()=>f.fence.hold([f.policy.sourceId,f.policy.phantomId]),{code:'ASSOCIATION_REPAIR_BUSY'});
        await assert.rejects(f.fence.withRemovalGuard(f.readStore,[hashOperationalTarget({signupAttemptId:f.policy.sourceId})],async()=>{external++;}));
      } });
      const w=f.writer(db), plan=await w.prepare();await w.apply(plan.planDigest,f.actor);assert.equal(external,0);
    });
    await run('file_mutation_during', async f => {
      const before=digest(f.readStore());let refused=false;
      const db=instrument(prisma,{onCreate:async({index})=>{if(index!==1)return;
        assert.throws(()=>f.writeStore(current=>{current.source.status='changed';return current;}),{code:'ASSOCIATION_REPAIR_BUSY'});refused=true;
      }});
      const w=f.writer(db),plan=await w.prepare();await w.apply(plan.planDigest,f.actor);assert.equal(refused,true);assert.equal(digest(f.readStore()),before);
    });
    await run('atomicity_restart', async f => {
      const db=instrument(prisma,{onCreate:async({index})=>{if(index===2)throw Error('synthetic precommit failure');}});
      const w=f.writer(db),plan=await w.prepare(),other=f.writer(prisma),otherPlan=await other.prepare();
      await assert.rejects(w.apply(plan.planDigest,f.actor),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});assert.equal(await count(),3);
      await assert.rejects(f.writer(prisma).prepare(),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
      await assert.rejects(other.apply(otherPlan.planDigest,f.actor),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
      assert.equal((await w.inspectOutcome()).state,'attempt_started_unresolved');
    });
    await run('uncertain_commit', async f => {
      let lost=false;const db=instrument(prisma,{afterCommit:async({creates})=>{if(creates&&!lost){lost=true;throw Error('synthetic lost acknowledgement');}}});
      const w=f.writer(db),plan=await w.prepare();await assert.rejects(w.apply(plan.planDigest,f.actor),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
      assert.equal((await f.writer(prisma).inspectOutcome()).state,'committed_exact');assert.equal(await count(),6);
      await assert.rejects(w.apply(plan.planDigest,f.actor),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
    });
    await run('conflict_refusal',async f=>{
      await prisma.business.create({data:{id:8,name:'Other synthetic tenant',phone:'+19055550199',timezone:'UTC'}});
      await prisma.vapiBusinessMapping.create({data:{businessId:8,matchType:'assistantId',matchValue:f.policy.assistantId}});
      await assert.rejects(f.writer(prisma).prepare(),{code:'MAPPING_TARGET_CONFLICT'});assert.equal(await count(),4);
    });
    await run('override_refusal',async f=>{
      await assert.rejects(f.writer(prisma,()=>JSON.stringify({[f.policy.phoneId]:8})).prepare(),{code:'MAPPING_OVERRIDE_CONFLICT'});assert.equal(await count(),3);
    });
    report.ready=report.cases.length===REQUIRED_CASES.length&&report.cases.every(c=>c.status==='passed');
    assert.equal(report.ready,true,'every required real-reader SQL case must pass');
  } finally {
    if(prisma)await prisma.$disconnect();
    try { if(created)await admin.query(`DROP DATABASE "${database}"`);report.disposableDatabaseRemoved=true; }
    catch(error){report.ready=false;report.cleanupFailure=error.code||'CLEANUP_FAILED';throw error;}
    finally {await admin.end();if(process.env.MAPPING_INTEGRATION_REPORT)fs.writeFileSync(process.env.MAPPING_INTEGRATION_REPORT,JSON.stringify(report,null,2)+'\n');}
  }
});
