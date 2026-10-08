const {redactIncidentText} = require('./incidentAlerts');
// Preserve validation diagnostics, never a response/request body or credentials.
function providerFailureDetail(data, secrets = []) {
  const messages = Array.isArray(data?.message) ? data.message : [data?.message, data?.error?.message];
  let text = messages.filter(x=>typeof x==='string').join('; ');
  for (const value of secrets) if(typeof value==='string'&&value.length>=8) text=text.split(value).join('[removed]');
  return redactIncidentText(text,{maxLength:1000});
}
module.exports={providerFailureDetail};
