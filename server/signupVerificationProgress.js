function verificationProgressMarkup() {
  return `<section id="signup-progress-panel" aria-label="Your setup progress">
    <style>
      #signup-progress-panel{margin:24px 0;padding:20px;border:1px solid #bfdbfe;border-radius:20px;background:#eff6ff}
      #signup-progress-label{margin:0 0 12px;font-size:16px;font-weight:700;color:#1e40af}
      .setup-track{height:10px;background:#dbeafe;border-radius:20px;overflow:hidden}
      #signup-progress-fill{height:100%;width:8%;background:#2563eb;border-radius:20px;transition:width .4s ease;position:relative;overflow:hidden}
      #signup-progress-panel[data-active="true"] #signup-progress-fill:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff90,transparent);animation:setup-working 1.6s linear infinite}
      #signup-progress-steps{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:10px}
      #signup-progress-steps li{display:flex;gap:10px;align-items:center;font-size:15px;color:#475569}
      #signup-progress-steps li:before{content:"○";font-weight:900;color:#64748b}
      #signup-progress-steps li[data-status="done"]:before{content:"✓";color:#15803d}
      #signup-progress-steps li[data-status="current"]{font-weight:700;color:#1d4ed8}
      #signup-progress-steps li[data-status="current"]:before{content:"●";color:#2563eb}
      #signup-progress-note{font-size:14px;line-height:1.5;margin:14px 0 0}
      @keyframes setup-working{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
      @media(prefers-reduced-motion:reduce){#signup-progress-panel *{animation:none!important;transition:none!important}}
    </style>
    <p id="signup-progress-label" role="status" aria-live="polite">Checking your phone verification…</p>
    <div class="setup-track" role="progressbar" aria-label="Signup setup" aria-valuemin="0" aria-valuemax="3" aria-valuetext="Checking phone verification" id="signup-progress-bar"><div id="signup-progress-fill"></div></div>
    <ol id="signup-progress-steps"><li data-status="current">Phone verified</li><li>Preparing your assistant</li><li>Your number is ready</li></ol>
    <p id="signup-progress-note">This page updates automatically. You can reopen the same text link—no need to sign up again.</p>
  </section>`;
}

// Read-only progress refreshes. Never resend verification or replay provisioning.
function verificationProgressScript(url, { awaitConfirmation = false } = {}) {
  return `<script>(()=>{
    const endpoint=${JSON.stringify(url).replace(/</g,'\\u003c')};
    let busy=false,finished=false,started=${!awaitConfirmation},seenStatus=false,confirmed=${!awaitConfirmation};
    const panel=document.getElementById("signup-progress-panel"),bar=document.getElementById("signup-progress-bar"),fill=document.getElementById("signup-progress-fill"),label=document.getElementById("signup-progress-label");
    function show(s){
      if(!panel)return;
      const ready=s.state==="ready"&&/^\\+1\\d{10}$/.test(s.assignedPhone||"");
      const paused=["needs_attention","closed","connection_lost","expired","final_checks"].includes(s.state);
      const verifying=s.state==="verification_required"||s.state==="confirming";
      const step=ready?3:verifying||!confirmed?0:1;
      const text=ready?"Your number is ready":s.state==="connection_lost"?"Reconnecting—your signup is saved":s.state==="expired"?"Progress link expired—contact support":s.state==="closed"?"This signup is closed":s.state==="needs_attention"?"Setup needs attention":s.state==="final_checks"?"Waiting for a setup review":verifying?"Checking your phone verification…":"Step 2 of 3 · Preparing your assistant";
      panel.dataset.active=String(!paused&&!ready);fill.style.width=(ready?100:step===0?8:33)+"%";
      label.textContent=text;bar.setAttribute("aria-valuetext",text);
      if(ready)bar.setAttribute("aria-valuenow","3");else bar.removeAttribute("aria-valuenow");
      panel.querySelectorAll("li").forEach((item,i)=>{item.dataset.status=ready||i<step?"done":i===step?"current":"pending";});
    }
    show({state:started?"processing":"confirming"});
    async function refresh(){
      if(!started||busy||finished||document.visibilityState!=="visible")return;
      busy=true;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      try{
        const r=await fetch(endpoint,{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal});
        if(!r.ok){const form=document.querySelector("form");if(r.status===410&&!seenStatus&&form&&!form.hidden)return;if(r.status===401||r.status===410){finished=true;show({state:"expired"});document.getElementById("verification-description").textContent="This link expired. Contact support—do not sign up again.";}else show({state:"connection_lost"});return;}
        const data=await r.json(),s=data.signup;
        if(!s)return;
        seenStatus=true;confirmed=s.state!=="verification_required";show(s);
        document.getElementById("verification-title").textContent=s.title;
        document.getElementById("verification-description").textContent=s.message;
        if(s.state==="ready"&&/^\\+1\\d{10}$/.test(s.assignedPhone||"")){
          // Reload the same capability link to get the server-rendered number/actions.
          finished=true;window.location.reload();
        }
        if(s.state==="closed")finished=true;
      }catch(_){show({state:"connection_lost"});document.getElementById("verification-description").textContent="Connection lost. Your signup is saved. Reopen this link to check progress—do not sign up again.";}
      finally{busy=false;clearTimeout(timeout);}
    }
    document.addEventListener("visibilitychange",refresh);
    document.addEventListener("signup-verification-started",()=>{started=true;setTimeout(refresh,1000);});
    document.addEventListener("signup-verification-problem",()=>show({state:"connection_lost"}));
    const timer=setInterval(refresh,5000);
    window.addEventListener("pagehide",()=>clearInterval(timer),{once:true});refresh();
  })();</script>`;
}
module.exports={verificationProgressScript,verificationProgressMarkup};
