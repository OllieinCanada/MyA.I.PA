// Local evidence preparation only. No environment loading, provider or application writers.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseSimulationEvidence } = require('../server/callSyncReporting');
function prepare(files) {
  const sources = [], calls = [];
  if (!Array.isArray(files) || !files.length || files.length > 100) throw Error('SIMULATION_SOURCES_REQUIRED');
  for (const file of files) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw Error('SIMULATION_SOURCE_INVALID');
    const bytes = fs.readFileSync(file), rows = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(rows) || rows.length !== 2 || new Set(rows.map(r => r.role)).size !== 2
      || rows.some(r => !['tester', 'target'].includes(r.role) || r.type !== 'vapi.websocketCall'
        || r.transportProvider !== 'vapi.websocket' || r.status !== 'ended')) throw Error('SIMULATION_SOURCE_INVALID');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    sources.push({ sha256 });
    for (const row of rows) calls.push({ callId: row.id, type: row.type, role: row.role, sourceSha256: sha256 });
  }
  const result = { schemaVersion: 1, reportingOnly: true, sources, calls };
  parseSimulationEvidence(result);
  return result;
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), out = args.find(a => a.startsWith('--out='))?.slice(6);
    const files = args.filter(a => !a.startsWith('--'));
    if (!out || args.some(a => a.startsWith('--') && !a.startsWith('--out='))) throw Error('EXPLICIT_LOCAL_OUTPUT_REQUIRED');
    const report = prepare(files);
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ reportingOnly: true, sources: report.sources.length, calls: report.calls.length, installedOnProduction: false }));
  } catch (_) { console.error('Simulation reporting evidence preparation refused; no runtime settings changed.'); process.exitCode = 1; }
}
module.exports = { prepare };
