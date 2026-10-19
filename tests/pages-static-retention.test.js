const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncRetainedStaticAssets, HISTORY_FILE } = require('../scripts/pages-static-retention');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-static-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const buildDir = path.join(root, 'build'), docsDir = path.join(root, 'docs');
  fs.mkdirSync(buildDir); fs.mkdirSync(docsDir);
  function put(base, name, text = name) { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  function build(hash) {
    fs.rmSync(buildDir, { recursive: true, force: true }); fs.mkdirSync(buildDir);
    for (const type of ['css', 'js']) put(buildDir, `static/${type}/main.${hash}.${type}`);
    return syncRetainedStaticAssets({ buildDir, docsDir });
  }
  return { root, buildDir, docsDir, put, build };
}
test('keeps two previous generations and prunes only the oldest static files', t => {
  const f = fixture(t);
  f.put(f.docsDir, 'audio/example.mp3'); f.put(f.docsDir, 'proof/index.html');
  for (const hash of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) f.build(hash);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css')), true);
  assert.deepEqual(f.build('dddddddd'), { generations: 3, retainedFiles: 6, prunedFiles: 2 });
  for (const hash of ['bbbbbbbb', 'cccccccc', 'dddddddd']) assert.equal(fs.existsSync(path.join(f.docsDir, `static/css/main.${hash}.css`)), true);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css')), false);
  assert.equal(fs.readFileSync(path.join(f.docsDir, 'audio/example.mp3'), 'utf8'), 'audio/example.mp3');
  assert.equal(fs.existsSync(path.join(f.docsDir, 'proof/index.html')), true);
});
test('adopts assets from the pre-retention deployment on first build', t => {
  const f = fixture(t); f.put(f.docsDir, 'static/css/main.aaaaaaaa.css', 'old stylesheet');
  const result = f.build('bbbbbbbb');
  assert.equal(result.generations, 2);
  assert.equal(fs.readFileSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css'), 'utf8'), 'old stylesheet');
});
test('identical rebuilds do not rotate away a previous generation', t => {
  const f = fixture(t); f.build('aaaaaaaa'); f.build('bbbbbbbb');
  for (let i = 0; i < 5; i++) assert.equal(f.build('bbbbbbbb').generations, 2);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css')), true);
});
test('verified CI artifacts retain distinct generations rather than flattening their history', t => {
  const f = fixture(t);
  for (const hash of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) f.build(hash);
  const imported = path.join(f.root, 'imported'); fs.mkdirSync(imported);
  const result = syncRetainedStaticAssets({ buildDir: f.docsDir, docsDir: imported });
  assert.equal(result.generations, 3);
  assert.equal(result.retainedFiles, 6);
  const history = JSON.parse(fs.readFileSync(path.join(imported, HISTORY_FILE), 'utf8'));
  assert.deepEqual(history.generations.map(g => g.files.length), [2, 2, 2]);
  const previousDocs = f.docsDir; f.docsDir = imported;
  syncRetainedStaticAssets({ buildDir: f.buildDir, docsDir: imported });
  assert.equal(fs.existsSync(path.join(imported, 'static/css/main.aaaaaaaa.css')), true);
  assert.equal(fs.existsSync(path.join(previousDocs, 'static/css/main.aaaaaaaa.css')), true);
});
test('invalid history fails closed before copying or pruning', t => {
  const f = fixture(t); f.build('aaaaaaaa');
  f.put(f.docsDir, HISTORY_FILE, JSON.stringify({ version: 1, generations: [{ id: 'bad', files: ['static/../../outside.txt'] }] }));
  assert.throws(() => f.build('bbbbbbbb'), /Invalid static asset history/);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css')), true);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.bbbbbbbb.css')), false);
});
test('missing build assets and invalid bounds never remove existing assets', t => {
  const f = fixture(t); f.put(f.docsDir, 'static/css/main.aaaaaaaa.css');
  assert.throws(() => syncRetainedStaticAssets(f), /missing or invalid/);
  assert.throws(() => syncRetainedStaticAssets({ ...f, keepGenerations: 1 }), /Invalid retention count/);
  assert.equal(fs.existsSync(path.join(f.docsDir, 'static/css/main.aaaaaaaa.css')), true);
});
test('Pages build, deployment staging and CI artifact preserve the retention metadata', () => {
  const source = fs.readFileSync(require.resolve('../scripts/build-pages'), 'utf8');
  assert.match(source, /syncRetainedStaticAssets\(\{ buildDir, docsDir \}\)/);
  assert.doesNotMatch(source, /removeDir\(path.join\(docsDir, "static"\)\)/);
  assert.match(fs.readFileSync(require.resolve('../scripts/import-verified-pages-build'), 'utf8'), /syncRetainedStaticAssets\(/);
  for (const file of ['scripts/deploy-pages.js', '.github/workflows/quality.yml']) assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /docs\/static-asset-history\.json/);
});
