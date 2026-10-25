// Portable official EDB archive, linked by postgresql.org; no installer,
// Windows service registration, PATH change or administrator access.
// Publisher checksum: EnterpriseDB/edb-installers issue #746 (Oct 20, 2026).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const EXPECTED = 'e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2';
const URL = 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip';
async function prepareTools() {
  const root = path.join(process.env.LOCALAPPDATA, 'MyAIPA', 'Toolchains', 'Postgres18.6');
  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(root, 'postgresql-18.6-5-windows-x64-binaries.zip');
  function digest(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); fs.createReadStream(file).on('data', b => hash.update(b)).on('error', reject).on('end', () => resolve(hash.digest('hex'))); }); }
  if (!fs.existsSync(archive)) {
    const response = await fetch(URL, { redirect: 'error', signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw Error('Official PostgreSQL tool archive download failed');
    let size = 0;
    const limit = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 512 * 1024 * 1024 ? Error('Tool archive size limit exceeded') : null, chunk); } });
    const temporary = archive + '.partial';
    if (fs.existsSync(temporary)) throw Error('A prior partial download exists; inspect it before retrying');
    await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (await digest(temporary) !== EXPECTED) throw Error('Publisher SHA-256 mismatch; tools not extracted or executed');
    fs.renameSync(temporary, archive);
  }
  if (await digest(archive) !== EXPECTED) throw Error('Cached publisher archive checksum mismatch');
  const extraction = spawnSync('tar.exe', ['-xf', archive, '-C', root, 'pgsql/bin', 'pgsql/share', 'pgsql/lib'], { encoding: 'utf8', windowsHide: true, timeout: 180000 });
  if (extraction.error || extraction.status !== 0) throw Error('Verified PostgreSQL tool extraction failed');
  const bin = path.join(root, 'pgsql', 'bin');
  const versions = {};
  for (const name of ['pg_dump', 'pg_restore', 'initdb', 'pg_ctl', 'postgres']) {
    const result = spawnSync(path.join(bin, name + '.exe'), ['--version'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || !/18\.6/.test(result.stdout)) throw Error('PostgreSQL tool version check failed');
    versions[name] = result.stdout.trim();
  }
  return { bin, publisherArchiveSha256: EXPECTED, versions, installedAsService: false, systemPathChanged: false };
}
if (require.main === module) prepareTools().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareTools };
