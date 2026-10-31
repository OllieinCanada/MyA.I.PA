// Metadata-only preparation. It never creates/downloads an export or starts a database.
const fs = require('node:fs');
const path = require('node:path');
const { createPlan, validatePlan } = require('./recovery-execution-plan');
const { newManifest } = require('./provider-hardening-evidence');
function main(args = process.argv.slice(2)) {
  const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (args.some(arg => !/^--(metadata|out-dir|plan)=.+/.test(arg))) throw Error('Only --metadata, --out-dir or --plan are supported; this command cannot execute recovery');
  if (value('plan')) {
    const plan = validatePlan(JSON.parse(fs.readFileSync(value('plan'), 'utf8')));
    console.log(JSON.stringify({ valid: true, executionId: plan.executionId, executionAuthorized: false, networkRequests: 0 }));
    return;
  }
  if (!value('metadata')) throw Error('Provide --metadata containing exact release/database/service/export identity and an explicit snapshot age policy');
  const plan = createPlan(JSON.parse(fs.readFileSync(value('metadata'), 'utf8')));
  if (value('out-dir')) {
    const directory = path.resolve(value('out-dir'));
    // Exclusive directory creation preserves old windows, receipts and evidence.
    fs.mkdirSync(directory, { mode: 0o700 });
    const manifest = { ...newManifest(plan.releaseCommit, plan.createdAt), executionId: plan.executionId };
    for (const [name, body] of [['plan.json', plan], ['execution.json', manifest]]) {
      fs.writeFileSync(path.join(directory, name), JSON.stringify(body, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
  }
  console.log(JSON.stringify({ plan, networkRequests: 0, exportRequests: 0, downloads: 0, restores: 0 }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error('Recovery preparation blocked: ' + error.message); process.exitCode = 1; } }
module.exports = { main };
