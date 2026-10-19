// Import a build downloaded from this repository's successful CI run.
// The operator must first verify the run and artifact against the intended head.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {copyDir, rootPath} = require('./_helpers');
const {syncRetainedStaticAssets} = require('./pages-static-retention');
function main() {
  const sourceArg = process.argv.find(a => a.startsWith('--artifact='))?.slice(11);
  if (!sourceArg || !process.argv.includes('--confirm=IMPORT_VERIFIED_PAGES_BUILD')) throw Error('Verified artifact path and explicit confirmation required.');
  const source = rootPath(sourceArg), docs = rootPath('docs');
  if (!source.startsWith(rootPath('diagnostics') + path.sep)) throw Error('Artifact must be in workspace diagnostics.');
  const clean = spawnSync('git', ['status', '--porcelain', '--', 'docs'], {encoding:'utf8'});
  if (clean.status !== 0 || clean.stdout.trim()) throw Error('Preserve existing docs changes before importing.');
  const files = JSON.parse(fs.readFileSync(path.join(source, 'asset-manifest.json'), 'utf8')).files;
  for (const key of ['main.js', 'main.css']) {
    const relative = String(files?.[key] || '').replace(/^\.\//, '');
    if (!/^static\/(js|css)\/main\.[a-z0-9]+\.(js|css)$/.test(relative) || !fs.existsSync(path.join(source,relative))) throw Error('Missing verified main build assets.');
  }
  for (const relative of ['index.html','404.html','proof/index.html']) if (!fs.existsSync(path.join(source,relative))) throw Error('Incomplete Pages artifact.');
  const retention = syncRetainedStaticAssets({buildDir:source,docsDir:docs});
  for (const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if (['static','static-asset-history.json'].includes(entry.name)) continue;
    if (entry.isDirectory()) copyDir(path.join(source,entry.name),path.join(docs,entry.name));
    else if (entry.isFile()) fs.copyFileSync(path.join(source,entry.name),path.join(docs,entry.name));
    else throw Error('Unexpected artifact entry type.');
  }
  console.log(JSON.stringify({imported:true,retention}));
}
try { main(); } catch(e) { console.error(e.message); process.exitCode=1; }
