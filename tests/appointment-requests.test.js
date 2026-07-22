const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCalendarInvite,
  assertScheduleAvailable,
  createAppointmentRequest,
  formatAppointmentDate,
  getAppointmentProposal,
  getCalendarInvite,
  manageCustomerAppointment,
  normalizeBookingHours,
  processAppointmentReminders,
  respondToAppointment,
  respondToAppointmentProposal,
} = require("../server/appointmentRequests");

function createProofHarness({ calendarBookingMode } = {}) {
  const business = {
    id: 7,
    name: "Tim's Electrical",
    phone: "+19055550001",
    timezone: "America/Toronto",
    settings: { ownerPhone: "+19055550002", ...(calendarBookingMode ? { calendarBookingMode } : {}) },
  };
  let appointment = null;
  const matches = (where = {}) => {
    if (!appointment) return false;
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && Array.isArray(value.in)) return value.in.includes(appointment[key]);
      return appointment[key] === value;
    });
  };
  const withBusiness = () => appointment ? { ...appointment, business } : null;
  const prismaClient = {
    business: {
      findUnique: async ({ where }) => where.id === business.id ? business : null,
    },
    appointmentRequest: {
      findUnique: async ({ where }) => matches(where) ? withBusiness() : null,
      findFirst: async ({ where }) => matches(where) ? withBusiness() : null,
      create: async ({ data }) => {
        appointment = {
          id: "appointment_proof_1",
          status: "PENDING",
          confirmedStart: null,
          ownerNote: null,
          customerNote: null,
          ownerRespondedAt: null,
          customerRespondedAt: null,
          proposalSentAt: null,
          inviteSentAt: null,
          createdAt: new Date("2026-07-22T14:00:00.000Z"),
          updatedAt: new Date("2026-07-22T14:00:00.000Z"),
          ...data,
        };
        return withBusiness();
      },
      update: async ({ where, data }) => {
        if (!matches(where)) throw new Error("Appointment not found in proof harness");
        appointment = { ...appointment, ...data, updatedAt: new Date("2026-07-22T14:05:00.000Z") };
        return withBusiness();
      },
      findMany: async () => appointment ? [withBusiness()] : [],
    },
    staffMember: {
      findFirst: async ({ where }) => where.id === "staff-1" && where.businessId === business.id ? { id: "staff-1", businessId: business.id, name: "Sam", active: true } : null,
    },
  };
  const sms = [];
  const email = [];
  const smsSender = async (message) => {
    sms.push(message);
    return { sent: true, provider: "proof", sid: `sms-${sms.length}` };
  };
  const emailSender = async (message) => {
    email.push(message);
    return { sent: true, messageId: `email-${email.length}` };
  };
  return { prismaClient, smsSender, emailSender, sms, email, getAppointment: withBusiness, setAppointment: (value) => { appointment = { ...appointment, ...value }; } };
}

test("calendar invitation uses a confirmed UTC time and universal ICS fields", () => {
  const calendar = buildCalendarInvite({
    id: "appointment_test_1",
    customerName: "Brian Smith",
    customerPhone: "+19055551234",
    service: "Hot tub wiring",
    address: "23 Robb St, Hamilton",
    requestedStart: new Date("2026-07-24T17:00:00.000Z"),
    confirmedStart: new Date("2026-07-24T18:00:00.000Z"),
    durationMinutes: 90,
    business: { name: "Tim's Electrical" },
  });

  assert.match(calendar, /BEGIN:VCALENDAR\r\n/);
  assert.match(calendar, /METHOD:REQUEST/);
  assert.match(calendar, /ORGANIZER;CN=Tim's Electrical:mailto:bookings@myaipa.ca/);
  assert.match(calendar, /DTSTART:20260724T180000Z/);
  assert.match(calendar, /DTEND:20260724T193000Z/);
  assert.match(calendar, /SUMMARY:Hot tub wiring - Tim's Electrical/);
  assert.match(calendar, /LOCATION:23 Robb St\\, Hamilton/);
  assert.match(calendar, /STATUS:CONFIRMED/);
  assert.match(calendar, /END:VCALENDAR\r\n$/);
});

test("appointment display keeps the business timezone explicit", () => {
  const formatted = formatAppointmentDate("2026-12-10T19:00:00.000Z", "America/Toronto");
  assert.match(formatted, /Thursday, December 10, 2026/);
  assert.match(formatted, /2:00 p\.m\./i);
  assert.match(formatted, /EST/);
});

test("changed time requires customer acceptance before either calendar invitation is sent", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    eventId: "proof-call-1",
    customerName: "Brian Smith",
    customerPhone: "+19055551234",
    customerEmail: "brian@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Hot tub wiring",
    address: "23 Robb St, Hamilton",
    requestedStart: "2026-07-24T14:00:00-04:00",
    durationMinutes: 90,
  }, {
    publicBaseUrl: "https://api.myaipa.ca",
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  assert.equal(requested.status, "PENDING");
  assert.equal(proof.getAppointment().status, "PENDING");
  assert.equal(requested.customerMessage, "Your requested time has been sent to the business. It is not confirmed yet.");
  assert.equal(proof.sms.length, 2);
  assert.match(proof.sms.find((item) => item.to === "+19055551234").message, /not confirmed yet/i);
  assert.match(proof.sms.find((item) => item.to === "+19055550002").message, /owner dashboard/i);

  const proposed = await respondToAppointment({
    appointmentId: requested.appointment.id,
    businessId: 7,
    action: "CONFIRM",
    confirmedStart: "2026-07-24T19:30:00.000Z",
    ownerEmail: "owner@example.com",
    ownerPhone: "+19055550002",
    publicBaseUrl: "https://api.myaipa.ca",
  }, {
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  assert.equal(proposed.appointment.status, "PROPOSED");
  assert.equal(proposed.customerAcceptanceRequired, true);
  assert.equal(proposed.appointment.confirmedStart.toISOString(), "2026-07-24T19:30:00.000Z");
  assert.equal(proposed.appointment.inviteSentAt, null);
  assert.equal(proof.sms.length, 3);
  assert.equal(proof.email.length, 3);
  assert.match(proof.sms[2].message, /Accept it or request another time/i);
  assert.match(proof.sms[2].message, /api\.myaipa\.ca\/api\/appointments\/.+\/proposal\?token=/);
  assert.equal(proof.email[2].calendar, undefined);
  await assert.rejects(
    () => getCalendarInvite({ appointmentId: proposed.appointment.id, token: proposed.appointment.calendarToken }, { prismaClient: proof.prismaClient }),
    /not confirmed/i,
  );

  const review = await getAppointmentProposal({
    appointmentId: proposed.appointment.id,
    token: proposed.appointment.calendarToken,
  }, { prismaClient: proof.prismaClient });
  assert.equal(review.status, "PROPOSED");

  const confirmed = await respondToAppointmentProposal({
    appointmentId: proposed.appointment.id,
    token: proposed.appointment.calendarToken,
    action: "ACCEPT",
    publicBaseUrl: "https://api.myaipa.ca",
  }, {
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  assert.equal(confirmed.appointment.status, "CONFIRMED");
  assert.ok(confirmed.appointment.customerRespondedAt instanceof Date);
  assert.ok(confirmed.appointment.inviteSentAt instanceof Date);
  assert.equal(proof.sms.length, 5);
  assert.equal(proof.email.length, 5);
  const confirmationSms = proof.sms.slice(3);
  assert.ok(confirmationSms.every((item) => /Confirmed:/.test(item.message)));
  assert.ok(confirmationSms.every((item) => /api\.myaipa\.ca\/api\/appointments\/.+\.ics|api\.myaipa\.ca\/api\/appointments\//.test(item.message)));
  const confirmationEmail = proof.email.slice(3);
  assert.ok(confirmationEmail.every((item) => item.calendar?.includes("DTSTART:20260724T193000Z")));

  const downloaded = await getCalendarInvite({
    appointmentId: confirmed.appointment.id,
    token: confirmed.appointment.calendarToken,
  }, { prismaClient: proof.prismaClient });
  assert.match(downloaded.calendar, /DTSTART:20260724T193000Z/);
  assert.match(downloaded.calendar, /DTEND:20260724T210000Z/);
  assert.match(downloaded.calendar, /SUMMARY:Hot tub wiring - Tim's Electrical/);
});

test("accepting the customer's requested time confirms immediately", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    eventId: "proof-call-same-time",
    customerName: "Alex Lee",
    customerPhone: "+19055551234",
    customerEmail: "alex@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Panel inspection",
    requestedStart: "2026-07-27T10:00:00-04:00",
  }, {
    publicBaseUrl: "https://api.myaipa.ca",
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  const confirmed = await respondToAppointment({
    appointmentId: requested.appointment.id,
    businessId: 7,
    action: "CONFIRM",
    confirmedStart: requested.appointment.requestedStart.toISOString(),
    publicBaseUrl: "https://api.myaipa.ca",
  }, {
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  assert.equal(confirmed.appointment.status, "CONFIRMED");
  assert.equal(confirmed.customerAcceptanceRequired, false);
  assert.ok(confirmed.appointment.inviteSentAt instanceof Date);
  assert.equal(proof.email.filter((item) => item.calendar).length, 2);
});

test("automatic mode books immediately only when a connected owner calendar is clear", async () => {
  const proof = createProofHarness({ calendarBookingMode: "AUTO_BOOK_CONNECTED" });
  const syncCalls = [];
  const result = await createAppointmentRequest({
    businessId: 7,
    eventId: "proof-auto-book",
    customerName: "Morgan Patel",
    customerPhone: "+19055551234",
    customerEmail: "morgan@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Emergency wiring",
    requestedStart: "2026-07-27T10:00:00-04:00",
  }, {
    publicBaseUrl: "https://api.myaipa.ca",
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
    availabilityFinder: async () => ({ connection: { id: "calendar-1", staffMemberId: null }, busy: false, hadConnections: true }),
    calendarSyncer: async (appointment) => { syncCalls.push(appointment.id); return { ok: true, provider: "GOOGLE" }; },
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.autoBooked, true);
  assert.equal(result.appointment.status, "CONFIRMED");
  assert.equal(syncCalls.length, 1);
  assert.match(proof.sms.find((item) => item.to === "+19055551234").message, /^Confirmed:/);
});

test("customer can request another time without creating a calendar event", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    eventId: "proof-call-change-request",
    customerName: "Jordan Patel",
    customerPhone: "+19055551234",
    customerEmail: "jordan@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Service call",
    requestedStart: "2026-07-27T10:00:00-04:00",
  }, {
    publicBaseUrl: "https://api.myaipa.ca",
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });
  const proposed = await respondToAppointment({
    appointmentId: requested.appointment.id,
    businessId: 7,
    action: "CONFIRM",
    confirmedStart: "2026-07-27T17:00:00.000Z",
    publicBaseUrl: "https://api.myaipa.ca",
  }, {
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });
  const response = await respondToAppointmentProposal({
    appointmentId: proposed.appointment.id,
    token: proposed.appointment.calendarToken,
    action: "REQUEST_CHANGE",
    customerNote: "Any weekday after 3 PM",
    publicBaseUrl: "https://api.myaipa.ca",
  }, {
    prismaClient: proof.prismaClient,
    smsSender: proof.smsSender,
    emailSender: proof.emailSender,
  });

  assert.equal(response.appointment.status, "CHANGE_REQUESTED");
  assert.equal(response.appointment.customerNote, "Any weekday after 3 PM");
  assert.equal(response.appointment.inviteSentAt, null);
  assert.equal(proof.email.filter((item) => item.calendar).length, 0);
  assert.match(proof.sms.at(-1).message, /requested another time/i);
});

test("availability rules block closed hours and conflicting staff bookings", async () => {
  const settings = { bookingHours: normalizeBookingHours(), appointmentBufferMinutes: 15 };
  const conflict = {
    id: "existing",
    status: "CONFIRMED",
    confirmedStart: new Date("2026-07-27T14:30:00.000Z"),
    requestedStart: new Date("2026-07-27T14:30:00.000Z"),
    durationMinutes: 60,
    staffMemberId: "staff-1",
    customerName: "Existing customer",
  };
  const prismaClient = {
    appointmentRequest: { findMany: async () => [conflict] },
    staffMember: { findFirst: async ({ where }) => ({ id: where.id, businessId: where.businessId, active: true }) },
  };

  await assert.rejects(() => assertScheduleAvailable({ businessId: 7, appointmentId: "new", start: new Date("2026-07-26T14:00:00.000Z"), durationMinutes: 60, timezone: "America/Toronto", staffMemberId: "staff-1", settings }, { prismaClient }), /outside your/i);
  await assert.rejects(() => assertScheduleAvailable({ businessId: 7, appointmentId: "new", start: new Date("2026-07-27T14:00:00.000Z"), durationMinutes: 60, timezone: "America/Toronto", staffMemberId: "staff-1", settings }, { prismaClient }), /conflicts with Existing customer/i);
  await assert.doesNotReject(() => assertScheduleAvailable({ businessId: 7, appointmentId: "new", start: new Date("2026-07-27T14:00:00.000Z"), durationMinutes: 60, timezone: "America/Toronto", staffMemberId: "staff-2", settings }, { prismaClient }));
});

test("automatic reminders send once at the two-hour window", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    customerName: "Reminder Customer",
    customerPhone: "+19055551234",
    customerEmail: "reminder@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Furnace repair",
    requestedStart: "2030-07-25T10:00:00-04:00",
  }, { prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });
  const now = new Date("2030-07-25T12:30:00.000Z");
  proof.setAppointment({ status: "CONFIRMED", confirmedStart: new Date("2030-07-25T14:00:00.000Z") });

  const first = await processAppointmentReminders({ now, publicBaseUrl: "https://api.myaipa.ca", prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });
  const second = await processAppointmentReminders({ now, publicBaseUrl: "https://api.myaipa.ca", prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });
  assert.equal(requested.appointment.id, proof.getAppointment().id);
  assert.equal(first[0].reminderHours, 2);
  assert.equal(second.length, 0);
  assert.ok(proof.getAppointment().reminder2hSentAt instanceof Date);
  assert.match(proof.sms.at(-2).message, /in about 2 hours/i);
  assert.match(proof.sms.at(-2).message, /reschedule or cancel/i);
});

test("customer self-service reschedule removes confirmation and returns it to owner review", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    customerName: "Reschedule Customer",
    customerPhone: "+19055551234",
    customerEmail: "reschedule@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Service call",
    requestedStart: "2030-07-25T10:00:00-04:00",
  }, { prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });
  proof.setAppointment({ status: "CONFIRMED", confirmedStart: new Date("2030-07-25T14:00:00.000Z"), inviteSentAt: new Date() });

  const result = await manageCustomerAppointment({
    appointmentId: requested.appointment.id,
    token: requested.appointment.calendarToken,
    action: "RESCHEDULE",
    requestedStart: "2030-07-26T15:30",
    customerNote: "Afternoon please",
    publicBaseUrl: "https://api.myaipa.ca",
  }, { prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });

  assert.equal(result.appointment.status, "CHANGE_REQUESTED");
  assert.equal(result.appointment.confirmedStart, null);
  assert.equal(result.appointment.inviteSentAt, null);
  assert.equal(result.appointment.customerNote, "Afternoon please");
  assert.match(proof.sms.at(-1).message, /requested to move/i);
});

test("customer self-service cancellation closes the appointment and sends a cancellation calendar update", async () => {
  const proof = createProofHarness();
  const requested = await createAppointmentRequest({
    businessId: 7,
    customerName: "Cancel Customer",
    customerPhone: "+19055551234",
    customerEmail: "cancel@example.com",
    ownerPhone: "+19055550002",
    ownerEmail: "owner@example.com",
    service: "Service call",
    requestedStart: "2030-07-25T10:00:00-04:00",
  }, { prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });
  proof.setAppointment({ status: "CONFIRMED", confirmedStart: new Date("2030-07-25T14:00:00.000Z"), inviteSentAt: new Date() });

  const result = await manageCustomerAppointment({
    appointmentId: requested.appointment.id,
    token: requested.appointment.calendarToken,
    action: "CANCEL",
    publicBaseUrl: "https://api.myaipa.ca",
  }, { prismaClient: proof.prismaClient, smsSender: proof.smsSender, emailSender: proof.emailSender });

  assert.equal(result.appointment.status, "CANCELLED");
  assert.ok(result.appointment.cancelledAt instanceof Date);
  assert.match(proof.email.at(-1).calendar, /METHOD:CANCEL/);
  assert.match(proof.email.at(-1).calendar, /STATUS:CANCELLED/);
});
