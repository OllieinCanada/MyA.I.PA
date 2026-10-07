const zlib=require("node:zlib");
const {assessSpeechLogs}=require("../server/vapiSpeechDiagnostics");
async function speechLogEvidence(call,{fetchImpl=fetch}={}) {
  const url=call.artifact?.presignedLogUrl || call.artifact?.logUrl;
  if(!url||!String(url).startsWith("https://"))return {status:"speech_log_unavailable",audioVerified:false};
  try{
    const r=await fetchImpl(url,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)return{status:"speech_log_unavailable",httpStatus:r.status,audioVerified:false};
    const raw=Buffer.from(await r.arrayBuffer());
    const body=raw[0]===31&&raw[1]===139?zlib.gunzipSync(raw,{maxOutputLength:20*1024*1024}).toString("utf8"):raw.toString("utf8");
    const entries=body.split(/\r?\n/).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);
    return assessSpeechLogs(entries);
  }catch{return{status:"speech_log_unavailable",audioVerified:false};}
}
module.exports={speechLogEvidence};
