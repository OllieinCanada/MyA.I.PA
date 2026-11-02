// Metadata-only CLI. Never reads a vault or accepts key material.
const { createMetadataIO } = require('./recovery-metadata-io');
const { custodyPreflight } = require('./recovery-metadata');
const { validatePolicy, readiness } = require('./approved-recovery-policy');
function main(args = process.argv.slice(2), { metadataIO = createMetadataIO() } = {}) {
  if (args.some(arg => !/^--(metadata|out-dir|policy)=.+$/.test(arg))) throw Error('EXPLICIT_METADATA_ONLY_ARGUMENTS_REQUIRED');
  const option = name => args.filter(arg => arg.startsWith('--'+name+'='));
  if (option('metadata').length !== 1 || option('out-dir').length !== 1 || option('policy').length !== 1) throw Error('ONE_SYNTHETIC_POLICY_METADATA_FILE_AND_NEW_OUTPUT_DIRECTORY_REQUIRED');
  const plan = metadataIO.prepare({ policy: { path: option('policy')[0].slice(9), kind: 'input' },
    metadata: { path: option('metadata')[0].slice(11), kind: 'input' }, out: { path: option('out-dir')[0].slice(10), kind: 'output-dir' } });
  const policy = validatePolicy(metadataIO.readJson(plan, 'policy').value);
  const result = custodyPreflight(metadataIO.readJson(plan, 'metadata').value, { releaseCommit:policy.reviewedApplicationRelease });
  const report = { ...result, policy:readiness(policy), keysLoaded:0, vaultRequests:0, productionRequests:0, productionExecutionAllowed:false };
  const directory = metadataIO.createDirectory(plan, 'out');
  metadataIO.writeJsonInDirectory(directory, 'custody-preflight.json', report);
  console.log(JSON.stringify({metadataReady:result.metadataReady,missing:result.missing,keysLoaded:0,vaultRequests:0,productionRequests:0,productionExecutionAllowed:false}));
  return report;
}
if (require.main === module) { try { main(); } catch { console.error('Recovery custody preflight requires sanitized explicit metadata and a new output directory.');process.exitCode=1; } }
module.exports = { main };
