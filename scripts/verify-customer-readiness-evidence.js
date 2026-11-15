'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {complete,ENGINES,WIDTHS}=require('./customer-readiness-browser-coverage');
const SOURCES=['src/index.js','src/AdminDashboard.js','src/CustomerDashboard.js',
 'src/components/CallOutcomeTimeline.js','src/components/CallOutcomeTimeline.css','src/features/calls/callOutcomeTimeline.js',
 'src/components/ReviewedAnswerDraft.js','src/components/ReviewedAnswerDraft.css','src/components/RouteBoundary.js',
 'scripts/test-customer-readiness-browser.js','scripts/customer-readiness-browser-coverage.js'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function valid(report,expected){
 return /^[a-f0-9]{40}$/.test(expected?.head||'')&&report?.sourceHead===expected.head
  &&report.completeMatrixPassed===true&&report.focusedRun===false&&report.focusedCasesPassed===true&&complete(report)
  &&report.providerActions===0&&report.productionWrites===0&&report.blockedSockets===0
  &&/^[a-f0-9]{64}$/.test(expected.manifest||'')&&report.buildManifestSha256===expected.manifest
  &&expected.hashes&&report.sourceSha256&&Object.keys(expected.hashes).length===SOURCES.length
  &&Object.keys(report.sourceSha256).length===SOURCES.length
  &&SOURCES.every(file=>/^[a-f0-9]{64}$/.test(expected.hashes[file]||'')&&report.sourceSha256[file]===expected.hashes[file]);
}
function run(){
 const head=process.env.CUSTOMER_READINESS_HEAD;
 const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
 if(git.status!==0||git.stdout.trim()!==head)throw Error('UI_SOURCE_HEAD_MISMATCH');
 const clean=spawnSync('git',['diff','--quiet','HEAD','--',...SOURCES],{windowsHide:true});
 if(clean.status!==0)throw Error('UI_SOURCE_CHANGED_AFTER_CHECKOUT');
 const directory=path.resolve('diagnostics/customer-readiness');
 const folders=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('browser-'));
 if(folders.length!==1)throw Error('EXACT_SINGLE_UI_ATTEMPT_REQUIRED');
 const output=path.join(directory,folders[0].name),report=JSON.parse(fs.readFileSync(path.join(output,'result.json')));
 const expected={head,manifest:sha(fs.readFileSync('build-candidate/asset-manifest.json')),hashes:Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(f))]))};
 if(!valid(report,expected))throw Error('UI_ARTIFACT_REFUSED');
 for(const engine of ENGINES)for(const width of WIDTHS)for(const suffix of ['timeline','answer','admin-timeline'])
  if(!fs.statSync(path.join(output,`${engine}-${width}-${suffix}.png`)).isFile())throw Error('UI_SCREENSHOT_MISSING');
 console.log(JSON.stringify({head,completeMatrixPassed:true,requiredCases:9,productionReady:false,scope:'sealed synthetic UI only'}));
}
if(require.main===module)try{run();}catch{console.error('UI_EVIDENCE_REFUSED');process.exitCode=1;}
module.exports={valid,SOURCES};
