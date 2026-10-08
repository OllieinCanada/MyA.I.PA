// Read-only progress refreshes. Never resend verification or replay provisioning.
function verificationProgressScript(url) {
  return `<script>(()=>{
    const endpoint=${JSON.stringify(url).replace(/</g,'\\u003c')};
    let busy=false,finished=false;
    async function refresh(){
      if(busy||finished||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const r=await fetch(endpoint,{credentials:"same-origin",cache:"no-store",redirect:"error"});
        if(!r.ok){if(r.status===401||r.status===410){finished=true;document.getElementById("verification-description").textContent="This link expired. Contact support—do not sign up again.";}return;}
        const data=await r.json(),s=data.signup;
        if(!s)return;
        document.getElementById("verification-title").textContent=s.title;
        document.getElementById("verification-description").textContent=s.message;
        if(s.state==="ready"&&/^\\+1\\d{10}$/.test(s.assignedPhone||"")){
          // Reload the same capability link to get the server-rendered number/actions.
          finished=true;window.location.reload();
        }
        if(s.state==="closed")finished=true;
      }catch(_){document.getElementById("verification-description").textContent="Connection lost. Your signup is saved. Reopen this link to check progress—do not sign up again.";}
      finally{busy=false;}
    }
    document.addEventListener("visibilitychange",refresh);
    setInterval(refresh,15000);refresh();
  })();</script>`;
}
module.exports={verificationProgressScript};
