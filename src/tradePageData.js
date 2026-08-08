export const tradePageOrder = [
  "electricians",
  "plumbers",
  "hvac",
  "roofers",
  "general-contractors",
];

export const tradePages = {
  electricians: {
    singular: "electrician",
    plural: "electricians",
    label: "Electrical",
    icon: "bolt",
    accent: "#f59e0b",
    accentSoft: "#fff7db",
    accentDark: "#9a5b00",
    eyebrow: "AI telephone answering for electrical contractors",
    headline: "Keep working. Every electrical lead still gets answered.",
    intro:
      "My AI PA answers when you cannot, talks naturally with the caller, collects the electrical job details, and texts you a clear summary for follow-up.",
    ownerValue:
      "See whether the caller needs a repair, installation, commercial visit, or simple message before returning the call.",
    callerNeeds: [
      ["Electrical repair", "Breaker trips, partial power loss, dead outlets, flickering lights, buzzing equipment, or another fault."],
      ["New installation", "EV chargers, hot tubs, lighting, new circuits, renovation wiring, panels, and service upgrades."],
      ["Commercial work", "Tenant improvements, equipment power, maintenance, retrofits, and service interruptions."],
      ["Inspection or estimate", "A caller wants to explain the project and arrange a qualified follow-up."],
    ],
    intake: [
      ["Name and callback number", "So the electrician knows who called and how to reach them."],
      ["Service address or municipality", "So the business can confirm its service area before promising anything."],
      ["Problem or requested installation", "The affected equipment, symptoms, or project the caller describes."],
      ["When it started or desired timeline", "Useful context for repairs, estimates, and scheduling."],
      ["Safety and urgency signals", "Smoke, sparking, shock, heat, water near energized equipment, or lost essential power."],
      ["Preferred callback time", "So the return call fits the caller's day."],
    ],
    priorities: [
      ["Routine", "Estimate questions, lighting upgrades, EV chargers, renovations, and maintenance requests."],
      ["Priority callback", "Repeated breaker trips, partial outage, commercial downtime, or escalating equipment heat without immediate danger."],
      ["Emergency direction", "Fire, smoke, active sparking, electric shock, downed lines, or water contacting energized equipment."],
    ],
    scenario: {
      caller: "Half of my house lost power and the breaker keeps tripping.",
      assistant:
        "I can take the details for the electrician. Is there any smoke, active sparking, burning smell, unusual heat, or anyone injured?",
      owner:
        "PRIORITY ELECTRICAL REQUEST — Partial power loss; breaker repeatedly trips. No smoke, sparks, heat, or injury reported. Caller: Jordan. Address: 18 King St W, Hamilton. Callback: 905-•••-0194. Best time: now.",
    },
    questions: [
      "Do you handle residential or commercial work?",
      "What cities do you serve?",
      "Do you provide estimates for installations?",
      "What are your business hours?",
      "Do you install EV chargers or hot tubs?",
      "What happens after I leave my details?",
    ],
    boundaries: [
      "Never tells a caller to touch exposed wiring, a damaged panel, wet equipment, or a downed line.",
      "Does not diagnose the electrical cause as certain.",
      "Uses only the electrician's approved prices, licences, service areas, warranties, and availability.",
      "Does not claim that a technician was dispatched until a verified workflow confirms it.",
    ],
  },
  plumbers: {
    singular: "plumber",
    plural: "plumbers",
    label: "Plumbing",
    icon: "drop",
    accent: "#0ea5e9",
    accentSoft: "#e7f8ff",
    accentDark: "#075f86",
    eyebrow: "AI telephone answering for plumbing companies",
    headline: "Stay on the plumbing job. Your next caller still gets help.",
    intro:
      "My AI PA answers when you cannot, helps the caller explain the plumbing problem, and texts you the facts you need for a useful callback.",
    ownerValue:
      "Know what is leaking, whether water is still flowing, which fixture is affected, and when the caller needs help.",
    callerNeeds: [
      ["Leaks and water damage", "Pipes, fixtures, ceilings, basements, sump pumps, or unexplained water."],
      ["Drain and sewer issues", "Slow drains, backups, blocked toilets, floor drains, and recurring clogs."],
      ["Hot-water problems", "No hot water, leaking tanks, unusual noises, and replacement questions."],
      ["Fixtures and installations", "Faucets, toilets, sinks, dishwashers, laundry connections, and renovations."],
    ],
    intake: [
      ["Name and callback number", "A reliable way for the plumbing team to return the call."],
      ["Service address and city", "For service-area and travel planning."],
      ["Affected fixture or area", "Kitchen, bathroom, basement, water heater, main drain, or another location."],
      ["What is happening now", "Active flow, slow leak, no drainage, backup, noise, or lack of hot water."],
      ["Damage and urgency", "Standing water, ceiling damage, sewage exposure, or water near electrical equipment."],
      ["Access and callback timing", "Tenant, homeowner, property manager, access limitations, and best return-call time."],
    ],
    priorities: [
      ["Routine", "Fixture replacement, renovation questions, maintenance, and non-active leaks."],
      ["Priority callback", "Active leaks, no water, no hot water, recurring backups, or an overflowing fixture that is contained."],
      ["Emergency direction", "Rapid flooding, sewage exposure creating immediate danger, structural danger, or water contacting electrical equipment."],
    ],
    scenario: {
      caller: "Water is dripping through the kitchen ceiling from the upstairs bathroom.",
      assistant:
        "I can take the details for the plumber. Is the water still flowing, and is it near any lights, outlets, or electrical equipment?",
      owner:
        "PRIORITY PLUMBING REQUEST — Active ceiling leak below upstairs bathroom. Water is not near electrical equipment. Caller has stopped using the bathroom. Address: 42 Queen Ave, Grimsby. Callback: 289-•••-4421.",
    },
    questions: [
      "Do you handle emergency plumbing calls?",
      "Which areas do you service?",
      "Do you work on water heaters?",
      "Do you clear drains and sewer backups?",
      "Do you provide renovation estimates?",
      "How quickly will someone call me back?",
    ],
    boundaries: [
      "Does not tell callers to enter flooded or sewage-contaminated areas.",
      "Does not diagnose a hidden leak, blockage, or equipment failure as certain.",
      "Uses only owner-approved pricing, hours, service areas, warranties, and emergency policies.",
      "Does not promise a plumber is on the way until the business confirms dispatch.",
    ],
  },
  hvac: {
    singular: "HVAC contractor",
    plural: "HVAC companies",
    label: "Heating & cooling",
    icon: "air",
    accent: "#7c3aed",
    accentSoft: "#f1ebff",
    accentDark: "#5020a7",
    eyebrow: "AI telephone answering for HVAC companies",
    headline: "Busy season should not send HVAC customers to voicemail.",
    intro:
      "My AI PA answers when you cannot, separates repairs from maintenance and replacement calls, and texts your team a clear callback summary.",
    ownerValue:
      "Know whether the call is about no heat, no cooling, maintenance, a replacement estimate, or a commercial comfort problem.",
    callerNeeds: [
      ["No heat or no cooling", "The system runs poorly, stops, blows the wrong temperature, or will not start."],
      ["Equipment repair", "Furnaces, air conditioners, heat pumps, thermostats, humidifiers, and related equipment."],
      ["Maintenance", "Seasonal tune-ups, filters, recurring performance concerns, and maintenance-plan questions."],
      ["Replacement or installation", "New systems, upgrades, additions, renovations, and efficiency questions for a qualified follow-up."],
    ],
    intake: [
      ["Name and callback number", "So the service team can follow up without searching the call log."],
      ["Address and property type", "House, condo, rental, commercial site, or multi-unit property."],
      ["Heating or cooling problem", "What the system is doing in the caller's own words."],
      ["Equipment details if known", "Furnace, boiler, heat pump, AC, thermostat, fuel type, or approximate age."],
      ["People or operations affected", "Children, older adults, vulnerable occupants, frozen-pipe risk, tenants, or business downtime."],
      ["Preferred visit and callback timing", "The caller's availability without promising an appointment."],
    ],
    priorities: [
      ["Routine", "Maintenance, replacement estimates, thermostat upgrades, and comfort questions."],
      ["Priority callback", "No heat in severe cold, no cooling affecting vulnerable occupants, repeated shutdowns, or commercial downtime."],
      ["Emergency direction", "Suspected gas or carbon-monoxide exposure, fire, smoke, or anyone feeling ill or in immediate danger."],
    ],
    scenario: {
      caller: "The furnace stopped and the house is getting cold. I also smell something unusual.",
      assistant:
        "If you suspect gas, carbon monoxide, smoke, or anyone feels unwell, leave the area and contact emergency services or your gas utility. Are you safely away from the equipment now?",
      owner:
        "URGENT HVAC REQUEST — Furnace stopped; caller reported unusual odour and was given emergency safety direction. Occupants safely left the equipment area. Address: 7 Park Rd, St. Catharines. Callback requested after emergency check.",
    },
    questions: [
      "Do you repair furnaces, air conditioners, and heat pumps?",
      "Do you offer seasonal maintenance?",
      "Which areas do you service?",
      "Do you provide replacement estimates?",
      "What are your after-hours policies?",
      "Can you work with landlords or property managers?",
    ],
    boundaries: [
      "Directs suspected gas, carbon-monoxide, fire, or medical danger to the appropriate emergency response.",
      "Does not guide a caller through opening or repairing fuel-burning or electrical equipment.",
      "Does not invent rebates, efficiency savings, warranties, stock, or same-day availability.",
      "Does not promise an appointment or dispatch before confirmation.",
    ],
  },
  roofers: {
    singular: "roofer",
    plural: "roofing companies",
    label: "Roofing",
    icon: "roof",
    accent: "#ea580c",
    accentSoft: "#fff0e7",
    accentDark: "#9a3412",
    eyebrow: "AI telephone answering for roofing companies",
    headline: "Stay safely on the roof. Your next roofing lead gets answered.",
    intro:
      "My AI PA answers when you cannot, gathers the leak or project details, and texts you a clear summary without asking anyone to climb onto a roof.",
    ownerValue:
      "Return the call knowing whether it is an active leak, storm damage, repair request, inspection, or replacement estimate.",
    callerNeeds: [
      ["Active roof leaks", "Interior dripping, ceiling stains, attic moisture, and leaks around penetrations."],
      ["Storm damage", "Wind, hail, fallen branches, missing shingles, flashing, or damaged vents."],
      ["Repairs and maintenance", "Localized damage, recurring leaks, eavestrough concerns, and preventive work."],
      ["Replacement estimates", "Residential shingles, flat roofs, commercial systems, and planned replacement."],
    ],
    intake: [
      ["Name and callback number", "The primary contact for inspection or estimate follow-up."],
      ["Property address and type", "Residential, rental, commercial, flat roof, or sloped roof."],
      ["What is visible from a safe location", "Interior leak, missing shingles, damaged flashing, tree impact, or another symptom."],
      ["When it happened", "Recent storm, ongoing leak, sudden damage, or long-term concern."],
      ["Interior and structural impact", "Active dripping, sagging ceiling, damaged rooms, or blocked access."],
      ["Preferred timing", "Inspection and callback availability without promising a slot."],
    ],
    priorities: [
      ["Routine", "Replacement estimates, maintenance, old staining, and planned projects."],
      ["Priority callback", "Active contained leaks, recent storm damage, exposed roof areas, or commercial water entry."],
      ["Emergency direction", "Structural collapse risk, fire, downed power lines, or an unsafe building area."],
    ],
    scenario: {
      caller: "A storm took shingles off and water is coming into the upstairs bedroom.",
      assistant:
        "I can record this as a priority roofing request. Please stay off the roof. Is the ceiling sagging, are there downed power lines, or is anyone in immediate danger?",
      owner:
        "PRIORITY ROOFING REQUEST — Storm damage; missing shingles visible from ground; active bedroom leak; no sagging ceiling or downed lines reported. Address: 105 Main St, Beamsville. Callback: 905-•••-8820.",
    },
    questions: [
      "Do you provide roof-replacement estimates?",
      "Do you handle active leaks and storm damage?",
      "Which roofing systems do you work on?",
      "What cities do you service?",
      "Can I send photos taken safely from the ground?",
      "What happens after I request an inspection?",
    ],
    boundaries: [
      "Never asks a caller to climb onto a roof or enter a structurally unsafe area.",
      "Does not determine the cause, insurance coverage, or repair price from a phone description.",
      "Uses only owner-approved materials, warranties, financing, and inspection policies.",
      "Does not promise emergency tarping, arrival, or insurance approval before confirmation.",
    ],
  },
  "general-contractors": {
    singular: "general contractor",
    plural: "general contractors",
    label: "General contracting",
    icon: "hammer",
    accent: "#16a34a",
    accentSoft: "#eaf9ee",
    accentDark: "#166534",
    eyebrow: "AI telephone answering for general contractors",
    headline: "Keep the project moving. New construction leads still get answered.",
    intro:
      "My AI PA answers when you cannot, helps the caller explain the project, and texts you the location, scope, timing, and contact details.",
    ownerValue:
      "Separate serious renovation and construction opportunities from incomplete inquiries and simple vendor messages.",
    callerNeeds: [
      ["Renovations", "Kitchens, bathrooms, basements, whole-home work, accessibility improvements, and structural changes."],
      ["Additions and new spaces", "Home additions, garages, suites, offices, and commercial buildouts."],
      ["Repairs and restoration", "Interior damage, exterior repairs, insurance-related inquiries, and multi-trade work."],
      ["Commercial projects", "Tenant improvements, phased work, occupied-site constraints, and facility upgrades."],
    ],
    intake: [
      ["Contact and decision-maker", "The caller's role, callback number, and who approves the project."],
      ["Project address and property type", "Home, rental, commercial site, occupied unit, or managed property."],
      ["Scope in the caller's words", "What they want changed, repaired, built, or coordinated."],
      ["Current project stage", "Idea, drawings, permits, insurance review, quotes, or ready to begin."],
      ["Desired timeline and constraints", "Target start, access, occupancy, deadlines, and phasing."],
      ["Budget conversation preference", "Only when the contractor has approved how budget questions should be asked."],
    ],
    priorities: [
      ["Routine", "Early planning, estimate requests, future renovations, and vendor messages."],
      ["Qualified opportunity", "Clear scope, confirmed property, decision-maker involved, and realistic callback availability."],
      ["Safety redirect", "Active fire, structural collapse, gas, electrical, flooding, or medical danger requiring emergency help first."],
    ],
    scenario: {
      caller: "We want to finish our basement and add a bathroom before winter.",
      assistant:
        "I can collect the project details for the contractor. What is the address, and are you the homeowner or the person responsible for approving the work?",
      owner:
        "RENOVATION OPPORTUNITY — Basement finish plus new bathroom. Homeowner and decision-maker confirmed. Address: 29 Valley Rd, Hamilton. Planning stage; no drawings yet. Target: before winter. Best callback: weekdays after 5 p.m.",
    },
    questions: [
      "What types of renovations do you take on?",
      "Which cities do you serve?",
      "Do you work on occupied homes or commercial spaces?",
      "Do I need drawings or permits before calling?",
      "How does the estimate process begin?",
      "When will someone follow up?",
    ],
    boundaries: [
      "Does not quote a project, confirm feasibility, or promise a start date from a short call.",
      "Does not provide structural, permit, engineering, legal, or insurance conclusions.",
      "Uses only the contractor's approved services, minimum project size, service area, and estimate process.",
      "Does not claim subcontractors, permits, materials, or schedules are confirmed until verified.",
    ],
  },
};

export const sharedCallFlow = [
  ["1", "Caller explains the job", "A real conversation starts immediately instead of sending the caller to voicemail."],
  ["2", "Trade-specific questions", "The assistant asks one concise question at a time and follows the business's approved intake rules."],
  ["3", "Safety and urgency checked", "Danger signals are handled conservatively; routine and priority requests remain clearly separated."],
  ["4", "Both sides get clarity", "The owner receives the useful job details and the caller hears the verified next step."],
];

