// Disposable browser, one public demo asset, GET/HEAD only. Does not load the
// application or its error reporter, and cannot submit production incidents.
const path=require('node:path');
const {chromium}=require('playwright');
const {writeManifest}=require('./provider-hardening-evidence');
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
  let blocked=0;
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const report={checkedAt:new Date().toISOString(),engine:'Installed headless Chromium on this Windows host',
    physicalPixelOrSafariTest:false,applicationUiReproduced:false,productionWrites:0};
  try{
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());
      if(!['GET','HEAD'].includes(req.method())||url.origin!=='https://www.myaipa.ca'||url.pathname!=='/tims-electrical-2.wav'){
        blocked++;return route.abort();
      }
      return route.continue();
    });
    await page.setContent('<button id="play">Play public demo</button><audio id="audio" preload="metadata" src="https://www.myaipa.ca/tims-electrical-2.wav?v=20260817-original-tims"></audio><script>document.getElementById("play").onclick=()=>document.getElementById("audio").play().catch(e=>window.playError=e.name);</script>');
    await page.waitForFunction(()=>document.getElementById('audio').readyState>=1||document.getElementById('audio').error,{},{timeout:20000});
    await page.locator('#play').click();
    await page.waitForFunction(()=>document.getElementById('audio').currentTime>0.2||document.getElementById('audio').error||window.playError,{},{timeout:15000});
    Object.assign(report,await page.evaluate(()=>{const a=document.getElementById('audio');return{durationSeconds:a.duration,currentTime:a.currentTime,readyState:a.readyState,networkState:a.networkState,mediaError:a.error?.code||null,playError:window.playError||'',playing:!a.paused&&a.currentTime>0.2};}));
  }catch(error){report.playing=false;report.failure=String(error.name||'Browser probe failed').slice(0,80);}
  finally{await browser.close();}
  report.blockedRequests=blocked;
  report.conclusion=report.playing?'Public asset played in this disposable browser; the affected physical-phone/application error remains unproven and is not resolved.':'Playback did not pass in this browser; preserve the incident and investigate further.';
  writeManifest(path.resolve(__dirname,'../diagnostics/operations-review/audio-browser.json'),report);
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
