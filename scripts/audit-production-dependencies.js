const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveRunCommand, rootPath } = require('./_helpers');

function main() {
  const invocation = resolveRunCommand('npm', ['audit', '--omit=dev', '--json']);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: rootPath(), env: process.env, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024,
  });
  let audit;
  try { audit = JSON.parse(result.stdout); } catch (_) {
    throw new Error('Production dependency audit did not return a valid report.');
  }
  const reportPath = rootPath('diagnostics', 'shipping-readiness', 'production-dependencies.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), audit }, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, vulnerabilities: audit.metadata?.vulnerabilities || null }));
  // Preserve the existing CI policy: any reported production vulnerability
  // fails, including moderate findings. Network/registry failures fail closed.
  if (result.error || result.status !== 0 || audit.error || !audit.metadata?.vulnerabilities) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
