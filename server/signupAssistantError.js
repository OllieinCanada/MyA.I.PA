'use strict';
const crypto = require('node:crypto');
const {redactIncidentText} = require('./incidentAlerts');
const {signupDiagnosticError} = require('./signupDiagnosticError');
const PHASES = Object.freeze({context:'Validate saved signup context', phone:'Validate purchased number',
  prerequisite:'Verify completed number-purchase receipt', claim:'Claim or inspect assistant operation',
  reconcile:'Inspect existing assistant', create:'Create and verify assistant'});
function privateStrings(value, output = [], depth = 0) {
  if (depth > 12 || output.length > 500) return output;
  if (typeof value === 'string' && value.length >= 3) output.push(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) privateStrings(item, output, depth + 1);
  return output;
}
function redactDetail(value, secrets = []) {
  let text = typeof value === 'string' ? value : '';
  // Redact before bounding. Never copy bodies, headers, prompts or stacks.
  for (const secret of [...new Set(secrets.filter(x=>typeof x==='string'&&x.length>=3))].sort((a,b)=>b.length-a.length)) text=text.split(secret).join('[removed]');
  text=text.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/gi,'[URL removed]');
  // The shared redactor's multiword markers can be matched as credential values
  // on a later read. Normalize before AND after it to keep reads idempotent.
  const markers=value=>value.replace(/\[(?:[a-z -]+ )?removed\]/gi,'<redacted>');
  return markers(redactIncidentText(markers(text),{maxLength:600}));
}
function assistantErrorEvidence({error = {}, phase, contextHash, privateValues = [], env = process.env}) {
  if (!Object.hasOwn(PHASES,phase)) return null;
  const diagnostic=signupDiagnosticError(error);
  const raw = typeof error.providerDetail === 'string' && error.providerDetail ? error.providerDetail : error.message;
  return {version:1,phase,phaseLabel:PHASES[phase],contextHash:/^[a-f0-9]{64}$/.test(contextHash||'')?contextHash:null,
    code:diagnostic.code,httpStatus:diagnostic.httpStatus,
    detail:redactDetail(raw,[...Object.entries(env).filter(([k])=>/secret|token|password|key|url/i.test(k)).map(([,v])=>v),
      ...(!diagnostic.code?[error.code,error.providerCode]:[]),...privateValues]),
    errorReference:crypto.createHash('sha256').update(String(error.code||'')+'\n'+String(raw||'')).digest('hex').slice(0,16),
    providerOutcome:['context','phone','prerequisite'].includes(phase)?'assistant_not_dispatched':'uncertain_inspect_receipts',
    retryAllowed:false};
}
function readAssistantError(value) {
  if (!value || value.version!==1 || !Object.hasOwn(PHASES,value.phase)
    || !(value.contextHash===null || /^[a-f0-9]{64}$/.test(value.contextHash||''))
    || !/^[a-f0-9]{16}$/.test(value.errorReference||'') || value.retryAllowed!==false
    || value.providerOutcome!==(['context','phone','prerequisite'].includes(value.phase)?'assistant_not_dispatched':'uncertain_inspect_receipts')
    || typeof value.detail!=='string' || value.detail.length>600) return null;
  const diagnostic=signupDiagnosticError({code:value.code,httpStatus:value.httpStatus});
  return {version:1,phase:value.phase,phaseLabel:PHASES[value.phase],contextHash:value.contextHash,
    code:diagnostic.code,httpStatus:diagnostic.httpStatus,detail:redactDetail(value.detail),
    errorReference:value.errorReference,providerOutcome:value.providerOutcome,retryAllowed:false};
}
function assistantFailure(record = {}) {
  if (record.status!=='setup_error' || record.makeFailedStage!=='VAPI_ASSISTANT_CREATE') return null;
  const diagnostic=signupDiagnosticError({code:record.makeProviderCode || record.makeError,providerStatus:record.makeProviderStatus});
  return {stage:'assistant',label:'Assistant creation failed',code:diagnostic.code,
    detail:diagnostic.code?diagnostic.message:'The saved Make response reports failure at the assistant-creation step. The underlying error is unavailable in this saved evidence; this does not prove a Vapi rejection or timeout.',
    nextAction:'Inspect the existing purchased number, exact assistant failure and receipts. Do not buy another number or rerun signup.'};
}
module.exports={assistantErrorEvidence,readAssistantError,assistantFailure,privateStrings,redactDetail};
