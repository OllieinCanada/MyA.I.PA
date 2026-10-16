// Import a build downloaded from this repository's successful CI run.
// The operator must first verify the run and artifact against the intended head.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {copyDir, rootPath} = require('./_helpers');
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
  const tracked = spawnSync('git', ['ls-files', '-z', 'docs/static'], {encoding:'utf8'});
  if (tracked.status !== 0) throw Error('Cannot identify old generated files.');
  const obsolete = tracked.stdout.split('\0').filter(Boolean).map(p => path.resolve(rootPath(),p)).filter(p => {
    if (!p.startsWith(path.join(docs,'static')+path.sep)) throw Error('Generated target escaped docs/static.');
    return !fs.existsSync(path.join(source,path.relative(docs,p)));
  });
  copyDir(source,docs);
  for (const target of obsolete) fs.unlinkSync(target); // exact tracked files, never recursive
  console.log(JSON.stringify({imported:true,obsoleteGeneratedFilesRemoved:obsolete.length,recoverable:'Tracked old files remain available in Git.'}));
}
try { main(); } catch(e) { console.error(e.message); process.exitCode=1; }
