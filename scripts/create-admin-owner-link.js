// Operator-only issuer. No network, database writes, env-file loading or public
// issuance endpoint. Keep the returned URL private: it is an admin credential.
const { issueOwnerLink } = require('../server/adminOwnerLinks');

function main(argv = process.argv.slice(2), env = process.env, print = console.log) {
  if (!argv.includes('--issue')) {
    print('No link issued. Use --issue --confirm=ISSUE_ONE_USE_ADMIN_LINK [--tab=signups] with the backend credentials supplied in memory. Links expire in 10 minutes.');
    return;
  }
  if (argv.filter(arg => arg === '--issue').length !== 1
    || argv.filter(arg => arg === '--confirm=ISSUE_ONE_USE_ADMIN_LINK').length !== 1
    || argv.filter(arg => arg.startsWith('--tab=')).length > 1
    || argv.some(arg => arg !== '--issue' && arg !== '--confirm=ISSUE_ONE_USE_ADMIN_LINK' && !arg.startsWith('--tab='))) {
    throw new Error('Invalid arguments. Explicit owner-link issuance confirmation is required.');
  }
  const result = issueOwnerLink({ config: { adminPassword: env.ADMIN_PASSWORD,
    sessionSecret: env.ADMIN_SESSION_SECRET, totpEnabled: Boolean(String(env.ADMIN_TOTP_SECRET || '').trim()) },
  tab: argv.find(arg => arg.startsWith('--tab='))?.slice(6) || 'signups' });
  print(JSON.stringify({ ...result, oneUse: true, privateAdminCredential: true }));
}

if (require.main === module) {
  try { main(); } catch { console.error('Owner sign-in link could not be issued. Check the operator options and backend configuration; no credentials were printed.'); process.exitCode = 1; }
}
module.exports = { main };
