const { buildAgentReadiness } = require('./signupAgentTesting');

// Only server-owned receipts and current, fingerprint-bound delivery proofs.
// No elapsed-time progress, raw provider errors, contact details or resource IDs.
function buildSignupProgress({ attempt = {}, signup = {}, receipts = {}, contactVerified = false, channel = 'sms', ready = false } = {}) {
  const completed = kind => receipts[kind]?.status === 'completed' ? receipts[kind].result || {} : {};
  const number = completed('twilio-number');
  const assistant = completed('vapi-assistant');
  const checks = buildAgentReadiness({ signup }).checks;
  const passed = key => checks.some(check => check.key === key && check.done);
  const phone = String(attempt.assignedPhone || signup.twilioPhoneNumber || number.twilioPhoneNumber || '');
  const trial = Boolean(signup.subscriptionId && ['trialing', 'active'].includes(signup.subscriptionStatus) && !signup.stripeTrialError && !signup.stripeTrialSkipped);
  const items = [
    ['verification', channel === 'email' ? 'Contact verified' : 'Phone verified', channel === 'email' ? 'Checking your contact verification…' : 'Checking your phone verification…', contactVerified],
    ['number', 'My AI PA number assigned', 'Assigning your My AI PA number', /^\+1\d{10}$/.test(phone)],
    ['assistant', 'Assistant created', 'Creating your assistant', Boolean(attempt.vapiAssistantId || signup.vapiAssistantId || assistant.assistantId)],
    ['content', 'Your business answers added', 'Checking your assistant’s business answers', passed('assistant-content')],
    ['call-route', 'Number connected to your assistant', 'Connecting your number to your assistant', passed('agent-route')],
    ['text-routing', 'Owner and caller text routes checked', 'Configuring your assistant’s text messages', passed('routing')],
    ['owner-text', 'Owner sample text delivered', 'Waiting for the owner sample text to be delivered', passed('owner-text')],
    ['customer-text', 'Customer sample text delivered', 'Waiting for the customer sample text to be delivered', passed('customer-text')],
    ['trial', '14-day trial activated', 'Activating your 14-day trial', trial],
  ];
  const allChecksPassed = contactVerified && items.every(item => item[3]);
  items.push(['ready', 'Your number is ready', 'Finishing your setup', ready && allChecksPassed]);
  const currentIndex = items.findIndex(item => !item[3]);
  return {
    steps: items.map(([key, label, working, done], index) => ({ key, label, working, status: done ? 'done' : index === currentIndex ? 'current' : 'pending' })),
    completed: items.filter(item => item[3]).length,
    total: items.length,
    currentLabel: currentIndex < 0 ? 'Your number is ready' : items[currentIndex][2],
  };
}
module.exports = { buildSignupProgress };
