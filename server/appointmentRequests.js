const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { prisma } = require("./prisma");
const { sendSmsViaTwilio } = require("./twilioSms");
const {
  cancelAppointmentCalendarEvent,
  findAvailableConnection,
  syncAppointmentToCalendar,
} = require("./calendarIntegrations");

const DEFAULT_TIMEZONE = "America/Toronto";
const ACTIVE_BOOKING_STATUSES = ["PROPOSED", "CONFIRMED"];
const DEFAULT_BOOKING_HOURS = Object.freeze({
  monday: { enabled: true, start: "08:00", end: "17:00" },
  tuesday: { enabled: true, start: "08:00", end: "17:00" },
  wednesday: { enabled: true, start: "08:00", end: "17:00" },
  thursday: { enabled: true, start: "08:00", end: "17:00" },
  friday: { enabled: true, start: "08:00", end: "17:00" },
  saturday: { enabled: false, start: "08:00", end: "17:00" },
  sunday: { enabled: false, start: "08:00", end: "17:00" },
});

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function optionalEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError("customerEmail must be a valid email address.");
  return email;
}

function parseStart(payload) {
  const direct = payload.requestedStart || payload.preferredStart || payload.appointmentStart || payload.requestedDateTime || payload.preferredDateTime;
  const combined = payload.requestedDate && payload.requestedTime
    ? `${payload.requestedDate}T${payload.requestedTime}`
    : "";
  const raw = direct || combined;
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) {
    throw httpError("requestedStart must be a valid date and time, preferably with a UTC offset.");
  }
  return date;
}

function normalizeTimezone(value) {
  const timezone = clean(value || DEFAULT_TIMEZONE, 80) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    throw httpError("timezone must be a valid IANA timezone, such as America/Toronto.");
  }
}

function normalizeClock(value, fallback) {
  const raw = clean(value, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) return fallback;
  return raw;
}

function normalizeBookingHours(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_BOOKING_HOURS).map(([day, defaults]) => {
    const candidate = input[day] && typeof input[day] === "object" ? input[day] : {};
    return [day, {
      enabled: candidate.enabled == null ? defaults.enabled : Boolean(candidate.enabled),
      start: normalizeClock(candidate.start, defaults.start),
      end: normalizeClock(candidate.end, defaults.end),
    }];
  }));
}

function getLocalScheduleParts(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: String(values.weekday || "").toLowerCase(),
    minutes: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

function parseClockMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function parseLocalDateTime(value, timezone) {
  const raw = clean(value, 40);
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) {
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw httpError("Choose a valid date and time.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desiredUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    candidate = new Date(candidate.getTime() + desiredUtc - representedUtc);
  }
  return candidate;
}

function getSchedulingSettings(settings = {}) {
  return {
    bookingHours: normalizeBookingHours(settings.bookingHours),
    bufferMinutes: Math.max(0, Math.min(180, Number(settings.appointmentBufferMinutes ?? 15) || 0)),
    reminderHours: Array.isArray(settings.reminderHours)
      ? settings.reminderHours.map(Number).filter((hours) => [2, 24].includes(hours))
      : [24, 2],
    calendarBookingMode: ["MANUAL_APPROVAL", "AUTO_BOOK_CONNECTED", "EMAIL_INVITES_ONLY"].includes(settings.calendarBookingMode)
      ? settings.calendarBookingMode
      : "MANUAL_APPROVAL",
  };
}

async function assertScheduleAvailable({ businessId, appointmentId, start, durationMinutes, timezone, staffMemberId, settings }, { prismaClient = prisma } = {}) {
  const scheduling = getSchedulingSettings(settings);
  const localStart = getLocalScheduleParts(start, timezone);
  const localEnd = getLocalScheduleParts(new Date(start.getTime() + durationMinutes * 60000), timezone);
  const dayHours = scheduling.bookingHours[localStart.day];
  const openMinutes = parseClockMinutes(dayHours?.start);
  const closeMinutes = parseClockMinutes(dayHours?.end);
  if (!dayHours?.enabled || localStart.day !== localEnd.day || localStart.minutes < openMinutes || localEnd.minutes > closeMinutes) {
    throw httpError(`That time is outside your ${dayHours?.start || "closed"}–${dayHours?.end || "closed"} ${localStart.day || "business day"} booking hours.`, 409);
  }

  if (staffMemberId) {
    const staff = await prismaClient.staffMember.findFirst({ where: { id: String(staffMemberId), businessId: Number(businessId), active: true } });
    if (!staff) throw httpError("Choose an active team member for this appointment.", 409);
  }

  const activeAppointments = await prismaClient.appointmentRequest.findMany({
    where: { businessId: Number(businessId), status: { in: ACTIVE_BOOKING_STATUSES } },
    select: { id: true, confirmedStart: true, requestedStart: true, durationMinutes: true, staffMemberId: true, customerName: true },
  });
  const requestedStart = start.getTime();
  const requestedEnd = requestedStart + durationMinutes * 60000;
  const bufferMs = scheduling.bufferMinutes * 60000;
  const conflict = activeAppointments.find((existing) => {
    if (existing.id === appointmentId) return false;
    if (staffMemberId && existing.staffMemberId && existing.staffMemberId !== staffMemberId) return false;
    const existingStart = new Date(existing.confirmedStart || existing.requestedStart).getTime();
    const existingEnd = existingStart + Number(existing.durationMinutes || 60) * 60000;
    return requestedStart < existingEnd + bufferMs && requestedEnd + bufferMs > existingStart;
  });
  if (conflict) {
    throw httpError(`That time conflicts with ${conflict.customerName || "another appointment"}, including your ${scheduling.bufferMinutes}-minute travel buffer.`, 409);
  }
  return scheduling;
}

function formatAppointmentDate(value, timezone = DEFAULT_TIMEZONE) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function escapeCalendarText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsUtc(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldCalendarLine(line) {
  const chunks = [];
  let remaining = String(line);
  while (Buffer.byteLength(remaining, "utf8") > 73) {
    let cut = Math.min(73, remaining.length);
    while (cut > 1 && Buffer.byteLength(remaining.slice(0, cut), "utf8") > 73) cut -= 1;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function buildCalendarInvite(appointment) {
  const start = new Date(appointment.confirmedStart || appointment.requestedStart);
  const end = new Date(start.getTime() + Number(appointment.durationMinutes || 60) * 60 * 1000);
  const businessName = appointment.business?.name || "the business";
  const description = [
    `Confirmed by ${businessName}.`,
    appointment.service ? `Service: ${appointment.service}` : "",
    appointment.customerName ? `Customer: ${appointment.customerName}` : "",
    appointment.customerPhone ? `Phone: ${appointment.customerPhone}` : "",
    appointment.staffMember?.name ? `Assigned to: ${appointment.staffMember.name}` : "",
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//My AI PA//Confirmed Appointment//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeCalendarText(appointment.id)}@myaipa.ca`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `ORGANIZER;CN=${escapeCalendarText(businessName)}:mailto:${escapeCalendarText(appointment.ownerEmail || "bookings@myaipa.ca")}`,
    appointment.customerEmail ? `ATTENDEE;CN=${escapeCalendarText(appointment.customerName)};RSVP=TRUE:mailto:${escapeCalendarText(appointment.customerEmail)}` : "",
    `SUMMARY:${escapeCalendarText(`${appointment.service} - ${businessName}`)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    appointment.address ? `LOCATION:${escapeCalendarText(appointment.address)}` : "",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}

function buildCancellationInvite(appointment) {
  return buildCalendarInvite(appointment)
    .replace("METHOD:REQUEST", "METHOD:CANCEL")
    .replace("STATUS:CONFIRMED", "STATUS:CANCELLED");
}

function getEmailConfig() {
  const host = clean(process.env.SMTP_HOST, 300);
  const from = clean(process.env.EMAIL_FROM || process.env.SMTP_FROM, 300);
  if (!host || !from) return null;
  const user = clean(process.env.SMTP_USER, 300);
  const pass = String(process.env.SMTP_PASS || "");
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    from,
    transport: {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure: /^(1|true|yes|on)$/i.test(String(process.env.SMTP_SECURE || "")),
      auth: user || pass ? { user, pass } : undefined,
    },
  };
}

async function sendEmail({ to, subject, text, calendar }) {
  if (!to) return { skipped: true, reason: "no_email" };
  const config = getEmailConfig();
  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[appointments:email] SMTP is not configured; email was not sent.", { to, subject });
    }
    return { skipped: true, reason: "smtp_not_configured" };
  }
  const transporter = nodemailer.createTransport(config.transport);
  const attachments = calendar ? [{
    filename: "confirmed-appointment.ics",
    content: calendar,
    contentType: `text/calendar; charset=utf-8; method=${/METHOD:CANCEL/.test(calendar) ? "CANCEL" : "REQUEST"}`,
  }] : [];
  const result = await transporter.sendMail({ from: config.from, to, subject, text, attachments });
  return { sent: true, messageId: result.messageId || "" };
}

async function attemptNotification(label, task) {
  try {
    return { label, ok: true, result: await task() };
  } catch (error) {
    console.error("[appointments:notification] delivery failed", { label, message: error?.message || String(error) });
    return { label, ok: false, error: error?.message || "Delivery failed" };
  }
}

function getCalendarUrl(appointment, publicBaseUrl) {
  const base = clean(publicBaseUrl, 1000).replace(/\/+$/, "");
  return `${base}/api/appointments/${encodeURIComponent(appointment.id)}/calendar?token=${encodeURIComponent(appointment.calendarToken)}`;
}

function getProposalUrl(appointment, publicBaseUrl) {
  const base = clean(publicBaseUrl, 1000).replace(/\/+$/, "");
  return `${base}/api/appointments/${encodeURIComponent(appointment.id)}/proposal?token=${encodeURIComponent(appointment.calendarToken)}`;
}

function getManageUrl(appointment, publicBaseUrl) {
  const base = clean(publicBaseUrl, 1000).replace(/\/+$/, "");
  return `${base}/api/appointments/${encodeURIComponent(appointment.id)}/manage?token=${encodeURIComponent(appointment.calendarToken)}`;
}

function getOwnerDashboardUrl(publicBaseUrl) {
  const configured = clean(process.env.FRONTEND_APP_URL || process.env.WEBSITE_URL, 1000).replace(/\/+$/, "");
  if (configured) return `${configured}/#/dashboard`;
  if (process.env.NODE_ENV === "production") return "https://www.myaipa.ca/#/dashboard";
  const local = clean(publicBaseUrl, 1000).replace(/\/+$/, "").replace(/:(?:8787|8799)$/, ":3000");
  return `${local || "http://localhost:3000"}/#/dashboard`;
}

async function createAppointmentRequest(payload = {}, {
  publicBaseUrl = "",
  prismaClient = prisma,
  smsSender = sendSmsViaTwilio,
  emailSender = sendEmail,
  availabilityFinder = findAvailableConnection,
  calendarSyncer = syncAppointmentToCalendar,
} = {}) {
  const businessId = Number(payload.businessId || 1);
  if (!Number.isInteger(businessId) || businessId <= 0) throw httpError("businessId must be a positive integer.");
  const business = await prismaClient.business.findUnique({ where: { id: businessId }, include: { settings: true } });
  if (!business) throw httpError(`Business ${businessId} was not found.`, 404);

  const sourceEventId = clean(payload.sourceEventId || payload.eventId || payload.id, 180) || null;
  if (sourceEventId) {
    const existing = await prismaClient.appointmentRequest.findUnique({ where: { sourceEventId }, include: { business: true } });
    if (existing) return { ok: true, duplicate: true, status: existing.status, appointment: existing };
  }

  const customerName = clean(payload.customerName || payload.callerName || payload.name, 120) || "Customer";
  const customerPhone = clean(payload.customerPhone || payload.callerPhone || payload.callbackNumber || payload.rawPhoneNumber, 40);
  if (!customerPhone) throw httpError("customerPhone is required.");
  const customerEmail = optionalEmail(payload.customerEmail || payload.callerEmail || payload.email);
  const service = clean(payload.service || payload.serviceRequested || payload.jobDetails || payload.summary || payload.reason, 500);
  if (!service) throw httpError("service is required.");
  const address = clean(payload.address || [payload.streetAddress, payload.city].filter(Boolean).join(", "), 500) || null;
  const timezone = normalizeTimezone(payload.timezone || business.timezone);
  const requestedStart = parseStart(payload);
  const durationMinutes = Math.max(15, Math.min(480, Number(payload.durationMinutes || 60) || 60));
  const callId = Number(payload.callId || 0) || null;
  const ownerPhone = clean(payload.ownerPhone || business.settings?.ownerPhone, 40) || null;
  const ownerEmail = optionalEmail(payload.ownerEmail);

  const appointment = await prismaClient.appointmentRequest.create({
    data: {
      businessId,
      callId,
      sourceEventId,
      customerName,
      customerEmail,
      customerPhone,
      ownerEmail,
      ownerPhone,
      service,
      address,
      requestedStart,
      durationMinutes,
      timezone,
      calendarToken: crypto.randomBytes(24).toString("base64url"),
    },
    include: { business: true },
  });

  const scheduling = getSchedulingSettings(business.settings || {});
  if (scheduling.calendarBookingMode === "AUTO_BOOK_CONNECTED") {
    const end = new Date(requestedStart.getTime() + durationMinutes * 60000);
    try {
      await assertScheduleAvailable({
        businessId,
        appointmentId: appointment.id,
        start: requestedStart,
        durationMinutes,
        timezone,
        staffMemberId: null,
        settings: business.settings,
      }, { prismaClient });
      const bufferMs = scheduling.bufferMinutes * 60000;
      const availability = await availabilityFinder({
        businessId,
        staffMemberId: null,
        start: new Date(requestedStart.getTime() - bufferMs),
        end: new Date(end.getTime() + bufferMs),
      }, { prismaClient });
      if (availability.connection) {
        const confirmed = await prismaClient.appointmentRequest.update({
          where: { id: appointment.id },
          data: {
            status: "CONFIRMED",
            confirmedStart: requestedStart,
            staffMemberId: availability.connection.staffMemberId || null,
            ownerRespondedAt: new Date(),
            customerRespondedAt: new Date(),
          },
          include: { business: true, staffMember: true, externalEvent: true },
        });
        const confirmation = await sendConfirmedNotifications(confirmed, {
          publicBaseUrl,
          prismaClient,
          smsSender,
          emailSender,
          ownerEmail,
          ownerPhone,
          calendarBookingMode: scheduling.calendarBookingMode,
          calendarSyncer,
        });
        return {
          ok: true,
          status: "CONFIRMED",
          autoBooked: true,
          ...confirmation,
          customerMessage: "Your appointment is confirmed.",
        };
      }
    } catch (error) {
      if (Number(error?.statusCode || 500) !== 409) throw error;
    }
  }

  const when = formatAppointmentDate(requestedStart, timezone);
  const dashboardUrl = getOwnerDashboardUrl(publicBaseUrl);
  const ownerMessage = `New appointment request from ${customerName}: ${service}, ${when}. Review and confirm it in your My AI PA owner dashboard: ${dashboardUrl}`;
  const customerMessage = `My AI PA: Your requested time with ${business.name} for ${when} was sent to the business. It is not confirmed yet.`;
  const notifications = await Promise.all([
    ownerPhone ? attemptNotification("owner_sms", () => smsSender({ to: ownerPhone, message: ownerMessage })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
    customerPhone ? attemptNotification("customer_sms", () => smsSender({ to: customerPhone, message: customerMessage })) : Promise.resolve({ label: "customer_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
    attemptNotification("owner_email", () => emailSender({ to: ownerEmail, subject: `Appointment request from ${customerName}`, text: `${ownerMessage}\n\nCustomer phone: ${customerPhone}${address ? `\nAddress: ${address}` : ""}` })),
    attemptNotification("customer_email", () => emailSender({ to: customerEmail, subject: `Your requested time was sent to ${business.name}`, text: `${customerMessage}\n\nThe business will confirm or contact you if the time needs to change.` })),
  ]);

  return {
    ok: true,
    status: "PENDING",
    appointment,
    notifications,
    customerMessage: "Your requested time has been sent to the business. It is not confirmed yet.",
  };
}

async function sendConfirmedNotifications(appointment, {
  publicBaseUrl = "",
  prismaClient = prisma,
  smsSender = sendSmsViaTwilio,
  emailSender = sendEmail,
  ownerEmail,
  ownerPhone,
  calendarBookingMode = "MANUAL_APPROVAL",
  calendarSyncer = syncAppointmentToCalendar,
} = {}) {
  const calendar = buildCalendarInvite(appointment);
  const calendarUrl = getCalendarUrl(appointment, publicBaseUrl);
  const manageUrl = getManageUrl(appointment, publicBaseUrl);
  const when = formatAppointmentDate(appointment.confirmedStart || appointment.requestedStart, appointment.timezone);
  const assignment = appointment.staffMember?.name ? ` Assigned to ${appointment.staffMember.name}.` : "";
  const message = `Confirmed: ${appointment.service} with ${appointment.business.name} on ${when}.${assignment} Add it to Google, Outlook, Hotmail, or Apple Calendar: ${calendarUrl} Reschedule or cancel: ${manageUrl}`;
  const ownerMessage = `Confirmed: ${appointment.customerName} - ${appointment.service}, ${when}.${assignment} Add to your calendar: ${calendarUrl}`;
  const resolvedOwnerPhone = clean(ownerPhone || appointment.ownerPhone || appointment.business.settings?.ownerPhone, 40);
  const resolvedOwnerEmail = optionalEmail(ownerEmail || appointment.ownerEmail);
  const notifications = await Promise.all([
    attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message })),
    resolvedOwnerPhone ? attemptNotification("owner_sms", () => smsSender({ to: resolvedOwnerPhone, message: ownerMessage })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
    attemptNotification("customer_email", () => emailSender({ to: appointment.customerEmail, subject: `Confirmed appointment with ${appointment.business.name}`, text: message, calendar })),
    attemptNotification("owner_email", () => emailSender({ to: resolvedOwnerEmail, subject: `Confirmed: ${appointment.customerName} - ${appointment.service}`, text: ownerMessage, calendar })),
    appointment.staffMember?.phone && appointment.staffMember.phone !== resolvedOwnerPhone
      ? attemptNotification("staff_sms", () => smsSender({ to: appointment.staffMember.phone, message: ownerMessage }))
      : Promise.resolve({ label: "staff_sms", ok: true, result: { skipped: true, reason: "same_or_no_phone" } }),
    appointment.staffMember?.email && appointment.staffMember.email !== resolvedOwnerEmail
      ? attemptNotification("staff_email", () => emailSender({ to: appointment.staffMember.email, subject: `Assigned: ${appointment.customerName} - ${appointment.service}`, text: ownerMessage, calendar }))
      : Promise.resolve({ label: "staff_email", ok: true, result: { skipped: true, reason: "same_or_no_email" } }),
  ]);
  const delivered = notifications.some((item) => item.ok && !item.result?.skipped);
  const saved = delivered
    ? await prismaClient.appointmentRequest.update({ where: { id: appointment.id }, data: { inviteSentAt: new Date() }, include: { business: true, staffMember: true, externalEvent: true } })
    : appointment;
  const calendarSync = calendarBookingMode === "EMAIL_INVITES_ONLY"
    ? { ok: false, skipped: true, reason: "email_invites_only" }
    : await calendarSyncer(saved, { prismaClient });
  return { appointment: saved, calendarUrl, manageUrl, notifications, calendarSync };
}

async function respondToAppointment({ appointmentId, businessId, action, confirmedStart, ownerNote, ownerEmail, ownerPhone, staffMemberId, publicBaseUrl }, {
  prismaClient = prisma,
  smsSender = sendSmsViaTwilio,
  emailSender = sendEmail,
  availabilityFinder = findAvailableConnection,
  calendarSyncer = syncAppointmentToCalendar,
} = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: { id: String(appointmentId), businessId: Number(businessId) },
    include: { business: { include: { settings: true } } },
  });
  if (!appointment) throw httpError("Appointment request was not found.", 404);
  const normalizedAction = clean(action, 20).toUpperCase();
  if (!["CONFIRM", "DECLINE"].includes(normalizedAction)) throw httpError("action must be CONFIRM or DECLINE.");
  if (!["PENDING", "CHANGE_REQUESTED"].includes(appointment.status)) {
    return { ok: true, unchanged: true, appointment, notifications: [] };
  }

  if (normalizedAction === "DECLINE") {
    const declined = await prismaClient.appointmentRequest.update({
      where: { id: appointment.id },
      data: {
        status: "DECLINED",
        ownerNote: clean(ownerNote, 500) || null,
        ownerEmail: optionalEmail(ownerEmail || appointment.ownerEmail),
        ownerPhone: clean(ownerPhone || appointment.ownerPhone, 40) || null,
        ownerRespondedAt: new Date(),
      },
      include: { business: true },
    });
    const when = formatAppointmentDate(appointment.requestedStart, appointment.timezone);
    const message = `My AI PA: ${appointment.business.name} could not confirm your requested time for ${when}. Please call or reply to arrange another time.`;
    const notifications = await Promise.all([
      attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message })),
      attemptNotification("customer_email", () => emailSender({ to: appointment.customerEmail, subject: `Update from ${appointment.business.name}`, text: message })),
    ]);
    return { ok: true, appointment: declined, notifications };
  }

  const start = confirmedStart ? new Date(confirmedStart) : new Date(appointment.requestedStart);
  if (Number.isNaN(start.getTime())) throw httpError("confirmedStart must be a valid date and time.");
  let assignedStaffId = staffMemberId === undefined
    ? clean(appointment.staffMemberId, 100) || null
    : clean(staffMemberId, 100) || null;
  await assertScheduleAvailable({
    businessId: appointment.businessId,
    appointmentId: appointment.id,
    start,
    durationMinutes: appointment.durationMinutes,
    timezone: appointment.timezone,
    staffMemberId: assignedStaffId,
    settings: appointment.business.settings,
  }, { prismaClient });
  const scheduling = getSchedulingSettings(appointment.business.settings || {});
  if (scheduling.calendarBookingMode !== "EMAIL_INVITES_ONLY") {
    const end = new Date(start.getTime() + Number(appointment.durationMinutes || 60) * 60000);
    const bufferMs = scheduling.bufferMinutes * 60000;
    const availability = await availabilityFinder({
      businessId: appointment.businessId,
      staffMemberId: assignedStaffId,
      start: new Date(start.getTime() - bufferMs),
      end: new Date(end.getTime() + bufferMs),
    }, { prismaClient });
    if (availability.hadConnections && !availability.connection) {
      throw httpError("That time conflicts with the connected calendar. Choose another time or use email/manual booking.", 409);
    }
    if (!assignedStaffId && availability.connection?.staffMemberId) assignedStaffId = availability.connection.staffMemberId;
  }
  const changedTime = appointment.status === "CHANGE_REQUESTED"
    || start.getTime() !== new Date(appointment.requestedStart).getTime();
  const ownerContact = {
    ownerEmail: optionalEmail(ownerEmail || appointment.ownerEmail),
    ownerPhone: clean(ownerPhone || appointment.ownerPhone || appointment.business.settings?.ownerPhone, 40) || null,
  };
  const saved = await prismaClient.appointmentRequest.update({
    where: { id: appointment.id },
    data: {
      status: changedTime ? "PROPOSED" : "CONFIRMED",
      confirmedStart: start,
      ownerNote: clean(ownerNote, 500) || null,
      ownerEmail: ownerContact.ownerEmail,
      ownerPhone: ownerContact.ownerPhone,
      staffMemberId: assignedStaffId,
      ownerRespondedAt: new Date(),
      proposalSentAt: changedTime ? new Date() : null,
      customerRespondedAt: changedTime ? null : appointment.customerRespondedAt,
      customerNote: changedTime ? null : appointment.customerNote,
    },
    include: { business: true, staffMember: true, externalEvent: true },
  });

  if (!changedTime) {
    const confirmation = await sendConfirmedNotifications(saved, {
      publicBaseUrl,
      prismaClient,
      smsSender,
      emailSender,
      ...ownerContact,
      calendarBookingMode: scheduling.calendarBookingMode,
      calendarSyncer,
    });
    return { ok: true, ...confirmation, customerAcceptanceRequired: false };
  }

  const proposalUrl = getProposalUrl(saved, publicBaseUrl);
  const when = formatAppointmentDate(start, appointment.timezone);
  const proposalMessage = `New time proposed by ${appointment.business.name}: ${when} for ${appointment.service}. Accept it or request another time here: ${proposalUrl}`;
  const notifications = await Promise.all([
    attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message: proposalMessage })),
    attemptNotification("customer_email", () => emailSender({
      to: appointment.customerEmail,
      subject: `${appointment.business.name} proposed a new appointment time`,
      text: `${proposalMessage}\n\nThis appointment is not confirmed until you accept the new time.`,
    })),
  ]);
  return { ok: true, appointment: saved, proposalUrl, notifications, customerAcceptanceRequired: true };
}

async function getAppointmentProposal({ appointmentId, token }, { prismaClient = prisma } = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: { id: String(appointmentId), calendarToken: String(token || ""), status: "PROPOSED" },
    include: { business: true },
  });
  if (!appointment) throw httpError("This appointment proposal is invalid or is no longer awaiting approval.", 404);
  return appointment;
}

async function respondToAppointmentProposal({ appointmentId, token, action, customerNote, publicBaseUrl }, {
  prismaClient = prisma,
  smsSender = sendSmsViaTwilio,
  emailSender = sendEmail,
  calendarSyncer = syncAppointmentToCalendar,
} = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: { id: String(appointmentId), calendarToken: String(token || ""), status: "PROPOSED" },
    include: { business: { include: { settings: true } } },
  });
  if (!appointment) throw httpError("This appointment proposal is invalid or has already been answered.", 404);
  const normalizedAction = clean(action, 30).toUpperCase();
  if (!["ACCEPT", "REQUEST_CHANGE"].includes(normalizedAction)) {
    throw httpError("action must be ACCEPT or REQUEST_CHANGE.");
  }

  if (normalizedAction === "ACCEPT") {
    const confirmed = await prismaClient.appointmentRequest.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED", customerNote: null, customerRespondedAt: new Date() },
      include: { business: true, staffMember: true, externalEvent: true },
    });
    const confirmation = await sendConfirmedNotifications(confirmed, {
      publicBaseUrl,
      prismaClient,
      smsSender,
      emailSender,
      ownerEmail: appointment.ownerEmail,
      ownerPhone: appointment.ownerPhone,
      calendarBookingMode: getSchedulingSettings(appointment.business.settings || {}).calendarBookingMode,
      calendarSyncer,
    });
    return { ok: true, action: normalizedAction, ...confirmation };
  }

  const note = clean(customerNote, 500) || null;
  const requestedChange = await prismaClient.appointmentRequest.update({
    where: { id: appointment.id },
    data: { status: "CHANGE_REQUESTED", customerNote: note, customerRespondedAt: new Date() },
    include: { business: true, staffMember: true },
  });
  const dashboardUrl = getOwnerDashboardUrl(publicBaseUrl);
  const ownerMessage = `${appointment.customerName} requested another time for ${appointment.service}.${note ? ` Note: ${note}` : ""} Review it in your My AI PA owner dashboard: ${dashboardUrl}`;
  const notifications = await Promise.all([
    appointment.ownerPhone ? attemptNotification("owner_sms", () => smsSender({ to: appointment.ownerPhone, message: ownerMessage })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
    attemptNotification("owner_email", () => emailSender({ to: appointment.ownerEmail, subject: `${appointment.customerName} requested another appointment time`, text: ownerMessage })),
  ]);
  return { ok: true, action: normalizedAction, appointment: requestedChange, notifications };
}

async function getManagedAppointment({ appointmentId, token }, { prismaClient = prisma } = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: {
      id: String(appointmentId),
      calendarToken: String(token || ""),
      status: { in: ["CONFIRMED", "PROPOSED"] },
    },
    include: { business: true, staffMember: true },
  });
  if (!appointment) throw httpError("This appointment link is invalid or is no longer active.", 404);
  return appointment;
}

async function manageCustomerAppointment({ appointmentId, token, action, requestedStart, customerNote, publicBaseUrl }, {
  prismaClient = prisma,
  smsSender = sendSmsViaTwilio,
  emailSender = sendEmail,
  calendarCanceller = cancelAppointmentCalendarEvent,
} = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: {
      id: String(appointmentId),
      calendarToken: String(token || ""),
      status: { in: ["CONFIRMED", "PROPOSED"] },
    },
    include: { business: { include: { settings: true } }, staffMember: true, externalEvent: { include: { connection: true } } },
  });
  if (!appointment) throw httpError("This appointment link is invalid or has already been updated.", 404);
  const normalizedAction = clean(action, 30).toUpperCase();
  if (!["CANCEL", "RESCHEDULE"].includes(normalizedAction)) throw httpError("action must be CANCEL or RESCHEDULE.");
  const ownerPhone = clean(appointment.ownerPhone || appointment.business.settings?.ownerPhone, 40);
  const ownerEmail = optionalEmail(appointment.ownerEmail);
  const oldWhen = formatAppointmentDate(appointment.confirmedStart || appointment.requestedStart, appointment.timezone);

  if (normalizedAction === "CANCEL") {
    const cancellationCalendar = appointment.status === "CONFIRMED" ? buildCancellationInvite(appointment) : null;
    const calendarSync = appointment.status === "CONFIRMED"
      ? await calendarCanceller(appointment, { prismaClient })
      : { ok: false, skipped: true, reason: "not_confirmed" };
    const cancelled = await prismaClient.appointmentRequest.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), customerRespondedAt: new Date() },
      include: { business: true, staffMember: true },
    });
    const message = `Cancelled: ${appointment.customerName}'s ${appointment.service} appointment with ${appointment.business.name} on ${oldWhen}.`;
    const notifications = await Promise.all([
      attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message })),
      ownerPhone ? attemptNotification("owner_sms", () => smsSender({ to: ownerPhone, message })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
      attemptNotification("customer_email", () => emailSender({ to: appointment.customerEmail, subject: `Cancelled appointment with ${appointment.business.name}`, text: message, calendar: cancellationCalendar })),
      attemptNotification("owner_email", () => emailSender({ to: ownerEmail, subject: `Cancelled: ${appointment.customerName} - ${appointment.service}`, text: message, calendar: cancellationCalendar })),
    ]);
    return { ok: true, action: normalizedAction, appointment: cancelled, notifications, calendarSync };
  }

  const nextStart = parseLocalDateTime(requestedStart, appointment.timezone);
  if (nextStart.getTime() <= Date.now()) throw httpError("Choose a future date and time.");
  const note = clean(customerNote, 500) || null;
  const cancellationCalendar = appointment.status === "CONFIRMED" ? buildCancellationInvite(appointment) : null;
  const calendarSync = appointment.status === "CONFIRMED"
    ? await calendarCanceller(appointment, { prismaClient })
    : { ok: false, skipped: true, reason: "not_confirmed" };
  const rescheduled = await prismaClient.appointmentRequest.update({
    where: { id: appointment.id },
    data: {
      status: "CHANGE_REQUESTED",
      requestedStart: nextStart,
      confirmedStart: null,
      customerNote: note,
      customerRespondedAt: new Date(),
      rescheduledAt: new Date(),
      reminder24hSentAt: null,
      reminder2hSentAt: null,
      inviteSentAt: null,
    },
    include: { business: true, staffMember: true },
  });
  const nextWhen = formatAppointmentDate(nextStart, appointment.timezone);
  const dashboardUrl = getOwnerDashboardUrl(publicBaseUrl);
  const ownerMessage = `${appointment.customerName} requested to move ${appointment.service} from ${oldWhen} to ${nextWhen}.${note ? ` Note: ${note}` : ""} Review it: ${dashboardUrl}`;
  const customerMessage = `Your request for ${nextWhen} was sent to ${appointment.business.name}. It is not confirmed yet.`;
  const notifications = await Promise.all([
    attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message: customerMessage })),
    ownerPhone ? attemptNotification("owner_sms", () => smsSender({ to: ownerPhone, message: ownerMessage })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
    attemptNotification("customer_email", () => emailSender({ to: appointment.customerEmail, subject: `Reschedule request sent to ${appointment.business.name}`, text: customerMessage, calendar: cancellationCalendar })),
    attemptNotification("owner_email", () => emailSender({ to: ownerEmail, subject: `${appointment.customerName} requested a new appointment time`, text: ownerMessage, calendar: cancellationCalendar })),
  ]);
  return { ok: true, action: normalizedAction, appointment: rescheduled, notifications, calendarSync };
}

async function processAppointmentReminders({ now = new Date(), publicBaseUrl = "", prismaClient = prisma, smsSender = sendSmsViaTwilio, emailSender = sendEmail } = {}) {
  const basis = new Date(now);
  const appointments = await prismaClient.appointmentRequest.findMany({
    where: {
      status: "CONFIRMED",
      confirmedStart: { gt: basis, lte: new Date(basis.getTime() + 24 * 60 * 60 * 1000) },
    },
    include: { business: { include: { settings: true } }, staffMember: true },
  });
  const results = [];
  for (const appointment of appointments) {
    const hoursAway = (new Date(appointment.confirmedStart).getTime() - basis.getTime()) / 3600000;
    const reminderHours = getSchedulingSettings(appointment.business.settings).reminderHours;
    const reminder = hoursAway <= 2
      ? (reminderHours.includes(2) && !appointment.reminder2hSentAt ? 2 : null)
      : (hoursAway <= 24 && reminderHours.includes(24) && !appointment.reminder24hSentAt ? 24 : null);
    if (!reminder) continue;
    const baseUrl = publicBaseUrl || clean(process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL, 1000) || (process.env.NODE_ENV === "production" ? "https://api.myaipa.ca" : "http://localhost:8787");
    const when = formatAppointmentDate(appointment.confirmedStart, appointment.timezone);
    const manageUrl = getManageUrl(appointment, baseUrl);
    const message = `Reminder: ${appointment.service} with ${appointment.business.name} is ${reminder === 2 ? "in about 2 hours" : "tomorrow"}, ${when}. Reschedule or cancel: ${manageUrl}`;
    const ownerMessage = `Reminder: ${appointment.customerName} - ${appointment.service}, ${when}.`;
    const ownerPhone = clean(appointment.ownerPhone || appointment.business.settings?.ownerPhone, 40);
    const ownerEmail = optionalEmail(appointment.ownerEmail);
    const notifications = await Promise.all([
      attemptNotification("customer_sms", () => smsSender({ to: appointment.customerPhone, message })),
      ownerPhone ? attemptNotification("owner_sms", () => smsSender({ to: ownerPhone, message: ownerMessage })) : Promise.resolve({ label: "owner_sms", ok: true, result: { skipped: true, reason: "no_phone" } }),
      attemptNotification("customer_email", () => emailSender({ to: appointment.customerEmail, subject: `Appointment reminder from ${appointment.business.name}`, text: message })),
      attemptNotification("owner_email", () => emailSender({ to: ownerEmail, subject: `Reminder: ${appointment.customerName} - ${appointment.service}`, text: ownerMessage })),
    ]);
    const delivered = notifications.some((item) => item.ok && !item.result?.skipped);
    if (delivered) {
      await prismaClient.appointmentRequest.update({
        where: { id: appointment.id },
        data: reminder === 2 ? { reminder2hSentAt: basis } : { reminder24hSentAt: basis },
      });
    }
    results.push({ appointmentId: appointment.id, reminderHours: reminder, delivered, notifications });
  }
  return results;
}

async function updateSchedulingSettings({ businessId, bookingHours, bufferMinutes, reminderHours, calendarBookingMode }, { prismaClient = prisma } = {}) {
  const business = await prismaClient.business.findUnique({ where: { id: Number(businessId) }, include: { settings: true } });
  if (!business) throw httpError("Business was not found.", 404);
  const normalizedHours = normalizeBookingHours(bookingHours);
  for (const [day, rule] of Object.entries(normalizedHours)) {
    if (rule.enabled && parseClockMinutes(rule.start) >= parseClockMinutes(rule.end)) {
      throw httpError(`${day.charAt(0).toUpperCase() + day.slice(1)} closing time must be after opening time.`);
    }
  }
  const normalizedBuffer = Math.max(0, Math.min(180, Number(bufferMinutes ?? 15) || 0));
  const normalizedReminders = Array.isArray(reminderHours)
    ? [...new Set(reminderHours.map(Number).filter((hours) => [2, 24].includes(hours)))]
    : [24, 2];
  const normalizedCalendarBookingMode = clean(calendarBookingMode || business.settings?.calendarBookingMode || "MANUAL_APPROVAL", 40).toUpperCase();
  if (!["MANUAL_APPROVAL", "AUTO_BOOK_CONNECTED", "EMAIL_INVITES_ONLY"].includes(normalizedCalendarBookingMode)) {
    throw httpError("Choose manual approval, automatic connected-calendar booking, or email invitations only.");
  }
  return prismaClient.settings.upsert({
    where: { businessId: business.id },
    update: { bookingHours: normalizedHours, appointmentBufferMinutes: normalizedBuffer, reminderHours: normalizedReminders, calendarBookingMode: normalizedCalendarBookingMode },
    create: {
      businessId: business.id,
      ownerPhone: business.phone,
      bookingHours: normalizedHours,
      appointmentBufferMinutes: normalizedBuffer,
      reminderHours: normalizedReminders,
      calendarBookingMode: normalizedCalendarBookingMode,
    },
  });
}

async function createStaffMember({ businessId, name, email, phone, color }, { prismaClient = prisma } = {}) {
  const staffName = clean(name, 120);
  if (!staffName) throw httpError("Team member name is required.");
  const safeColor = /^#[0-9a-f]{6}$/i.test(clean(color, 7)) ? clean(color, 7) : "#126dff";
  return prismaClient.staffMember.create({
    data: {
      businessId: Number(businessId),
      name: staffName,
      email: optionalEmail(email),
      phone: clean(phone, 40) || null,
      color: safeColor,
    },
  });
}

async function deactivateStaffMember({ businessId, staffMemberId }, { prismaClient = prisma } = {}) {
  const staff = await prismaClient.staffMember.findFirst({ where: { id: String(staffMemberId), businessId: Number(businessId), active: true } });
  if (!staff) throw httpError("Team member was not found.", 404);
  return prismaClient.staffMember.update({ where: { id: staff.id }, data: { active: false } });
}

async function getCalendarInvite({ appointmentId, token }, { prismaClient = prisma } = {}) {
  const appointment = await prismaClient.appointmentRequest.findFirst({
    where: { id: String(appointmentId), calendarToken: String(token || ""), status: "CONFIRMED" },
    include: { business: true, staffMember: true },
  });
  if (!appointment) throw httpError("This calendar invitation is invalid or is not confirmed.", 404);
  return { appointment, calendar: buildCalendarInvite(appointment) };
}

module.exports = {
  assertScheduleAvailable,
  buildCalendarInvite,
  buildCancellationInvite,
  createStaffMember,
  createAppointmentRequest,
  deactivateStaffMember,
  formatAppointmentDate,
  getAppointmentProposal,
  getCalendarInvite,
  getManagedAppointment,
  getManageUrl,
  getProposalUrl,
  getSchedulingSettings,
  manageCustomerAppointment,
  normalizeBookingHours,
  parseLocalDateTime,
  processAppointmentReminders,
  respondToAppointment,
  respondToAppointmentProposal,
  updateSchedulingSettings,
};
