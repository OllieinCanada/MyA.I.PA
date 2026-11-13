const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installNetworkIsolation, installSlowImageDelay } = require('../scripts/browser-quality-network');
test('real Playwright route ordering: delayed requests still traverse the method/origin guard',
  { skip: process.env.RUN_BROWSER_NETWORK_TEST !== '1' ? 'Requires explicit isolated browser run' : false, timeout: 45000 }, async () => {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push({ method: req.method, path: req.url });
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Isolated routing fixture</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const foreignServer = http.createServer(server.listeners('request')[0]);
    await new Promise(resolve => foreignServer.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, foreign = `http://127.0.0.1:${foreignServer.address().port}`;
    let browser;
    try {
      console.log('Launching isolated routing browser');
      browser = await require('../scripts/playwright-runtime').chromium.launch({ headless: true, timeout: 15000 });
      console.log('Isolated routing browser launched');
      for (const legacyContinue of [true, false]) {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const evidence = { unexpectedWrites: [], blockedSockets: 0 };
          await installNetworkIsolation(context, origin, evidence);
          if (legacyContinue) await context.route('**/trade-heroes/**', route => route.continue());
          else await installSlowImageDelay(context, 1);
          const page = await context.newPage(); page.setDefaultTimeout(15000);
          await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 }); hits.length = 0;
          console.log(`Routing fixture loaded: ${legacyContinue ? 'legacy bypass control' : 'guarded fallback'}`);
          await page.evaluate(async ({ origin, foreign }) => {
            for (const [url, method] of [[origin + '/trade-heroes/write.png', 'POST'], [foreign + '/trade-heroes/foreign.png', 'GET'],
              [origin + '/trade-heroes/allowed.png', 'GET']]) await fetch(url, { method, mode: 'no-cors', signal: AbortSignal.timeout(5000) }).catch(() => {});
          }, { origin, foreign });
          assert.equal(hits.some(row => row.path === '/trade-heroes/write.png' && row.method === 'POST'), legacyContinue);
          assert.equal(hits.some(row => row.path === '/trade-heroes/foreign.png'), legacyContinue);
          assert.equal(hits.some(row => row.path === '/trade-heroes/allowed.png'), true);
          assert.equal(evidence.unexpectedWrites.length, legacyContinue ? 0 : 1);
          if (!legacyContinue) assert.equal(evidence.offline_external, 1);
        } finally { await context.close(); }
      }
    } finally {
      if (browser) await browser.close();
      for (const item of [server, foreignServer]) item.closeAllConnections();
      await Promise.all([server, foreignServer].map(item => new Promise(resolve => item.close(resolve))));
    }
  });
