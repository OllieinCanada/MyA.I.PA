const MARKER = '## MYAIPA CONFIRMED SERVICE INTAKE';
const END = '## END MYAIPA CONFIRMED SERVICE INTAKE';
const INTAKE_POLICY = `${MARKER}
PRICING BEFORE ROUTINE INTAKE:
- For an ordinary service call, repair or maintenance request, first explain the owner's selected statements from the verified Pricing section. Use the saved amounts exactly, including selected visit fee, hourly labour, assessment and parts policy. Never substitute defaults or change an unusual saved price.
- If any service/repair pricing statement is selected, ask exactly: "Would you like to continue?" and wait before routine intake. A yes here is pricing agreement only, not permission to send notifications.
- Do not quote unselected prices. For installations, preserve only the owner's selected installation/free-estimate policy. For missing prices, say the team must confirm them. Current hazards take priority over pricing and ordinary intake.
- Pass pricingDiscussed true only after actually discussing the selected service/repair policy; otherwise false. Never claim an agreed total, booked appointment, dispatch or arrival time.
COMPLETE, CALLER-CONFIRMED DETAILS:
- Ask one complete question at a time. The callback question is: "Is the number you're calling from the best mobile number for the team to reach you?" The protected notification tool verifies caller ID; the SMS routing instructions govern any fallback number.
- If the work description is only "some work", "electrical work" or similarly vague, ask one useful clarification: "What work would you like the team to help with?" Never invent the missing task.
- For work at a location, collect street address AND city. If the city is unclear or was not stated, ask: "Which city or town is that in?" Read an uncertain street or city back and wait for correction. Never infer a city from the service area, a directional phrase, an address fragment or a guess.
- Keep the caller's full preferred-start and callback phrases. Do not shorten "sometime next week" to "sometime next", turn preferences into appointments or invent urgency. Omit an unknown urgency rather than passing null or a guess.
- Preserve those complete answers in preferredStartDate and bestCallbackTime; preserve the confirmed streetAddress, city and jobDetails separately.
- Read back job type, work details, street and city, full preferred start timing and callback preference before asking permission to send. If corrected, update the same request, read back the corrected details and ask permission again.
- Set workDetailsConfirmed true only after required work details and location were read back and confirmed. If a work field is missing or uncertain, ask for it; do not set that flag or invoke notification tools yet.
${END}`;

// Remove only known retired execution instructions. Preserve business facts,
// prices, safety, voice, privacy, scope and unrelated custom instructions.
function consolidateServicePrompt(value) {
  let text = String(value || '')
    .replace(/\n*## MYAIPA CONFIRMED SERVICE INTAKE[\s\S]*?## END MYAIPA CONFIRMED SERVICE INTAKE/g, '')
    .replace(/\n*## MYAIPA SMS ROUTING \(DO NOT GUESS\)[\s\S]*?## END MYAIPA SMS ROUTING/g, '')
    .replace(/^## (?:Phone capture guardrail|SMS and owner notification|Caller-facing SMS and tool rule)\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/gm, '');
  text = text.split('\n').filter(line => !/send_customer_sms_dynamic|send_owner_sms_dynamic|Before any final submission, use this exact read-back order|Ask exactly: "Is all of that correct, and do you want me to submit it now|After both service notification tools finish successfully|For SMS tools, pass structured fields/.test(line)).join('\n');
  text = text.replace('caller name, explicit callback number, work requested', 'caller name, callback contact, work requested');
  return `${text.trimEnd()}\n\n${INTAKE_POLICY}`;
}

module.exports = { INTAKE_POLICY, consolidateServicePrompt };
