// Real tracker component + real route handlers, synthetic records only.
// Does not load project env files, server/index, credentials, background jobs or providers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const webpack = require('webpack');
const { registerTrackerRoutes, trackProgress, episodeKey } = require('../server/adminSignupTracker');
const { buildAgentTestFingerprint, buildAgentRouteFingerprint, AGENT_TEST_VERSION } = require('../server/signupAgentTesting');
const { FIELDS: OBSERVED_FIELDS } = require('../server/signupFormObservation');
const { projectSetup } = require('../server/adminSignupSetup');
const output = path.resolve('diagnostics/signup-tracker-preview');
const bundleDir = path.join(output, 'public');
const at = Date.now();
const stamp = ago => new Date(at - ago * 60000).toISOString();
function fixture(index, extra) {
  const row = { signupAttemptId: 'signup_' + String(index).repeat(32), businessId: index,
    businessName: ['','Harbour Electrical','Maple Home Services','Oak & Stone Plumbing','Lakeside Heating','Preview Paused Trial'][index],
    ownerName: ['','Morgan','Jamie','Taylor','Alex','Sam'][index], signedUpAt: stamp(50), createdAt: stamp(50), status: 'setup_started',
    serviceSummary: 'Repairs, installations and estimates', serviceArea: 'Hamilton and Burlington', businessWebsite: 'https://example.test', businessAddress: '', specializationNotes: '',
    ...extra };
  row.onboardingTracker = trackProgress({}, row, at - (extra.minutesAgo || 3) * 60000);
  return row;
}
const ready = { status: 'setup_ready', identityVerified: true, smsVerified: true, ownerPhone: '+19055550123', twilioPhoneNumber: '+12895550199', vapiPhoneNumberId: 'synthetic-phone', vapiAssistantId: 'synthetic-assistant',
  agentContentStatus: 'verified', agentContentFingerprint: 'synthetic-content', agentContentVerifiedAt: stamp(5), agentRouteBindingStatus: 'verified', agentRouteBindingMode: 'trial-gate', agentRouteBindingVerifiedAt: stamp(5),
  agentTestStatus: 'passed', agentTestVersion: AGENT_TEST_VERSION, agentTestOwnerDeliveredAt: stamp(5), agentTestCustomerDeliveredAt: stamp(5), agentTestOwnerProviderStatus: 'delivered', agentTestCustomerProviderStatus: 'delivered', smsRoutingStatus: 'healthy', subscriptionId: 'synthetic-trial', subscriptionStatus: 'trialing' };
ready.agentRouteBindingFingerprint = buildAgentRouteFingerprint({ mode: 'trial-gate', businessId: 4, phoneNumberId: ready.vapiPhoneNumberId, aiNumber: ready.twilioPhoneNumber, assistantId: ready.vapiAssistantId });
ready.agentTestFingerprint = buildAgentTestFingerprint({ assistantId: ready.vapiAssistantId, aiNumber: ready.twilioPhoneNumber, ownerPhone: ready.ownerPhone, contentFingerprint: ready.agentContentFingerprint });
let rows = [fixture(1, { status: 'setup_error', identityVerified: true, twilioPhoneNumber: '+12895550101', vapiAssistantId: 'fixture-assistant-1', minutesAgo: 14 }),
  fixture(2, { status: 'pending_verification', minutesAgo: 6 }), fixture(3, { identityVerified: true, minutesAgo: 2 }),
  fixture(4, { ...ready, minutesAgo: 5 }), fixture(5, { subscriptionStatus: 'paused', minutesAgo: 1000 })];
rows[0].onboardingStallAlertRevision = rows[0].onboardingTracker.revision; rows[0].onboardingStallAlertQueuedAt = stamp(3);
rows[0].onboardingStallAlertEpisode = episodeKey(rows[0].onboardingTracker);

async function build() {
  require('@babel/core').transformFileSync(path.join(__dirname, '../src/AdminDashboard.js'), { configFile: false, babelrc: false, presets: [require.resolve('@babel/preset-react')] });
  fs.mkdirSync(bundleDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'admin-signup-tracker-preview-entry.js'),
      output: { path: bundleDir, filename: 'tracker.js' }, optimization: { minimize: false },
      module: { rules: [{ test: /\.js$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-react')] } } },
        { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] }] },
    });
    compiler.run((error, stats) => compiler.close(closeError => error || closeError || stats.hasErrors() ? reject(error || closeError || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
}
async function main() {
  await build(); const app = express(); app.use(express.json());
  let fixtureSaves = 0, audits = 0, requests = 0, base, failReads = false, failSetupReads = false;
  app.use((req, res, next) => { requests++; if (req.method === 'GET' && ((failReads && req.path === '/api/admin/signup-tracker') || (failSetupReads && req.path.endsWith('/setup')))) return res.status(503).json({ error: 'Synthetic outage' }); next(); });
  registerTrackerRoutes({ app, requireAdmin: (_req, _res, next) => next(), isAllowedOrigin: origin => origin === base,
    list: () => rows, save: record => { const previous = rows.find(r => r.signupAttemptId === record.signupAttemptId); const next = { ...record, onboardingTracker: trackProgress(previous, record) }; rows = rows.map(r => r.signupAttemptId === next.signupAttemptId ? next : r); fixtureSaves++; return next; },
    audit: async () => { audits++; }, actorHash: () => 'synthetic-preview',
    setupEvidence: async record => projectSetup(record, { coverage: 'synthetic_exact_context_and_saved_receipts',
      context: { lockedAt: stamp(14), payload: { provisioning: { preferredAreaCode: '289', preferredRegion: 'ON' } } },
      receipts: { 'twilio-number': {status:'failed',attempts:1,dispatchStartedAt:stamp(14),failedAt:stamp(14)} },
      search: {phase:'failed',areaCode:'289',at:stamp(14),stale:true,history:[{phase:'searching',areaCode:'289',at:stamp(14)},{phase:'empty',areaCode:'289',at:stamp(14)}]},
    }),
    observations: async () => ({ rows: [{ id: 'synthetic-browser-observation', linkedAttemptId: rows[0].signupAttemptId,
      engaged: true, currentStep: 'business_details', currentStepLabel: 'Business details', lastObservedAt: stamp(14), observedAgeMs: 14 * 60000,
      coverage: { observedFields: 11, totalFields: 15, instrumentedSteps: ['trade', 'property_types', 'service_areas', 'business_details'] },
      fields: Object.entries(OBSERVED_FIELDS).map(([id,label]) => { const known = ['trade_choice','property_types','service_areas','owner_name','business_name','business_phone','business_email','street_address','city','province','postal_code'].includes(id);
        return { id,label,observedAt: known ? stamp(14) : null, currentStepVisible: known, visibleAtObservation: known ? 'visible' : 'unknown',
          presence: !known ? 'unknown' : id === 'city' ? 'blank' : 'present', required: true, interacted: known,
          validation: !known ? 'not_observed' : id === 'city' ? 'invalid' : 'valid', reasonLabel: id === 'city' ? 'Required field is blank' : 'No validation issue observed' }; }),
    }], coverage: { unavailable: false } }) });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>My AI PA signup tracker — local synthetic preview</title><style>body{margin:0;background:#e9eee8}button,input,textarea,select{font:inherit}</style></head><body><div id="root"></div><script src="/tracker.js"></script></body></html>'));
  app.use(express.static(bundleDir));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
  if (!process.argv.includes('--test')) { console.log('Synthetic preview: ' + base); return; }
  const { chromium } = require('./playwright-runtime');
  let browser, externalBlocked = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390, 320]) {
      console.log(`Checking control-room interactions at ${width}px…`);
      const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: 'reduce' }); const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : (externalBlocked++, route.abort()));
      await page.goto(base); const panel = page.getByRole('region', { name: 'Signup progress tracker' });
      await panel.getByRole('heading', { name: 'Harbour Electrical' }).waitFor();
      assert.match(await panel.locator('h2').evaluate(el=>getComputedStyle(el).fontFamily),/Georgia/,'Shared admin styling cannot replace the approved heading font');
      assert.equal(await panel.getByRole('button',{name:'Edit business info',exact:true}).first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Primary editor button remains readable inside admin shell');
      assert.equal(await panel.locator('.signup-tracker-row').count(), 3);
      assert.equal(await panel.locator('.signup-tracker-row.is-stalled').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await panel.screenshot({ path: path.join(output, `${width}-tracker.png`) });
      await panel.getByRole('button',{name:'Inspect Maple Home Services',exact:true}).click();
      await panel.getByRole('region',{name:'Setup analysis for Maple Home Services'}).waitFor();
      assert.equal(await panel.locator('.signup-control-room').count(),1,'Only the selected business has an active evidence workspace');
      await panel.getByRole('button',{name:'Inspect Harbour Electrical',exact:true}).click();
      await panel.getByLabel('Show signups', { exact: true }).selectOption('paused'); assert.equal(await panel.locator('.signup-tracker-row').count(), 1);
      await panel.getByText('Paused · no alerts', { exact: true }).waitFor();
      await panel.getByLabel('Show signups', { exact: true }).selectOption('active');
      await panel.getByLabel('Search signups').fill('Harbour'); assert.equal(await panel.locator('.signup-tracker-row').count(), 1);
      assert.equal(await panel.locator('.signup-journey-map > li').count(), 9, 'All nine sketch stages remain in reading order');
      assert.equal(await panel.locator('.journey-business .journey-fields > li').count(), 8);
      await panel.locator('.journey-business .is-blocked').filter({ hasText: 'City' }).waitFor();
      assert.equal(await panel.locator('.journey-trial').getByText('Activation not verified', { exact: true }).count(), 1);
      const setup = panel.getByRole('region', { name: 'Setup analysis for Harbour Electrical' });
      assert.equal(await setup.locator('.setup-analysis-groups > section').count(), 4);
      assert.equal(await setup.locator('.setup-analysis-groups li').count(), 18);
      const cardBounds=await setup.locator('.control-room-groups > section').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
      if(width>700){assert.ok(Math.abs(cardBounds[0].y-cardBounds[1].y)<2,'Desktop setup uses two wide columns');assert.ok(cardBounds[2].y>cardBounds[0].y,'Third card starts a new row');assert.ok(cardBounds[0].width>350,'Number card has comfortable desktop width');}
      else{assert.ok(cardBounds[1].y>cardBounds[0].y,'Phone setup cards stack, never squeeze side by side');assert.ok(Math.abs(cardBounds[1].x-cardBounds[0].x)<2);}
      assert.equal(await setup.locator('.control-room-groups li').first().evaluate(el=>getComputedStyle(el).fontSize),'14px','Checklist text is readable rather than miniature');
      await setup.locator('.control-room-groups').screenshot({path:path.join(output,`${width}-spacious-setup.png`)});
      await setup.getByRole('button', { name: 'Analyze saved setup' }).click();
      await setup.getByText('289', { exact: true }).first().waitFor();
      await setup.getByText('Stale observation: failed', { exact: true }).waitFor();
      assert.match(await setup.locator('.control-search-detail').innerText(),/Locked request: the original area-code policy is preserved/);
      const inspector=setup.getByRole('complementary',{name:'Selected step evidence'});
      for(const title of ['Start 14-day trial','Trade chosen','Property types','Service area','Business details','Service-call pricing','Final review','Human verification','14-day trial']) {
        const step=setup.getByRole('button',{name:'Inspect '+title,exact:true});await step.click();
        await inspector.getByRole('heading',{name:'Selected step: '+title,exact:true}).waitFor();assert.equal(await step.getAttribute('aria-pressed'),'true');
      }
      const keyboardStep=setup.getByRole('button',{name:'Inspect Trade chosen',exact:true});await keyboardStep.focus();await keyboardStep.press('Enter');
      await inspector.getByRole('heading',{name:'Selected step: Trade chosen',exact:true}).waitFor();
      await setup.getByRole('button',{name:'Number',exact:true}).click();await inspector.getByRole('heading',{name:'Selected step: Find and assign a new number',exact:true}).waitFor();
      assert.ok(await setup.getByRole('region',{name:'Signup event timeline'}).locator('li').count()>0);
      await setup.getByRole('button',{name:'Practice texts',exact:true}).click();
      await inspector.locator('.control-selected-checks li').filter({hasText:'Owner practice text accepted'}).waitFor();
      await setup.getByRole('button',{name:'Number',exact:true}).click();
      await setup.screenshot({ path: path.join(output, `${width}-setup-analysis.png`) });
      await panel.screenshot({path:path.join(output,`${width}-control-room.png`)});
      const priorEvents=await setup.locator('.control-room-timeline li').count();failSetupReads=true;
      await setup.getByRole('button',{name:'Analyze saved setup',exact:true}).click();
      await setup.getByRole('alert').filter({hasText:'Detailed evidence is unavailable'}).waitFor();
      assert.equal(await setup.locator('.control-room-timeline li').count(),priorEvents,'Detailed read failure preserves last-known timeline');failSetupReads=false;
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await panel.locator('.signup-tracker-row').screenshot({ path: path.join(output, `${width}-journey.png`) });
      await panel.getByRole('button', { name: 'View checkpoints' }).click(); assert.equal(await panel.locator('.signup-tracker-checkpoints > ol > li').count(), 10);
      await panel.getByRole('button', { name: 'Edit business info' }).click();
      const editor = panel.getByRole('region', { name: 'Edit saved business information' }); await editor.getByLabel('Service area', { exact: true }).fill('Hamilton, Burlington and Grimsby');
      await editor.screenshot({ path: path.join(output, `${width}-editor.png`) });
      await editor.getByRole('button', { name: 'Save business information', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'The live receptionist was not changed' }).waitFor();
      await panel.getByRole('button', { name: 'Edit business info' }).click();
      const staleEditor = panel.getByRole('region', { name: 'Edit saved business information' });
      await staleEditor.getByLabel('Business notes', { exact: true }).fill('Unsaved draft must survive a conflict');
      rows = rows.map(row => row.signupAttemptId === 'signup_' + '1'.repeat(32) ? { ...row, serviceArea: `Concurrent admin change ${width}` } : row);
      await staleEditor.getByRole('button', { name: 'Save business information', exact: true }).click();
      await staleEditor.getByRole('alert').filter({ hasText: 'Another change was saved' }).waitFor();
      try { assert.equal(await staleEditor.locator('textarea').last().inputValue(), 'Unsaved draft must survive a conflict'); }
      catch (error) { await page.screenshot({ path: path.join(output, `${width}-conflict-failure.png`), fullPage: true }); throw error; }
      failReads = true; await panel.getByRole('button', { name: 'Refresh signups' }).click();
      await panel.getByRole('alert').filter({ hasText: 'Signup updates are unavailable' }).waitFor();
      assert.equal(await panel.locator('.signup-tracker-row').count(), 1, 'Keep last-known rows when refresh fails');
      failReads = false;
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => (await window.axe.run('.signup-tracker', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, description: v.description, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})) })));
      assert.deepEqual(violations, [], `Accessibility ${width}`);
      await context.close(); console.log(`PASS ${width}px: real component/routes, filters, checkpoints, canonical fixture edit, stale-draft/error retention, no overflow or WCAG2A/AA violations.`);
    }
    const report = { passed: true, widths: [1440, 390, 320], journeyStages: 9, clickableSteps:9, keyboardStepSelection:true, timeline:true, fixtureSaves, auditEvents: audits, externalBlocked, requests, productionRequests: 0, telegramSends: 0, calls: 0, sms: 0, limitations: 'Synthetic preview, not a production deployment; existing generated dependency tree reused and full exact-lock CI remains required.' };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
