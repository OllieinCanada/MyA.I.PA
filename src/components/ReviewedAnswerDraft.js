import React, {useId, useState} from 'react';
import './ReviewedAnswerDraft.css';
function Draft({businessId,businessName}) {
  const id=useId();
  const [draft,setDraft]=useState({question:'',answer:'',source:''});
  const [reviewed,setReviewed]=useState(false);
  const bound=Number.isSafeInteger(businessId)&&businessId>0;
  const complete=bound&&Object.values(draft).every(v=>v.trim().length>0);
  const edit=(field,value)=>{setDraft(current=>({...current,[field]:value}));setReviewed(false);};
  return <section className="reviewed-answer-draft" aria-label="Reviewed answer preparation">
    <h3>Prepare a better answer</h3>
    <p>For <strong>{businessName||'this business'}</strong>. This private draft stays only in this open page. It does not train or update the receptionist, save a FAQ, or send anything.</p>
    {!bound?<p role="alert">An exact business identity is missing. Review is unavailable.</p>:null}
    <label htmlFor={id+'-question'}>Caller question</label>
    <input id={id+'-question'} maxLength={240} value={draft.question} onChange={e=>edit('question',e.target.value)} disabled={!bound}/>
    <label htmlFor={id+'-answer'}>Proposed business answer</label>
    <textarea id={id+'-answer'} rows={4} maxLength={2000} value={draft.answer} onChange={e=>edit('answer',e.target.value)} disabled={!bound}/>
    <label htmlFor={id+'-source'}>Verified source or business fact</label>
    <input id={id+'-source'} maxLength={500} value={draft.source} onChange={e=>edit('source',e.target.value)} disabled={!bound}/>
    <p>Use facts the business has confirmed. Caller statements and AI summaries are not verified business policy. Leave out customer personal information.</p>
    <button type="button" disabled={!complete||reviewed} onClick={()=>setReviewed(true)}>Mark draft reviewed</button>
    <p role="status">{reviewed?'Reviewed draft only—not published. Editing any field removes this review.':'Not reviewed. No receptionist changes have been made.'}</p>
    {reviewed?<div className="reviewed-answer-preview" aria-label="Reviewed answer preview">
      <h4>Practice this answer before publication</h4>
      <dl><dt>Question</dt><dd>{draft.question}</dd><dt>Answer</dt><dd>{draft.answer}</dd><dt>Source</dt><dd>{draft.source}</dd></dl>
      <p>Rehearse a matching question, an out-of-scope question, and a request that conflicts with these facts. If the answer is correct, use the existing business-information update process. This panel cannot publish it.</p>
    </div>:null}
  </section>;
}
export default function ReviewedAnswerDraft(props) {
  return <Draft key={String(props.businessId)+':'+String(props.businessName)} {...props}/>;
}
