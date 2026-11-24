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
const { registerLiveDiagnosticRoutes } = require('../server/signupLiveDiagnosticRoutes');
const {registerProviderStatusRoutes,normalizeFeed,PREFIX:STATUS_PREFIX}=require('../server/providerMaintenance');
const {signupDiagnosticError}=require('../server/signupDiagnosticError');
const {buildSignupRecoveryGuidance}=require('../server/signupRecoveryGuidance');
const output = path.resolve('diagnostics/signup-tracker-preview');
const proofSources=['src/SignupControlRoom.js','src/SignupLiveDiagnostics.js','src/SignupLiveDiagnostics.css','server/signupLiveDiagnosticRoutes.js','server/signupLiveDiagnostics.js','server/signupDiagnosticProviders.js','src/SignupFailureDetails.js','src/SignupFailureDetails.css','server/adminSignupSetup.js','server/signupPurchaseEvidence.js','scripts/preview-admin-signup-tracker.js'];
proofSources.push('src/signupControlRoomModel.js','src/SignupControlRoom.css');
proofSources.push('src/ProviderMaintenance.js','src/ProviderMaintenance.css','src/SignupBugHistory.js','src/SignupBugHistory.css','server/providerMaintenance.js','server/signupBugHistory.js','server/signupDiagnosticError.js');
proofSources.push('server/signupRecoveryGuidance.js');
proofSources.push('src/AdminSignupTracker.js','src/useSavedEvidence.js','src/features/admin/savedEvidencePolling.js','src/SavedEvidenceStatus.js','src/SavedEvidenceStatus.css','server/adminSignupTracker.js');
proofSources.push('src/SignupTrackerCompact.css','src/SignupNowOverview.js','src/SignupNowOverview.css','src/features/admin/signupNowModel.js');
const sourceHashes=()=>Object.fromEntries(proofSources.map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex')]));
const bundleDir = path.join(output, 'public');
const at = Date.now();
const stamp = ago => new Date(at - ago * 60000).toISOString();
function fixture(index, extra) {
  const row = { signupAttemptId: 'signup_' + String(index).repeat(32), businessId: index,
    businessName: ['','Harbour Electrical','Maple Home Services','Oak & Stone Plumbing','Lakeside Heating','Preview Paused Trial'][index],
    ownerName: ['','Morgan','Jamie','Taylor','Alex','Sam'][index], signedUpAt: stamp(60-index*8), createdAt: stamp(60-index*8), status: 'setup_started',
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
  const extraModules = String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
  // An isolated checkout may use the existing locked dependency tree without
  // a junction. Do not borrow an incompatible user-wide React installation.
  if (extraModules.length) {
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
    for (const name of ['react', 'react-dom']) {
      const installed = JSON.parse(fs.readFileSync(path.join(extraModules[0], name, 'package.json'), 'utf8'));
      assert.equal(installed.version, lock.packages['node_modules/' + name].version, `Preview ${name} must match the unchanged lock`);
    }
  }
  require('@babel/core').transformFileSync(path.join(__dirname, '../src/AdminDashboard.js'), { configFile: false, babelrc: false, presets: [require.resolve('@babel/preset-react')] });
  fs.mkdirSync(bundleDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'admin-signup-tracker-preview-entry.js'),
      resolve: { modules: [...extraModules, 'node_modules'] },
      output: { path: bundleDir, filename: 'tracker.js' }, optimization: { minimize: false },
      module: { rules: [{ test: /\.js$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-react')] } } },
        { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] }] },
    });
    compiler.run((error, stats) => compiler.close(closeError => error || closeError || stats.hasErrors() ? reject(error || closeError || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
}
async function main() {
  const initialSourceHashes=sourceHashes(), httpTrace=[], browserFailures=[];
  await build(); const app = express(); app.use(express.json());
  app.use((req,res,next)=>{const started=Date.now();res.on('finish',()=>{httpTrace.push({method:req.method,path:req.path,status:res.statusCode,elapsedMs:Date.now()-started});if(httpTrace.length>100)httpTrace.shift();});next();});
  let fixtureSaves = 0, audits = 0, requests = 0, base, failReads = false, failSetupReads = false, failLiveReads = false, liveReads = 0;
  let failStatusReads=false;
  const publicStatus=normalizeFeed('render',{page:{url:'https://status.render.com'},status:{indicator:'none'},components:[{id:'fixture-component',name:'Administration',status:'operational'}],incidents:[],scheduled_maintenances:[{id:'fixture-maintenance',name:'Synthetic administration maintenance',status:'scheduled',scheduled_for:'2026-11-18T02:00:00Z',scheduled_until:'2026-11-18T03:00:00Z',components:[{name:'Administration'}],incident_updates:[{created_at:stamp(1),body:'Synthetic provider report only. No application uptime is verified.'}]}]},at);
  registerProviderStatusRoutes({app,requireAdmin:(_req,_res,next)=>next(),prisma:{runtimeStore:{
    findMany:async({where})=>{if(failStatusReads)throw Error('Synthetic outage');return where.key.startsWith===STATUS_PREFIX?[{key:STATUS_PREFIX+'render',data:{...publicStatus,lastGood:publicStatus}}]:[];},
  }}});
  // Presentation fixture; real journal authentication/ownership/SQL are separate tests.
  app.get('/api/admin/signup-bugs',(req,res)=>{
    const issueId='a'.repeat(64),attemptId=rows[0].signupAttemptId;
    const events=req.query.attemptId&&req.query.attemptId!==attemptId||req.query.issueId&&req.query.issueId!==issueId?[]:[{eventRef:'b'.repeat(64),issueId,reference:'BUG-AAAAAAAA',stage:'purchase',operation:'Number purchase',diagnostic:signupDiagnosticError({code:'P2028'}),capturedAt:stamp(1),release:null,signupAttemptId:attemptId,association:'verified',confirmedSoftwareBug:false,nextAction:'Synthetic fixture only. Inspect receipts; no replay.'}];
    res.set('Cache-Control','no-store').json({readOnly:true,ready:false,events,groups:events.length?[{issueId,reference:'BUG-AAAAAAAA',operation:'Number purchase',reportsOnPage:1}]:[],hasMore:false,nextCursor:null,limitation:'Sealed synthetic presentation fixture; no provider or production evidence.'});
  });
  app.use((req, res, next) => { requests++; if (req.method === 'GET' && ((failReads && req.path === '/api/admin/signup-tracker') || (failSetupReads && req.path.endsWith('/setup')))) return res.status(503).json({ error: 'Synthetic outage' }); next(); });
  registerLiveDiagnosticRoutes({ app, requireAdmin: (_req,_res,next)=>next(), isAllowedOrigin: origin=>origin===base,
    inspect: async attemptId=>{
      liveReads++; if(failLiveReads)throw Error('Synthetic provider-read outage');
      const report={version:1,attemptId,readOnly:true,ready:false,resumeAllowed:false,checkedAt:new Date().toISOString(),
        groups:[['saved','1. Saved request and purchase outcome'],['twilio','2. Live Twilio number ownership'],
          ['make','3. Make execution and failed step'],['vapi','4. Live Vapi assistant, script and route'],['delivery','5. Existing message delivery receipts']]
          .map(([id,title])=>({id,title,checks:[{id,state:id==='saved'?'failed':id==='twilio'?'verified':'unknown',detail:id==='twilio'?'Synthetic exact number found (no real provider).':id==='make'?'EXECUTION_LINK_MISSING':'Synthetic evidence only.',source:'Sealed synthetic fixture'}]})),
      nextAction:'Resolve unknown evidence before any separately approved repair.',limitations:'Synthetic UI proof only. No provider requests or recovery.'};
      report.recovery=buildSignupRecoveryGuidance({live:report,uncertainPurchase:true});return report;
    }});
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
  let browser, lastPage, externalBlocked = 0;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    for (const width of [1440, 390, 320]) {
      // Each viewport starts with the same invented relative ages. A slow
      // earlier viewport must not turn the six-minute wait fixture into a
      // second ten-minute stall. Real threshold boundaries have unit coverage.
      rows=rows.map(record=>{
        const next={...record,onboardingTracker:trackProgress({},record,Date.now()-(record.minutesAgo||3)*60000)};
        if(record.onboardingStallAlertEpisode)next.onboardingStallAlertEpisode=episodeKey(next.onboardingTracker);
        return next;
      });
      console.log(`Checking control-room interactions at ${width}px…`);
      const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: 'reduce' }); const page = await context.newPage(); const errors = [];
      lastPage = page;
      page.on('pageerror', e => { errors.push(e.message); console.error('Synthetic preview page error:', e.message); });
      page.on('requestfailed',r=>{if(new URL(r.url()).origin===base)browserFailures.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText});});
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : (externalBlocked++, route.abort()));
      await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000}); const panel = page.getByRole('region', { name: 'Signup progress tracker' });
      await panel.getByRole('heading', { name: 'Harbour Electrical' }).waitFor();
      const beforeViewSaves=fixtureSaves,beforeViewLive=liveReads;
      const savedNames=()=>panel.locator('.signup-tracker-business h3').allTextContents();
      const overviewNames=()=>panel.locator('.signup-now-visitors strong').allTextContents();
      assert.deepEqual(await savedNames(),['Lakeside Heating','Oak & Stone Plumbing','Maple Home Services','Harbour Electrical']);
      assert.deepEqual(await overviewNames(),await savedNames(),'One view controls both overview and saved list');
      await panel.getByLabel('Sort signups',{exact:true}).selectOption('oldest');
      assert.deepEqual(await savedNames(),['Harbour Electrical','Maple Home Services','Oak & Stone Plumbing','Lakeside Heating']);
      assert.deepEqual(await overviewNames(),await savedNames());
      await panel.getByLabel('Sort signups',{exact:true}).selectOption('progress');
      assert.deepEqual(await savedNames(),['Oak & Stone Plumbing','Lakeside Heating','Maple Home Services','Harbour Electrical']);
      await panel.getByLabel('Sort signups',{exact:true}).selectOption('name');
      assert.deepEqual(await savedNames(),['Harbour Electrical','Lakeside Heating','Maple Home Services','Oak & Stone Plumbing']);
      await panel.getByLabel('Sort signups',{exact:true}).selectOption('stuck');
      assert.equal((await savedNames())[0],'Harbour Electrical');
      await panel.getByLabel('Signup start date',{exact:true}).selectOption('24h');
      assert.equal((await savedNames()).length,4);
      await panel.getByLabel('Search signups',{exact:true}).fill('not-a-fixture');
      assert.equal((await savedNames()).length,0);assert.equal((await overviewNames()).length,0);
      // Large mobile controls place Reset below the first viewport. Position
      // it explicitly before the normal trusted click; never force or retry a
      // click whose outcome is uncertain. All reset assertions remain below.
      await panel.getByRole('button',{name:'Reset view',exact:true}).scrollIntoViewIfNeeded();
      await panel.getByRole('button',{name:'Reset view',exact:true}).click();
      assert.equal(await panel.getByLabel('Sort signups',{exact:true}).inputValue(),'newest');
      assert.equal(await panel.getByLabel('Signup start date',{exact:true}).inputValue(),'all');
      assert.equal((await savedNames()).length,4);assert.equal(fixtureSaves,beforeViewSaves);assert.equal(liveReads,beforeViewLive);
      const quickViews=panel.getByRole('group',{name:'Quick signup views',exact:true});
      await panel.getByLabel('Show signups',{exact:true}).selectOption('paused');
      await panel.getByLabel('Search signups',{exact:true}).fill('not-a-fixture');
      await panel.getByLabel('Signup start date',{exact:true}).selectOption('7d');
      await quickViews.getByRole('button',{name:'Newest',exact:true}).click();
      assert.equal(await panel.getByLabel('Show signups',{exact:true}).inputValue(),'all');
      assert.equal(await panel.getByLabel('Search signups',{exact:true}).inputValue(),'');
      assert.equal(await panel.getByLabel('Signup start date',{exact:true}).inputValue(),'all');
      assert.equal(await panel.getByLabel('Sort signups',{exact:true}).inputValue(),'newest');
      assert.equal((await savedNames()).length,5,'Newest is not hidden behind old status/search/date filters');
      await quickViews.getByRole('button',{name:'Needs attention',exact:true}).click();
      assert.equal(await panel.getByLabel('Show signups',{exact:true}).inputValue(),'stalled');
      assert.equal(await panel.getByLabel('Sort signups',{exact:true}).inputValue(),'stuck');
      assert.deepEqual(await savedNames(),['Harbour Electrical']);
      await quickViews.getByRole('button',{name:'Today',exact:true}).click();
      assert.equal(await panel.getByLabel('Show signups',{exact:true}).inputValue(),'all');
      assert.equal(await panel.getByLabel('Signup start date',{exact:true}).inputValue(),'today');
      await panel.getByLabel('Sort signups',{exact:true}).selectOption('name');
      await quickViews.getByRole('button',{name:'All',exact:true}).click();
      assert.equal(await panel.getByLabel('Sort signups',{exact:true}).inputValue(),'name','All preserves the chosen sort');
      assert.equal((await savedNames()).length,5);
      assert.ok((await quickViews.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return rect.width>=48&&rect.height>=48&&parseFloat(getComputedStyle(button).fontSize)>=16;}))).every(Boolean),'Quick views retain readable labels and 48px targets');
      const statusSizes=await panel.locator('.saved-evidence-status:visible strong,.saved-evidence-status:visible span').evaluateAll(labels=>labels.map(label=>parseFloat(getComputedStyle(label).fontSize)));
      assert.ok(statusSizes.length>0&&statusSizes.every(size=>size>=16),'Actual saved-read status headings and explanations retain at least16px text');
      const pinned=panel.getByRole('region',{name:'Signup status summary'});
      await pinned.getByText('Current step',{exact:true}).waitFor();await pinned.getByText('Recorded reason',{exact:true}).waitFor();await pinned.getByText('Next safe step',{exact:true}).waitFor();
      assert.equal(await pinned.getByRole('button').count(),0,'Pinned guidance cannot execute recovery');
      assert.equal(fixtureSaves,beforeViewSaves);assert.equal(liveReads,beforeViewLive);
      if(process.argv.includes('--senior-proof-only')){
        await quickViews.getByRole('button',{name:'Needs attention',exact:true}).click();
        await panel.getByRole('button',{name:'Inspect Harbour Electrical',exact:true}).click();
        await panel.getByRole('button',{name:'Edit business info',exact:true}).click();
        const editor=panel.getByRole('region',{name:'Edit saved business information'});
        await editor.waitFor();
        await page.evaluate(()=>document.documentElement.style.fontSize='200%');
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const geometry=await editor.locator('header').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});
        assert.ok(geometry.left>=-1&&geometry.right<=geometry.width+1,'Expanded editor fits at200% text');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Full page reflows at200% text');
        await page.screenshot({path:path.join(output,`${width}-senior-expanded-text.png`)});
        await page.evaluate(()=>document.documentElement.style.fontSize='');
        await editor.getByRole('button',{name:'Close editor',exact:true}).click();
        const overview=panel.getByRole('region',{name:'Signups happening now'});
        const stepBounds=await overview.locator('.signup-now-stages button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {width:r.width,height:r.height,label:parseFloat(getComputedStyle(button.querySelector('strong')).fontSize)};}));
        assert.ok(stepBounds.length>0&&stepBounds.every(v=>v.width>=48&&v.height>=48&&v.label>=16),'Real step boxes retain readable48px targets');
        await overview.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,`${width}-senior-tracker.png`)});
        await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
        const issues=await page.evaluate(async()=>(await window.axe.run('.signup-tracker',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
        assert.deepEqual(issues,[],'Focused tracker accessibility');
        assert.deepEqual(errors,[]);assert.equal(fixtureSaves,beforeViewSaves);assert.equal(liveReads,beforeViewLive);
        await context.close();
        console.log(`PASS focused senior tracker ${width}px: presets, pinned evidence, editor200%, readable steps and axe; no writes.`);
        continue;
      }
      await panel.getByRole('button',{name:'Reset view',exact:true}).scrollIntoViewIfNeeded();
      await panel.getByRole('button',{name:'Reset view',exact:true}).click();
      await panel.getByRole('group',{name:'Find and sort signups',exact:true}).screenshot({path:path.join(output,`${width}-sorting-toolbar.png`)});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.match(await panel.innerText(),/every 5 seconds/,'The actual tracker discloses its saved-read cadence');
      const originalName=rows[2].businessName;
      rows=rows.map((r,i)=>i===2?{...r,businessName:originalName+' — live fixture update'}:r);
      await panel.getByRole('heading',{name:originalName+' — live fixture update',exact:true}).waitFor({timeout:15000});
      rows=rows.map((r,i)=>i===2?{...r,businessName:originalName}:r);
      await panel.getByRole('heading',{name:originalName,exact:true}).waitFor({timeout:15000});
      const maintenance=panel.getByRole('region',{name:'Upcoming maintenance and provider status'});
      await maintenance.getByText('Provider reports: none',{exact:true}).waitFor();await maintenance.locator('summary').filter({hasText:'Render'}).click();
      await maintenance.getByText('Synthetic administration maintenance',{exact:true}).waitFor();assert.match(await maintenance.innerText(),/Nov 17, 2026, 9:00 p.m. EST/);
      await maintenance.screenshot({path:path.join(output,`${width}-provider-maintenance.png`)});
      failStatusReads=true;await maintenance.getByRole('button',{name:'Refresh saved status'}).click();await maintenance.getByRole('alert').waitFor();assert.equal(await maintenance.getByText('Provider reports: none',{exact:true}).count(),0,'Last-known status is not an all-clear after refresh failure');
      failStatusReads=false;await maintenance.getByRole('button',{name:'Refresh saved status'}).click();await maintenance.getByText('Provider reports: none',{exact:true}).waitFor();
      const bugHistory=panel.getByRole('region',{name:'Application bug history'});await bugHistory.getByText('BUG-AAAAAAAA · Number purchase',{exact:true}).click();
      await bugHistory.getByText(/transaction expired or closed/).waitFor();await bugHistory.getByRole('button',{name:'View matching report history'}).click();await bugHistory.getByRole('button',{name:'Show all signatures again'}).waitFor();
      await bugHistory.getByText('BUG-AAAAAAAA · Number purchase',{exact:true}).click();
      await bugHistory.getByRole('button',{name:'Open signup: Harbour Electrical'}).click();await bugHistory.screenshot({path:path.join(output,`${width}-bug-history.png`)});
      // Opening a saved report deliberately selects All so older signups are
      // reachable. Restore Active before checking the original active-row count.
      await panel.getByLabel('Show signups',{exact:true}).selectOption('active');
      assert.match(await panel.locator('h2').evaluate(el=>getComputedStyle(el).fontFamily),/Georgia/,'Shared admin styling cannot replace the approved heading font');
      assert.equal(await panel.getByRole('button',{name:'Edit business info',exact:true}).first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Primary editor button remains readable inside admin shell');
      assert.equal(await panel.locator('.signup-tracker-row').count(), 3);
      assert.equal(await panel.locator('.signup-tracker-row.is-stalled').count(), 1, 'Only the invented fourteen-minute fixture is stalled at viewport start');
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
      await panel.locator('.control-earlier-journey > summary').click();
      const overview=panel.getByRole('navigation',{name:'Setup station status'});
      assert.equal(await overview.getByRole('button').count(),4);
      await overview.getByRole('button').nth(1).click();
      await panel.getByRole('heading',{name:'Expected',exact:true}).waitFor();
      await panel.getByRole('heading',{name:'Found',exact:true}).waitFor();
      await panel.getByRole('heading',{name:'Next safe step',exact:true}).waitFor();
      assert.equal(await panel.locator('.signup-journey-map > li').count(), 9, 'All nine sketch stages remain in reading order');
      assert.equal(await panel.locator('.journey-business .journey-fields > li').count(), 8);
      await panel.locator('.journey-business .is-blocked').filter({ hasText: 'City' }).waitFor();
      assert.equal(await panel.locator('.journey-trial').getByText('Activation not verified', { exact: true }).count(), 1);
      const setup = panel.getByRole('region', { name: 'Setup analysis for Harbour Electrical' });
      const livePanel=setup.getByRole('region',{name:'Read-only signup provider diagnostics'});
      const beforeLive=liveReads;assert.equal(await livePanel.getByText('No live check has been run. Saved progress remains separate.',{exact:true}).count(),1);
      assert.equal(await livePanel.getByRole('button',{name:'Run read-only checks',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Global admin styles cannot lower diagnostic-button contrast');
      assert.equal(liveReads,beforeLive,'Mounting/polling saved evidence never starts provider checks');
      await livePanel.getByRole('button',{name:'Run read-only checks',exact:true}).click();
      await livePanel.getByRole('status').filter({hasText:'Point-in-time snapshot'}).waitFor();assert.equal(liveReads,beforeLive+1);
      assert.equal(await livePanel.locator('.signup-live-group').count(),6);
      await livePanel.getByRole('region',{name:'Safe recovery steps'}).getByText('What happens next',{exact:true}).waitFor();
      const recovery=livePanel.getByRole('region',{name:'Safe recovery steps'});
      assert.equal(await recovery.locator('details[open]').count(),0,'Guidance starts compact on every viewport');
      await recovery.locator('summary').filter({hasText:'Number purchase'}).click();
      await recovery.getByText('Check the existing purchase receipt and current number ownership before any recovery. Never buy another number for an uncertain attempt.',{exact:true}).waitFor();
      await recovery.locator('summary').filter({hasText:'Number purchase'}).click();
      await livePanel.getByText('No exact Make execution is linked. A request ID or matching time is not sufficient.',{exact:true}).waitFor();
      assert.equal(await livePanel.getByRole('button',{name:'Recovery not authorized by a diagnostic check'}).isDisabled(),true);
      await livePanel.screenshot({path:path.join(output,`${width}-live-diagnostics.png`)});
      failLiveReads=true;await livePanel.getByRole('button',{name:'Run read-only checks',exact:true}).click();
      await livePanel.getByRole('alert').filter({hasText:'last-known only'}).waitFor();
      await livePanel.getByRole('status').filter({hasText:'Last-known snapshot'}).waitFor();assert.equal(await livePanel.locator('.signup-live-group').count(),6);
      await livePanel.getByText('Last-known guidance — refresh checks before taking any action.',{exact:true}).waitFor();failLiveReads=false;
      const diagnosticStateFonts=await livePanel.locator('.diagnostic-state').evaluateAll(labels=>labels.map(label=>parseFloat(getComputedStyle(label).fontSize)));
      assert.ok(diagnosticStateFonts.length>0&&diagnosticStateFonts.every(size=>size>=16),'Provider outcome labels remain at least16px');
      assert.equal(await setup.locator('.setup-analysis-groups > section').count(), 4);
      assert.equal(await setup.locator('.setup-analysis-groups li').count(), 18);
      const cardBounds=await setup.locator('.control-room-groups > section').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
      if(width>700){assert.ok(Math.abs(cardBounds[0].y-cardBounds[1].y)<2,'Desktop setup uses two wide columns');assert.ok(cardBounds[2].y>cardBounds[0].y,'Third card starts a new row');assert.ok(cardBounds[0].width>350,'Number card has comfortable desktop width');}
      else{assert.ok(cardBounds[1].y>cardBounds[0].y,'Phone setup cards stack, never squeeze side by side');assert.ok(Math.abs(cardBounds[1].x-cardBounds[0].x)<2);}
      assert.equal(await setup.locator('.control-room-groups li').first().evaluate(el=>getComputedStyle(el).fontSize),'18px','Senior-friendly checklist body text');
      await setup.locator('.control-room-groups').screenshot({path:path.join(output,`${width}-spacious-setup.png`)});
      await setup.getByRole('button', { name: 'Analyze saved setup' }).click();
      const failedPurchase = setup.getByRole('button', { name: 'Number purchase failed', exact: true });
      await failedPurchase.click();
      assert.equal(await failedPurchase.getAttribute('aria-expanded'), 'true');
      const failureDetails = setup.getByRole('region', { name: 'Number purchase failure details' });
      await failureDetails.getByText('Purchase outcome unconfirmed', { exact: true }).waitFor();
      assert.ok((await failureDetails.locator('h6,.purchase-outcome strong').evaluateAll(labels=>labels.map(label=>parseFloat(getComputedStyle(label).fontSize)))).every(size=>size>=16),'Purchase failure labels remain at least16px');
      await failureDetails.getByText('Live provider check: not performed', { exact: true }).waitFor();
      assert.equal(await failureDetails.getByRole('button', { name: 'Resume setup unavailable' }).isDisabled(), true);
      assert.equal(await failureDetails.getByRole('button', { name: 'Refresh saved receipts' }).evaluate(el=>getComputedStyle(el).color), 'rgb(255, 255, 255)', 'Admin shell must not override primary-action contrast');
      await failureDetails.screenshot({ path: path.join(output, `${width}-purchase-failure.png`) });
      failSetupReads = true;
      await failureDetails.getByRole('button', { name: 'Refresh saved receipts' }).click();
      await failureDetails.getByText(/Last-known evidence; refresh failed/).waitFor();
      assert.equal(await failureDetails.getByRole('button', { name: 'Resume setup unavailable' }).isDisabled(), true);
      failSetupReads = false;
      await failureDetails.getByRole('button', { name: 'Refresh saved receipts' }).click();
      await failureDetails.getByText('Live provider check: not performed', { exact: true }).waitFor();
      await failedPurchase.click();
      assert.equal(await failedPurchase.getAttribute('aria-expanded'), 'false');
      // The overview regression deliberately selected Assistant earlier. Restore
      // Number before asserting its station-specific saved search evidence.
      await setup.getByRole('button',{name:'Number',exact:true}).click();
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
      const detailError=setup.getByRole('alert').filter({hasText:'Detailed updates are unavailable'});
      await detailError.waitFor();assert.match(await detailError.innerText(),/HTTP 503/);assert.match(await detailError.innerText(),/last-known/);
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
      await panel.getByRole('region',{name:'Signup status summary'}).getByText('Last-known recorded reason',{exact:true}).waitFor();
      assert.equal(await panel.locator('.signup-tracker-row').count(), 1, 'Keep last-known rows when refresh fails');
      failReads = false;
      await panel.locator(':scope > .saved-evidence-status.is-connected').waitFor({timeout:15000});
      assert.equal(await panel.locator('.signup-tracker-row').count(),1,'Safe automatic read recovery retains the selected view');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => (await window.axe.run('.signup-tracker', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, description: v.description, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})) })));
      assert.deepEqual(violations, [], `Accessibility ${width}`);
      await panel.locator('.signup-tracker-totals>summary').scrollIntoViewIfNeeded();
      await panel.locator('.signup-tracker-totals>summary').click();
      await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No page-wide horizontal overflow at 200% text size, ${width}px`);
      const enlargedEditor=await panel.getByRole('region',{name:'Edit saved business information'}).evaluate(editor=>{const outer=editor.getBoundingClientRect(),header=editor.querySelector('header'),controls=[...header.children];return controls.every(control=>{const rect=control.getBoundingClientRect();return rect.left>=outer.left&&rect.right<=outer.right;});});
      assert.equal(enlargedEditor,true,'Enlarged editor header and Close control stay inside their container');
      const enlargedStatusFonts=await panel.locator('.saved-evidence-status:visible strong,.saved-evidence-status:visible span').evaluateAll(labels=>labels.map(label=>parseFloat(getComputedStyle(label).fontSize)));
      assert.ok(enlargedStatusFonts.length>0&&enlargedStatusFonts.every(size=>size>=32),'Actual status heading/explanation respond to200% text enlargement');
      const enlargedTargets=await panel.getByRole('group',{name:'Quick signup views'}).getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return rect.width>=48&&rect.height>=48;}));
      assert.ok(enlargedTargets.every(Boolean),'Enlarged quick controls stay tappable');
      await panel.getByRole('region',{name:'Signup status summary'}).screenshot({path:path.join(output,`${width}-senior-200-percent-summary.png`)});
      await page.evaluate(()=>{document.documentElement.style.fontSize='';});
      await context.close(); console.log(`PASS ${width}px: real component/routes, filters, checkpoints, canonical fixture edit, stale-draft/error retention, no overflow or WCAG2A/AA violations.`);
    }
    assert.deepEqual(sourceHashes(),initialSourceHashes,'Do not certify source files changed during browser execution');
    if(process.argv.includes('--senior-proof-only')){
      fs.writeFileSync(path.join(output,'senior-partial-report.json'),JSON.stringify({passed:true,ready:false,partial:true,scope:'synthetic-chromium-tracker-senior-only',sourceSha256:initialSourceHashes,widths:[1440,390,320],browserVersion:browser.version(),presets:true,pinnedSummary:true,editorReflow200:true,readableSteps:true,axeViolations:0,fixtureSaves,liveReads,productionRequests:0,providerTrafficAllowed:0,limitations:['Not the full canonical tracker gate','Not Firefox or WebKit','No live provider, delivery or OS isolation proof']},null,2));
      return;
    }
    const report = { passed: true, scope: 'synthetic-dashboard-only', sourceHead: process.env.SIGNUP_DIAGNOSTIC_HEAD || require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
      sourceSha256: initialSourceHashes,
      sourceState: process.env.CI ? 'ci-checkout' : 'uncommitted-local-working-tree',
      widths: [1440, 390, 320], seniorTextEnlargementPercent:200, quickViewControls:true, pinnedEvidenceSummary:true, savedProgressAutoRefresh:true, automaticReadFailureRecovery:true, liveDiagnosticUi:true, liveDiagnosticFixtureReads:liveReads, providerAdapterExercisedByBrowser:false,
      purchaseFailureInspector:true, receiptRefreshFailureRetained:true, journeyStages: 9, clickableSteps:9, keyboardStepSelection:true, timeline:true, fixtureSaves, auditEvents: audits, externalBlocked, requests, productionRequests: 0, telegramSends: 0, calls: 0, sms: 0, limitations: 'Synthetic preview, not a production deployment; full exact-lock CI remains required. Saved receipt refresh and live-diagnostic fixture responses are not live provider verification or recovery.' };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    fs.writeFileSync(path.join(output,`failure-${Date.now()}.json`),JSON.stringify({passed:false,scope:'synthetic-dashboard-only',failure:{message:String(error.message),stack:String(error.stack)},initialSourceHashes,httpTrace,browserFailures},null,2));
    console.error('Synthetic loopback trace:',JSON.stringify({httpTrace,browserFailures}));
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: path.join(output, `failure-${Date.now()}.png`), fullPage: true }).catch(() => {});
      console.error('Synthetic preview visible state:', (await lastPage.locator('body').innerText().catch(() => '')).slice(0,2000));
    }
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
