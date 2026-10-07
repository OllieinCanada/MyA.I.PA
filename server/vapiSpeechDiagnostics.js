function words(value) { return String(value || "").toLowerCase().match(/[a-z0-9]+/g) || []; }
function orderedCoverage(expected, spoken) {
  // Bounded LCS: a diagnostic signal, not proof that an ASR transcript is audio.
  const a=words(expected).slice(0,500), b=words(spoken).slice(0,1000);
  const row=new Uint16Array(b.length+1);
  for(const x of a){let prev=0;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=x===b[j-1]?prev+1:Math.max(row[j],row[j-1]);prev=old;}}
  return a.length ? row[b.length]/a.length : 0;
}
function assessSpeechLogs(entries=[]) {
  const completions=entries.filter(e=>e.attributes?.event==="assistant.model.responseSucceeded"&&String(e.attributes?.completionText||"").trim());
  const spoken=entries.filter(e=>e.attributes?.event==="assistant.transcriber.finalTranscript"&&e.attributes?.channel==="assistant").map(e=>e.attributes.transcript).join(" ");
  const expected=completions.map(e=>e.attributes.completionText).join(" ");
  const available=words(expected).length>=8&&words(spoken).length>=8;
  const coverage=available?orderedCoverage(expected,spoken):null;
  const failures=entries.filter(e=>e.attributes?.event==="assistant.model.requestAttemptFailed").length;
  return {
    status: !available?"insufficient_speech_evidence":coverage<0.9?"speech_review_required":"transcript_consistent",
    generatedWordCoverage:coverage===null?null:Number(coverage.toFixed(3)),
    modelRequestFailures:failures,
    // A hangup/interrupt or ASR error can also cause low coverage. Never use
    // this result to declare the voice provider broken or a call audio passed.
    audioVerified:false,
    next:!available?"Run a controlled call and review its audio.":coverage<0.9?"Compare the recording with generated text; do not mark audio passed.":"Listen to the recording before marking the spoken-call test passed.",
  };
}
module.exports={assessSpeechLogs,orderedCoverage};
