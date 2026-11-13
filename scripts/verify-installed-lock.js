// Read-only version inventory. npm ci remains responsible for tarball integrity.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function compareInstalled(lock, readPackage) {
  if (lock.lockfileVersion !== 3 || !lock.packages) throw Error('LOCK_V3_REQUIRED');
  const mismatches = [], missing = [], optionalOmissions = [];
  let verified = 0;
  for (const [location, expected] of Object.entries(lock.packages)) {
    if (!location) continue;
    if (!location.startsWith('node_modules/') || location.split('/').includes('..') || expected.link)
      throw Error('UNSUPPORTED_LOCK_LOCATION');
    const installed = readPackage(location);
    if (!installed) { (expected.optional ? optionalOmissions : missing).push(location); continue; }
    if (installed.version !== expected.version) mismatches.push({ location, expected: expected.version, installed: installed.version });
    else verified++;
  }
  return { passed: !mismatches.length && !missing.length, verified, mismatches, missing, optionalOmissions };
}
function main() {
  const root = path.resolve(process.argv.find(a => a.startsWith('--root='))?.slice(7) || path.join(__dirname, '..'));
  const bytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const result = compareInstalled(JSON.parse(bytes), location => {
    try { return JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  const report = { checkedAt: new Date().toISOString(), root,
    lockSha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...result,
    limitation: 'Compares versions at locked locations; does not independently attest package bytes, optional omission eligibility or provider readiness.' };
  const output = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
  if (!result.passed) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { compareInstalled };
