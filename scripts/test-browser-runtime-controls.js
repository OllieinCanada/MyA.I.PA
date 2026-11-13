// No application code, external network, provider calls or production fixtures.
const http = require('node:http');
const fs = require('node:fs');
const { firefox } = require('./playwright-runtime');
const { installNetworkIsolation } = require('./browser-quality-network');
const bounded = (work, ms) => Promise.race([work, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('control cleanup timeout')), ms); timer.unref(); })]);
async function main() {
  const output = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (!output) throw Error('Explicit new evidence path required');
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><h1>Loopback control</h1>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const report = { checkedAt: new Date().toISOString(), applicationCodeLoaded: false, productionRequests: 0, cases: [] };
  let browser;
  try {
    browser = await firefox.launch({ headless: true }); report.browserVersion = browser.version();
    for (const isolated of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      if (isolated) await installNetworkIsolation(context, baseUrl, { unexpectedWrites: [], blockedSockets: 0 });
      const page = await context.newPage(), started = Date.now();
      try { await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        report.cases.push({ isolated, passed: (await page.locator('h1').textContent()) === 'Loopback control', elapsedMs: Date.now() - started });
      } catch (error) { report.cases.push({ isolated, passed: false, elapsedMs: Date.now() - started, error: String(error.message).slice(0, 250) }); }
      finally { await bounded(context.close(), 15000).catch(error => { report.cleanupError = error.message; }); }
    }
  } catch (error) { report.error = String(error.message).slice(0, 250); }
  finally {
    if (browser) await bounded(browser.close(), 15000).catch(error => { report.cleanupError = error.message; });
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
    if (report.cases.length !== 2 || report.cases.some(row => !row.passed)) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
