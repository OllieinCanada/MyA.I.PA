const test = require('node:test'), assert = require('node:assert/strict');
const { OVERLAYS, REQUIRED_CASES, archiveArgs, validatePins, validateSqlTarget, validateCoverage } = require('../scripts/compose-bounded-mapping-integration');
const pins = require('../scripts/bounded-mapping-integration-pins.json');
test('immutable dependency provenance is valid and only public integration source is allowlisted', () => {
  validatePins(pins); assert.equal(OVERLAYS.length, 7); assert.equal(new Set(OVERLAYS).size, 7);
  assert.ok(OVERLAYS.every(p => !/diagnostics|\.env|policy|provider-state|security-evidence/.test(p)));
  for (const changed of [{ ...pins, repository: 'other' }, { ...pins, combinedTree: 'main' }, { ...pins, node: '20' }]) assert.throws(() => validatePins(changed));
});
test('SQL resources must be explicit owned loopback CI, never a provider or local ambient database', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true' };
  assert.equal(validateSqlTarget('postgresql://ci:synthetic@127.0.0.1:5432/ci', env).pathname, '/ci');
  for (const url of ['postgresql://ci:x@database.example/ci', 'postgresql://ci:x@127.0.0.1/production', 'postgresql://owner:x@127.0.0.1/ci']) assert.throws(() => validateSqlTarget(url, env));
  assert.throws(() => validateSqlTarget('postgresql://ci:x@127.0.0.1/ci', {}));
});
test('all real-reader SQL cases are required, no subset or injected-evidence report is green', () => {
  const good = { schemaVersion: 1, ready: true, providerMode: 'synthetic-no-send', sqlMode: 'real-postgresql', cases: REQUIRED_CASES.map(name => ({ name, status: 'passed' })) };
  assert.equal(validateCoverage(good), true);
  for (const bad of [{ ...good, cases: good.cases.slice(1) }, { ...good, sqlMode: 'synthetic' }, { ...good, ready: false },
    { ...good, cases: [...good.cases.slice(1), good.cases[1]] }, { ...good, cases: good.cases.map((c, i) => i ? c : { ...c, status: 'skipped' }) }]) assert.equal(validateCoverage(bad), false);
});
test('canonical Git archive preserves blob bytes even when Windows autocrlf is enabled', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-canonical-archive-'));
  const run=(args,input)=>{const r=spawnSync('git',args,{cwd,input,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  run(['init','--quiet']);const bytes='canonical\nfixture\n';const blob=run(['hash-object','-w','--stdin'],bytes);
  const tree=run(['mktree'],`100644 blob ${blob}\tfixture.txt\n`);
  const archived=spawnSync('git',['-c','core.autocrlf=true',...archiveArgs(tree)],{cwd,windowsHide:true});
  assert.equal(archived.status,0);const size=parseInt(archived.stdout.subarray(124,136).toString().replace(/\0/g,'').trim(),8);
  assert.equal(archived.stdout.subarray(512,512+size).toString(),bytes);
});
test('commit acknowledgement loss hook counts real creates even without an onCreate hook', async () => {
  const { instrument } = require('./helpers/boundedMappingIntegrationFixture');let commits=0,creates=0;
  const prisma={$transaction:async fn=>{const result=await fn({vapiBusinessMapping:{create:async()=>({id:++creates})}});commits++;return result;}};
  const wrapped=instrument(prisma,{afterCommit:async({creates:count})=>{assert.equal(count,1);throw Object.assign(Error('synthetic acknowledgement loss'),{code:'SYNTHETIC_ACK_LOST'});}});
  await assert.rejects(wrapped.$transaction(async tx=>{await tx.vapiBusinessMapping.create({data:{}});}),{code:'SYNTHETIC_ACK_LOST'});
  assert.equal(commits,1);assert.equal(creates,1);
});
