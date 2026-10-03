const crypto = require("node:crypto");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
const fingerprint = value=>crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
async function captureRelease(api, assistantId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId || "")) throw new Error("An exact assistant ID is required.");
  const assistant=await api(`/assistant/${encodeURIComponent(assistantId)}`,{},"Read eval target release");
  if(assistant?.id!==assistantId || !/^v[1-9]\d*$/.test(assistant.latestVersion || ""))throw new Error("The exact target has no confirmed published version.");
  const refs=[...(assistant.model?.toolIds || []),...(assistant.toolIds || [])];
  const ids=[...new Set(refs.map(ref=>typeof ref==='string'?ref:ref?.id || ref?.toolId))];
  if(ids.some(id=>!/^[a-zA-Z0-9_-]{1,128}$/.test(id || "")))throw new Error("The target tool identity is unclear.");
  const tools=[];
  for(const id of ids.sort()) {
    const tool=await api(`/tool/${encodeURIComponent(id)}`,{},"Read eval target tool");
    if(tool?.id!==id)throw new Error("The target tool could not be verified.");
    tools.push(tool);
  }
  // Hash all returned configuration; never save prompts, tool credentials or
  // customer data. Draft/version/tool changes invalidate the observed snapshot.
  return {assistantIdHash:fingerprint(assistantId).slice(0,12),publishedVersion:assistant.latestVersion,configurationFingerprint:fingerprint({assistant,tools}),toolCount:tools.length};
}
function releaseUnchanged(before,after) {
  return before?.assistantIdHash===after?.assistantIdHash && before?.publishedVersion===after?.publishedVersion && before?.configurationFingerprint===after?.configurationFingerprint;
}
function definitionMatches(expected, actual) {
  if(Array.isArray(expected))return Array.isArray(actual) && expected.length===actual.length && expected.every((item,index)=>definitionMatches(item,actual[index]));
  if(expected && typeof expected==='object')return actual && typeof actual==='object' && Object.keys(expected).every(key=>definitionMatches(expected[key],actual[key]));
  return expected===actual;
}
function assessRuns(results,{minimumPassRate=1}={}) {
  const groups=new Map();
  for(const result of results) {
    const group=groups.get(result.item.key) || [];group.push(result.passed===true);groups.set(result.item.key,group);
  }
  const cases=[...groups].map(([key,runs])=>({key,runs:runs.length,passed:runs.filter(Boolean).length,passRate:runs.filter(Boolean).length/runs.length}));
  return {cases,pass:cases.length>0 && cases.every(item=>item.passRate>=minimumPassRate)};
}
module.exports={captureRelease,releaseUnchanged,definitionMatches,assessRuns};
