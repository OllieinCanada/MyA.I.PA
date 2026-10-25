// One logical backup artifact on the existing database; no customer/business
// data mutations, network-rule changes, new database or service purchases.
const fs = require('node:fs');
const path = require('node:path');
const { readRenderCredentials } = require('./run-with-render-env');
const { writeManifest, assertFreshHealth } = require('./provider-hardening-evidence');
const DATABASE = 'dpg-d924vjq8qa3s73crd29g-a';
async function main() {
  const directory = path.resolve(__dirname, '../diagnostics/provider-hardening');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8'));
  assertFreshHealth(manifest);
  const credentials = readRenderCredentials();
  const endpoint = credentials.host + '/postgres/' + DATABASE + '/export';
  async function request(method) {
    const response = await fetch(endpoint, { method, headers: { Authorization: 'Bearer ' + credentials.key, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw Error('Export metadata HTTP ' + response.status);
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }
  const receiptPath = path.join(directory, 'backup-export-request.json');
  const existing = await request('GET');
  if (!Array.isArray(existing.body)) throw Error('Export inventory shape unconfirmed');
  let receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
  if (!existing.body.length && !receipt) {
    if (!process.argv.includes('--create-logical-export')) throw Error('No existing logical export; creation not selected');
    receipt = { status: 'request_started_outcome_unconfirmed', databaseId: DATABASE, startedAt: new Date().toISOString(),
      productionBusinessWrites: 0, backupExportRequests: 1 };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
    // Never repeat this POST after a timeout or uncertain response.
    const created = await request('POST');
    receipt = { ...receipt, status: 'request_accepted', acceptedAt: new Date().toISOString(), httpStatus: created.status,
      responseFieldNames: Object.keys(created.body || {}) };
    writeManifest(receiptPath, receipt);
  }
  const result = await request('GET');
  const report = { checkedAt: new Date().toISOString(), databaseId: DATABASE,
    requestReceipt: receipt || { status: 'existing_export_reused_no_request' },
    exports: result.body.map(row => {
      const item = row.export || row.postgresExport || row;
      return { wrapperFieldNames: Object.keys(row), fieldNames: Object.keys(item),
        id: item.id, status: item.status, createdAt: item.createdAt, finishedAt: item.finishedAt,
        downloadAvailable: Boolean(item.url || item.downloadUrl || item.exportUrl) };
    }), downloadUrlsPrinted: false };
  writeManifest(path.join(directory, 'backup-export-inventory.json'), report);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => { console.error('Export preparation stopped: ' + error.message + '; uncertain requests are never repeated.'); process.exitCode = 1; });
