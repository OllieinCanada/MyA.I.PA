// Evidence projection only. Never authorizes dispatch or infers delivery from call completion.
function buildCallOutcomeTimeline(call = {}) {
  const evidence=call.notificationEvidence;
  const rows=[{id:'record',title:'Call record',state:call.id?'recorded':'unknown',detail:call.id?'Saved call record is available.':'No saved call ID is available.'},
    {id:'capture',title:'Request details',state:call.lead?'recorded':'unknown',detail:call.lead?'A linked lead record is available; review its details for accuracy.':'No linked lead record is shown. This does not prove submission failed.'}];
  let submission=evidence?.available===true?evidence.submission:'unconfirmed';
  if(submission==='owner_notification_accepted'&&evidence?.owner?.accepted!==true)submission='unconfirmed';
  rows.push({id:'handoff',title:'Owner handoff',state:submission==='not_submitted'?'not_sent':submission==='owner_notification_disabled'?'disabled':submission==='owner_notification_accepted'?'accepted':'unknown',
    detail:submission==='not_submitted'?'Confirmation was rejected before execution.':submission==='owner_notification_accepted'?'Messaging provider accepted the owner handoff; this is not proof of a reply or completed job.':submission==='owner_notification_disabled'?'Owner notifications are disabled by policy.':'Handoff is not verified. Inspect saved evidence before retrying.'});
  for(const role of ['owner','customer']) {
    const e=evidence?.available===true?evidence[role]:null;
    let state='unknown',detail='Outcome unknown. Inspect saved receipts; do not resend automatically.';
    if(e?.state==='failed'){state='failed';detail='Messaging failure recorded. Inspect the receipt before taking another action.';}
    else if(e?.state==='disabled'){state='disabled';detail='Sending disabled by policy.';}
    else if(e?.state==='not_submitted'){state='not_sent';detail='No submission recorded for this recipient.';}
    else if(e?.state==='needs_number'){state='waiting';detail='Waiting for a confirmed mobile number.';}
    else if(e?.state==='delivered'&&e.delivered===true&&e.receiptsAvailable===true&&['delivered','read'].includes(e.receiptStatus)) {
      state='delivered';detail='Carrier reported delivery. Physical handset receipt is a separate check.';
    } else if(e?.state==='accepted'&&e.accepted===true) {state='accepted';detail='Provider accepted the message; delivery is not confirmed.';}
    rows.push({id:role,title:role==='owner'?'Owner text':'Customer text',state,detail,
      at:state==='delivered'&&Number.isFinite(Date.parse(e?.receiptAt))?e.receiptAt:null});
  }
  return rows;
}
module.exports={buildCallOutcomeTimeline};
