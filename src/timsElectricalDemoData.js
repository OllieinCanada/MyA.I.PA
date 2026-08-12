import { timsElectricalRecordedTranscripts } from "./timsElectricalRecordedTranscripts";

export const timsElectricalCompany = {
  name: "Tim's Electrical",
  privateNotice:
    "Demonstration prepared by My AI PA. All callers, addresses, messages, and job details shown here are simulated.",
};

export const timsElectricalFlowCards = [
  {
    icon: "bolt",
    title: "New installations",
    text: "Capture the project, property address, timing, and callback details without promising a price or appointment.",
  },
  {
    icon: "wrench",
    title: "Repair inquiries",
    text: "Organize the symptoms and affected area while leaving diagnosis and repair advice to a qualified electrician.",
  },
  {
    icon: "document",
    title: "Maintenance questions",
    text: "Record what the caller wants inspected, their preferred timing, and any helpful site-access notes.",
  },
  {
    icon: "message",
    title: "Follow-up concerns",
    text: "Give existing customers a calm way to document an unresolved concern and request a team callback.",
  },
];

export const timsElectricalKnowledge = [
  {
    label: "Call types",
    value: "The demonstration handles new installation, repair, maintenance, quote, and follow-up inquiries.",
  },
  {
    label: "Useful job details",
    value: "It can collect the caller's name, callback number, service address, city, issue, preferred timing, and safety indicators.",
  },
  {
    label: "Two-sided follow-up",
    value: "The owner receives an organized lead summary and the caller receives a concise confirmation when texting is enabled and consented.",
  },
  {
    label: "Optional price qualification",
    value: "A business-approved service-call fee can be shared before handoff, followed by a simple choice to continue. No price is invented by the assistant.",
  },
];

export const timsElectricalConfirmations = [
  {
    label: "Price or estimate",
    text: "Only a fee explicitly approved by the electrical business may be shared. All other pricing and estimate terms require team confirmation.",
  },
  {
    label: "Appointment or arrival time",
    text: "The receptionist may record preferences but must not promise scheduling or response times.",
  },
  {
    label: "Service area and availability",
    text: "The team must confirm that it serves the address and can accept the requested work.",
  },
];

export const timsElectricalBoundaries = [
  "Never diagnose an electrical problem or instruct a caller to inspect dangerous equipment.",
  "Never guarantee a price, appointment, response time, warranty, licence, certification, or technician availability.",
  "Stop ordinary intake when smoke, fire, sparks, burning wiring, or immediate danger is reported.",
  "Read back critical phone and address details before preparing the handoff.",
  "Describe message delivery truthfully and only after the delivery result is confirmed.",
];

export const timsElectricalScenarios = [
  {
    id: "new-installation",
    shortLabel: "New installation",
    title: "Homeowner needs a hot tub wired",
    intent: "New installation",
    priority: "Installation opportunity",
    route: "Electrical team · quote follow-up",
    stages: ["Service identified", "Job details collected", "Timing confirmed", "Texts prepared"],
    transcript: [
      { speaker: "assistant", text: "Thanks for calling Tim's Electrical. How can I help you today?" },
      { speaker: "caller", text: "I'm putting in a hot tub and need it wired." },
      { speaker: "assistant", text: "Absolutely—I can collect that for the team. When are you hoping to have the work done?" },
      { speaker: "caller", text: "Sometime next week." },
      { speaker: "assistant", text: "Next week—got it. May I get your name?" },
      { speaker: "caller", text: "Brian Smith." },
      { speaker: "assistant", text: "What's the address and city where the work is needed?" },
      { speaker: "caller", text: "63 York Street in St. Catharines." },
      { speaker: "assistant", text: "What is the best number and time for the team to call you?" },
      { speaker: "caller", text: "905-555-0123, after 5 p.m." },
      { speaker: "assistant", text: "Thanks. I'll prepare those details for the team. They will follow up to discuss the request and next steps. Have a great day!" },
    ],
    collected: ["Brian Smith", "905-555-1234", "23 Robb Street · Hamilton", "New hot tub wiring", "Callback after 5 p.m."],
    missing: ["Preferred start date", "Site-access notes"],
    summary: "Brian needs a licensed electrician to wire a newly installed hot tub at 23 Robb Street in Hamilton and prefers a callback after 5 p.m.",
    ownerText: "NEW INSTALLATION · Brian Smith · 905-555-1234 · New hot tub wiring · 23 Robb Street, Hamilton · Callback after 5 p.m. · Pricing and scheduling require confirmation.",
    customerText: "Thanks for calling Tim's Electrical. We received your hot tub wiring request. The team will follow up to discuss the details and next steps. Have a great day!",
  },
  {
    id: "repair-request",
    shortLabel: "Repair request",
    title: "Homeowner reports an outlet stopped working",
    intent: "Electrical repair inquiry",
    priority: "Standard service inquiry",
    route: "Electrical team · repair review",
    stages: ["Problem identified", "Safety checked", "Contact confirmed", "Texts prepared"],
    transcript: [
      { speaker: "assistant", text: "Please describe what is happening." },
      { speaker: "caller", text: "Two kitchen outlets stopped working this afternoon." },
      { speaker: "assistant", text: "Is there smoke, sparking, a burning smell, heat, or immediate danger?" },
      { speaker: "caller", text: "No. The outlets just have no power." },
      { speaker: "assistant", text: "Thank you. What's your name and the service address?" },
      { speaker: "caller", text: "Maya Chen, 18 King Street in Grimsby." },
      { speaker: "assistant", text: "What is the best callback number?" },
      { speaker: "caller", text: "905-555-0188." },
      { speaker: "assistant", text: "I'll prepare the repair request for the team. They will confirm whether the address and requested work can be served." },
    ],
    collected: ["Maya Chen", "905-555-0168", "18 Lake Avenue · Grimsby", "Kitchen outlet stopped working", "No immediate-danger indicators reported", "Mornings preferred"],
    missing: [],
    summary: "Maya reports that a kitchen outlet stopped working yesterday at 18 Lake Avenue in Grimsby. She reports no smoke, sparks, heat, burning smell, or immediate danger and prefers mornings.",
    ownerText: "REPAIR REQUEST · Maya Chen · 905-555-0168 · Kitchen outlet stopped working yesterday · 18 Lake Avenue, Grimsby · No immediate-danger indicators reported · Mornings preferred.",
    customerText: "Thanks for calling Tim's Electrical. We received your outlet repair request. The team will follow up after reviewing the service details.",
  },
  {
    id: "maintenance",
    shortLabel: "Maintenance",
    title: "Customer asks about an electrical inspection",
    intent: "Maintenance inquiry",
    priority: "Standard service inquiry",
    route: "Electrical team · maintenance review",
    stages: ["Request identified", "Property collected", "Timing collected", "Texts prepared"],
    transcript: [
      { speaker: "assistant", text: "What would you like the electrical team to inspect?" },
      { speaker: "caller", text: "I'd like someone to look over the panel in a house I recently bought." },
      { speaker: "assistant", text: "Are you experiencing smoke, sparks, a burning smell, heat, or an outage right now?" },
      { speaker: "caller", text: "No. This is preventive." },
      { speaker: "assistant", text: "May I get your name, callback number, and the property address?" },
      { speaker: "caller", text: "Jordan Lee, 905-555-0144, 72 Main Street in Hamilton." },
      { speaker: "assistant", text: "What callback time works best?" },
      { speaker: "caller", text: "Weekday mornings." },
      { speaker: "assistant", text: "I'll prepare the inspection inquiry. The team will confirm the scope, availability, and pricing." },
    ],
    collected: ["Daniel Ortiz", "905-555-0144", "44 Maple Drive · Stoney Creek", "Preventive electrical inspection", "Older home", "Weekday afternoons"],
    missing: [],
    summary: "Daniel is requesting a preventive electrical inspection for an older home at 44 Maple Drive in Stoney Creek and prefers weekday afternoons.",
    ownerText: "MAINTENANCE · Daniel Ortiz · 905-555-0144 · Preventive electrical inspection for an older home · 44 Maple Drive, Stoney Creek · Weekday afternoons.",
    customerText: "Thanks for calling Tim's Electrical. We received your panel-inspection inquiry. The team will follow up to confirm the scope, availability, and pricing.",
  },
  {
    id: "unresolved-concern",
    shortLabel: "Talk to the team",
    title: "Customer asks to discuss an unresolved concern",
    intent: "Existing-customer follow-up",
    priority: "Team callback requested",
    route: "Electrical team · private follow-up",
    stages: ["Customer identified", "Concern documented", "Next step requested", "Callback prepared"],
    transcript: [
      { speaker: "assistant", text: "I can document your concern and prepare a callback request for the team. What happened?" },
      { speaker: "caller", text: "I asked about a flickering hallway light last week and still need an update." },
      { speaker: "assistant", text: "Is there smoke, sparking, a burning smell, heat, or immediate danger now?" },
      { speaker: "caller", text: "No. I just want to know the next step." },
      { speaker: "assistant", text: "May I get your name, callback number, and service address?" },
      { speaker: "caller", text: "Priya Shah, 905-555-0177, 18 George Street." },
      { speaker: "assistant", text: "What would you like the team to do next?" },
      { speaker: "caller", text: "Please call me with an update. Evenings are best." },
      { speaker: "assistant", text: "I'll prepare that callback request without promising an outcome or response time." },
    ],
    collected: ["Ayesha Patel", "905-555-0171", "71 King Street · Hamilton", "Existing customer", "Unresolved concern", "Evening callback"],
    missing: ["More information about the concern"],
    summary: "Ayesha is an existing customer requesting an evening callback about an unresolved concern connected with 71 King Street in Hamilton. She was unsure of the concern details during the call.",
    ownerText: "FOLLOW-UP REQUEST · Ayesha Patel · 905-555-0171 · 71 King Street, Hamilton · Existing customer with an unresolved concern · Details require clarification · Evenings preferred.",
    customerText: "Thanks for calling Tim's Electrical. We recorded your request for an update and your evening callback preference. The team will review the details and follow up.",
  },
  {
    id: "urgent-outage",
    shortLabel: "Urgent issue",
    title: "Customer reports a complete home power outage",
    intent: "Urgent electrical inquiry",
    priority: "Priority callback",
    route: "Electrical team · urgent review",
    stages: ["Danger checked", "Impact confirmed", "Contact collected", "Priority summary ready"],
    transcript: [
      { speaker: "caller", text: "The whole house lost power, but the neighbours still have electricity." },
      { speaker: "assistant", text: "Is there smoke, fire, sparking, a burning smell, heat at the panel, or any immediate danger?" },
      { speaker: "caller", text: "No, none of those." },
      { speaker: "assistant", text: "I'll mark this as an urgent issue for review. What is your name and service address?" },
      { speaker: "caller", text: "Alex Martin, 91 Lake Street in Grimsby." },
      { speaker: "assistant", text: "What is the best callback number?" },
      { speaker: "caller", text: "905-555-0160." },
      { speaker: "assistant", text: "I'll prepare the urgent request. I cannot guarantee dispatch or a response time, and the electrical team must confirm the next step." },
    ],
    collected: ["Noah Wilson", "905-555-0109", "9 Orchard Lane · Grimsby", "Complete home outage", "Neighbours still have power", "No immediate-danger indicators reported", "Available now"],
    missing: [],
    summary: "PRIORITY — Noah reports a complete home outage at 9 Orchard Lane in Grimsby while neighbouring properties still have power. No immediate-danger indicators were reported, and he is available now.",
    ownerText: "PRIORITY CALLBACK · Noah Wilson · 905-555-0109 · Complete home outage · 9 Orchard Lane, Grimsby · Neighbours still have power · No immediate-danger indicators reported · Available now.",
    customerText: "Thanks for calling Tim's Electrical. We recorded your urgent power-outage request. This is not a dispatch confirmation; the team must review the details and contact you.",
  },
  {
    id: "safety-redirect",
    shortLabel: "Safety redirect",
    title: "Caller reports smoke and sparks",
    intent: "Immediate-danger report",
    priority: "Emergency redirect",
    route: "911 · ordinary intake stopped",
    stages: ["Danger detected", "Intake stopped", "Emergency direction given", "Minimal event stored"],
    transcript: [
      { speaker: "caller", text: "There are sparks and smoke coming from an outlet." },
      { speaker: "assistant", text: "Leave the area and call 911 now from a safe location. Do not touch the outlet or wait for a service callback. This demonstration cannot provide emergency dispatch." },
    ],
    collected: ["Electrical sparks", "Smoke", "Emergency redirect issued"],
    missing: [],
    summary: "The caller reported sparks and smoke. Ordinary intake stopped immediately and the caller was directed to leave danger and call 911.",
    ownerText: "SAFETY EVENT · Caller reported sparks and smoke · Ordinary service intake stopped · Caller directed to leave danger and call 911.",
    customerText: "No routine confirmation text is prepared during an emergency redirect. The caller was directed to leave danger and call 911.",
  },
].map((scenario) => ({
  ...scenario,
  transcript: timsElectricalRecordedTranscripts[scenario.id] || scenario.transcript,
}));
