// Local-only deployment simulation. No customer/provider requests or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const { syncRetainedStaticAssets } = require('./pages-static-retention');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-static-browser-'));
  const buildDir = path.join(temporary, 'build'), docsDir = path.join(temporary, 'docs');
  const output = path.resolve('diagnostics/static-retention'); fs.mkdirSync(output, { recursive: true });
  const pages = new Map(); let server, browser;
  function put(root, name, body) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
  function deploy(hash) {
    if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
    put(buildDir, `static/css/main.${hash}.css`, '.fixture-banner{color:rgb(0,128,0);font-size:28px}');
    put(buildDir, `static/js/main.${hash}.js`, `window.assetRelease='${hash}';document.getElementById('release').textContent='${hash}';function loadLazy(){const s=document.createElement('script');s.src='/static/js/lazy.${hash}.js';document.head.append(s);}`);
    put(buildDir, `static/js/lazy.${hash}.js`, `window.lazyRelease='${hash}';`);
    pages.set('/saved/' + hash, `<!doctype html><link rel="stylesheet" href="/static/css/main.${hash}.css"><p class="fixture-banner" id="release">Loading</p><button onclick="loadLazy()">Load saved feature</button><script src="/static/js/main.${hash}.js"></script>`);
    return syncRetainedStaticAssets({ buildDir, docsDir });
  }
  try {
    deploy('aaaaaaaa');
    server = http.createServer((req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pages.has(pathname)) { res.setHeader('content-type', 'text/html'); return res.end(pages.get(pathname)); }
      const file = path.resolve(docsDir, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(docsDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const bundled = 'C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
    browser = await chromium.launch({ headless: true, timeout: 20000, executablePath: fs.existsSync(bundled) ? bundled : undefined, args: ['--disable-gpu','--disable-dev-shm-usage'] });
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    deploy('bbbbbbbb'); deploy('cccccccc');
    for (const hash of ['aaaaaaaa','bbbbbbbb','cccccccc']) {
      await page.goto(base + '/saved/' + hash);
      assert.equal(await page.locator('#release').textContent(), hash);
      assert.equal(await page.locator('#release').evaluate(e => getComputedStyle(e).color), 'rgb(0, 128, 0)');
      await page.getByRole('button', {name:'Load saved feature'}).click();
      await page.waitForFunction(expected => window.lazyRelease === expected, hash);
    }
    await page.screenshot({ path: path.join(output, 'retained-page.png') });
    const fourth = deploy('dddddddd'); assert.equal(fourth.generations, 3);
    for (const extension of ['css','js']) assert.equal((await fetch(`${base}/static/${extension}/main.aaaaaaaa.${extension}`)).status,404);
    for (const hash of ['bbbbbbbb','cccccccc','dddddddd']) {
      await page.goto(base + '/saved/' + hash);
      assert.equal(await page.locator('#release').textContent(),hash);
      await page.getByRole('button',{name:'Load saved feature'}).click();
      await page.waitForFunction(expected => window.lazyRelease === expected, hash);
    }
    const report = { passed:true, distinctDeployments:4, retainedGenerations:3, olderPagesLoadCssAndJavaScript:true, olderPagesLoadLazyFeatures:true, oldestAssetsPruned:true, productionRequests:0 };
    fs.writeFileSync(path.join(output,'browser-drill.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'myaipa-static-browser-')) throw Error('Unexpected temporary cleanup target');
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
