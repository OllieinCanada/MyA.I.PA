// Actual built homepage in disposable browsers. All external traffic is
// blocked or mocked; synthetic error reports never reach production.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const build = path.resolve(root, process.env.DEMO_AUDIO_BUILD_DIR || 'docs');
const player = process.argv.find(arg => arg.startsWith('--player='))?.slice(9) || 'hero';
assert.ok(['hero', 'scenario'].includes(player));
const selectors = player === 'scenario' ? {
  control: '#tims-homepage-demo .tims-recording-controls button', element: '#tims-homepage-demo audio.tims-recording-audio',
  panel: '#tims-homepage-demo .tims-scenario-recording', feedback: '#recording-feedback-new-installation', duration:85.22, seek:40,
} : {
  control: '.simple-carousel-header button', element: '.simple-proof-carousel audio',
  panel: '.simple-proof-carousel', feedback: '#hero-audio-feedback', duration:133, seek:64,
};
const output = path.join(root, 'diagnostics/call-sync-audio-repair');
let origin;
const engines = { chromium, firefox, webkit };
const sizes = [{ name: 'phone', width: 412, height: 915 }, { name: 'tablet', width: 820, height: 1180 }, { name: 'desktop', width: 1365, height: 900 }];

async function startMediaFixture() {
  const fixture = { current: null };
  // WebKit's native media loader can bypass Playwright's page routes. Serve
  // audio on a real loopback socket so every engine tests the same bytes,
  // range responses and intentional failures, without external traffic.
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const match = /^\/(?:tims-electrical-2|audio\/tims-electrical\/new-installation)\.(mp3|wav)$/.exec(pathname);
    if (req.method !== 'GET' || !match || !fixture.current) {
      res.writeHead(404).end(); return;
    }
    const extension = match[1], current = fixture.current;
    current.requests.push(extension);
    const headers = { 'Content-Type': extension === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    // Leave the primary request pending: recovery must also work when the
    // network never supplies bytes and the browser emits no media error.
    if (current.broken && current.mode === 'stalled' && extension === 'mp3') return;
    if (current.broken && (current.mode === 'exhausted' || extension === 'mp3')) {
      res.writeHead(200, headers).end('deliberately invalid synthetic audio'); return;
    }
    const bytes = fs.readFileSync(path.join(build, pathname));
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(bytes.length - 1, range[2] ? Number(range[2]) : bytes.length - 1);
      if (start > end || start >= bytes.length) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}` }).end(); return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Content-Length': end - start + 1 }).end(bytes.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': bytes.length }).end(bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { ...fixture, server, setCurrent(value) { fixture.current = value; } };
}

async function scenario(browser, engine, viewport, mode, fixture) {
  console.log(JSON.stringify({ engine, viewport: viewport.name, mode, stage: 'starting' }));
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page.setDefaultTimeout(20000);
  let broken = mode !== 'normal', blocked = 0;
  const requests = [], reports = [];
  fixture.setCurrent({ mode, requests, get broken() { return broken; } });
  try {
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/client-errors' && request.method() === 'POST') {
        const report = request.postDataJSON();
        if (report.component === 'audio') reports.push(report);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"mock":true}' });
      }
      if (url.origin !== origin || request.method() !== 'GET') { blocked++; return route.abort(); }
      const file = path.resolve(build, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, ''));
      if (!file.startsWith(build + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'Not found' });
      const audio = /\/(?:tims-electrical-2|audio\/tims-electrical\/new-installation)\.(mp3|wav)$/.exec(url.pathname);
      if (audio) return route.continue();
      return route.fulfill({ path: file });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    console.log(JSON.stringify({ engine, mode, stage: 'homepage loaded' }));
    const control = page.locator(selectors.control);
    await control.waitFor();
    const element = page.locator(selectors.element);
    await element.evaluate(audio => {
      window.__fixtureMediaErrors = [];
      audio.addEventListener('error', () => window.__fixtureMediaErrors.push({
        code: audio.error?.code || null,
        message: audio.error?.message || '',
        source: audio.currentSrc ? new URL(audio.currentSrc).pathname : '',
      }));
    });
    assert.equal(await element.getAttribute('preload'), 'none');
    assert.equal(await element.evaluate(audio => audio.paused), true);
    assert.equal(requests.length, 0, 'no media download before user interaction');
    // React can show retry feedback before the asynchronous report reaches
    // the route handler. Await the mocked delivery, not just the UI render.
    const terminalReport = mode === 'exhausted' ? page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/client-errors'
      && response.request().method() === 'POST' && response.status() === 200)
      .then(() => null, error => error) : null;
    const playbackStartedAt = Date.now();
    await control.click();
    if (mode === 'exhausted') {
      await page.locator(selectors.feedback).waitFor();
      await page.waitForFunction(selector => {
        const button = document.querySelector(selector);
        return /Hear Live Call|Retry recorded scenario call/.test(button.getAttribute('aria-label') || button.textContent);
      }, selectors.control);
      const reportFailure = await terminalReport;
      if (reportFailure) throw reportFailure;
      assert.deepEqual([...new Set(requests)], ['mp3', 'wav']);
      assert.equal(reports.length, 1, 'one terminal audio report, not one for each recovered source');
      assert.equal(await element.evaluate(audio => audio.paused), true,
        'a terminal failure stops the element so one tap can retry');
      await page.locator(selectors.panel).screenshot({ path: path.join(output, `${player}-${engine}-phone-retry.png`) });
      broken = false;
      await control.click();
    }
    await page.waitForFunction(selector => { const audio = document.querySelector(selector); return !audio.paused && audio.currentTime > 0.2; }, selectors.element);
    console.log(JSON.stringify({ engine, mode, stage: 'audio advancing' }));
    const playback = await element.evaluate(audio => ({ currentSrc: new URL(audio.currentSrc).pathname, currentTime: audio.currentTime,
      duration: audio.duration, error: audio.error?.code || null, readyState: audio.readyState }));
    assert.equal(playback.error, null);
    assert.ok(Math.abs(playback.duration - selectors.duration) < 0.15, 'the original call duration is preserved');
    assert.match(playback.currentSrc, ['fallback', 'stalled'].includes(mode) ? /\.wav$/ : /\.mp3$/);
    if (mode === 'stalled') {
      assert.ok(Date.now() - playbackStartedAt >= 14000, 'the primary really stalled before bounded fallback');
      assert.deepEqual([...new Set(requests)], ['mp3', 'wav']);
    }
    if (mode !== 'exhausted') assert.equal(reports.length, 0, 'a successful fallback is not an outage');
    await element.evaluate((audio, seconds) => { audio.currentTime = seconds; }, selectors.seek);
    await page.waitForFunction(({selector,seconds}) => document.querySelector(selector).currentTime > seconds + 0.1,
      {selector:selectors.element, seconds:selectors.seek});
    await control.click();
    assert.equal(await element.evaluate(audio => audio.paused), true);
    assert.match((await control.getAttribute('aria-label')) || (await control.textContent()), /Hear Live Call|Play recorded scenario call/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (mode === 'normal') await page.locator(selectors.panel).screenshot({ path: path.join(output, `${player}-${engine}-${viewport.name}-player.png`) });
    console.log(JSON.stringify({ engine, viewport: viewport.name, mode, stage: 'passed' }));
    return { engine, viewport: viewport.name, mode, playback, audioRequests: requests, mockAudioReports: reports.length,
      externalRequestsBlocked: blocked, physicalDevice: false, passed: true };
  } catch (error) {
    // Preserve a failed engine's actual media state instead of hiding it in
    // an empty results array. Only this local synthetic page is inspected.
    error.audioDiagnostic = {
      engine, viewport: viewport.name, mode, audioRequests: requests,
      mockAudioReports: reports.length,
      media: await page.evaluate(selector => {
        const audio = document.querySelector(selector);
        return audio ? { paused: audio.paused, currentTime: audio.currentTime,
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          readyState: audio.readyState, networkState: audio.networkState,
          errorCode: audio.error?.code || null,
          errorMessage: audio.error?.message || '',
          sourceErrors: window.__fixtureMediaErrors || [],
          source: audio.currentSrc ? new URL(audio.currentSrc).pathname : '' } : null;
      }, selectors.element).catch(() => null),
    };
    throw error;
  } finally { await page.close(); }
}

async function main() {
  require('./prepare-public-demo-audio').check();
  require('./prepare-scenario-demo-audio').check();
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  let failure = null;
  const fixture = await startMediaFixture();
  try {
    const selectedEngines = (process.argv.find(arg => arg.startsWith('--engines='))?.slice(10) || 'chromium,firefox,webkit').split(',');
    const selectedModes = (process.argv.find(arg => arg.startsWith('--modes='))?.slice(8) || 'normal,fallback,exhausted,stalled').split(',');
    const selectedSizes = (process.argv.find(arg => arg.startsWith('--sizes='))?.slice(8) || 'phone,tablet,desktop').split(',');
    assert.ok(selectedEngines.every(engine => Object.hasOwn(engines, engine)));
    assert.ok(selectedModes.every(mode => ['normal', 'fallback', 'exhausted', 'stalled'].includes(mode)));
    assert.ok(selectedSizes.every(size => sizes.some(item => item.name === size)));
    for (const engine of selectedEngines) {
      const type = engines[engine];
      console.log(JSON.stringify({ engine, stage: 'launching' }));
      const browser = await type.launch({ headless: true, timeout: 15000,
        executablePath: engine === 'chromium' ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined : undefined });
      try {
        if (selectedModes.includes('normal')) for (const viewport of sizes.filter(item => selectedSizes.includes(item.name))) results.push(await scenario(browser, engine, viewport, 'normal', fixture));
        for (const mode of selectedModes.filter(item => item !== 'normal')) results.push(await scenario(browser, engine, sizes[0], mode, fixture));
      } finally { await browser.close(); }
    }
  } catch (error) {
    failure = { message: error.message, ...(error.audioDiagnostic || {}) };
    console.error(JSON.stringify({ fixtureFailure: failure }));
    throw error;
  } finally {
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
    const suffix = (process.argv.find(arg => arg.startsWith('--report='))?.slice(9) || (player === 'hero' ? 'browser' : 'scenario-browser')).replace(/[^a-z0-9_-]/gi, '');
    fs.writeFileSync(path.join(output, suffix + '.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
      productionWrites: 0, player, physicalDeviceProof: false, passed: failure === null,
      failure, results }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: results.length, results, productionWrites: 0, physicalDeviceProof: false }, null, 2));
}
if (require.main === module) {
  const deadline = setTimeout(() => { console.error('Audio browser test exceeded its 180-second bound; not a pass.'); process.exit(124); }, 180000);
  main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
}
