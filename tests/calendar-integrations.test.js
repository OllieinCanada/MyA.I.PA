const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCustomerCalendarLinks,
  createOAuthState,
  decryptSecret,
  encryptSecret,
  findAvailableConnection,
  getAuthorizationUrl,
  parseOAuthState,
  syncAppointmentToCalendar,
} = require("../server/calendarIntegrations");

const ENV_KEYS = [
  "CALENDAR_TOKEN_ENCRYPTION_KEY",
  "CALENDAR_OAUTH_STATE_SECRET",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
];

function withCalendarEnv(run) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CALENDAR_TOKEN_ENCRYPTION_KEY: "test-calendar-encryption-key-that-is-long-enough",
    CALENDAR_OAUTH_STATE_SECRET: "test-calendar-state-secret-that-is-long-enough",
    GOOGLE_CALENDAR_CLIENT_ID: "google-client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "google-client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: "https://api.example.test/api/calendar/oauth/google/callback",
  });
  return Promise.resolve().then(run).finally(() => {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
}

test("calendar tokens are encrypted and authenticated at rest", () => withCalendarEnv(() => {
  const encrypted = encryptSecret("refresh-token-value");
  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(decryptSecret(encrypted), "refresh-token-value");
  const parts = encrypted.split(".");
  parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
  assert.throws(() => decryptSecret(parts.join(".")));
}));

test("Google authorization uses a signed, expiring business state", () => withCalendarEnv(() => {
  const url = new URL(getAuthorizationUrl({ businessId: 17, staffMemberId: "staff-4", provider: "google" }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope"), /calendar\.events/);
  const state = parseOAuthState(url.searchParams.get("state"));
  assert.equal(state.businessId, 17);
  assert.equal(state.staffMemberId, "staff-4");
  assert.equal(state.provider, "GOOGLE");
  assert.throws(() => parseOAuthState(`${url.searchParams.get("state")}x`), /invalid/i);
}));

test("connected Google availability is checked before automatic booking", () => withCalendarEnv(async () => {
  const connection = {
    id: "cal-1",
    businessId: 17,
    staffMemberId: null,
    provider: "GOOGLE",
    status: "CONNECTED",
    calendarId: "primary",
    accessTokenEncrypted: encryptSecret("access-token"),
    tokenExpiresAt: new Date(Date.now() + 3600000),
    connectedAt: new Date(),
  };
  const updates = [];
  const prismaClient = {
    calendarConnection: {
      findMany: async () => [connection],
      update: async ({ data }) => { updates.push(data); return { ...connection, ...data }; },
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ calendars: { primary: { busy: [] } } }) });
  const available = await findAvailableConnection({ businessId: 17, start: new Date("2026-08-01T14:00:00Z"), end: new Date("2026-08-01T15:00:00Z") }, { prismaClient, fetchImpl });
  assert.equal(available.connection.id, "cal-1");
  assert.equal(available.busy, false);
  assert.equal(updates.length, 0);
}));

test("confirmed events sync to Google and include the customer as an attendee", () => withCalendarEnv(async () => {
  const connection = {
    id: "cal-1",
    businessId: 17,
    staffMemberId: null,
    provider: "GOOGLE",
    status: "CONNECTED",
    calendarId: "primary",
    accessTokenEncrypted: encryptSecret("access-token"),
    tokenExpiresAt: new Date(Date.now() + 3600000),
    connectedAt: new Date(),
  };
  let request;
  let savedLink;
  const appointment = {
    id: "appointment-17",
    businessId: 17,
    status: "CONFIRMED",
    customerName: "Jamie Lee",
    customerEmail: "jamie@example.com",
    customerPhone: "+19055550117",
    service: "Panel repair",
    address: "10 Main St",
    requestedStart: new Date("2026-08-01T14:00:00Z"),
    confirmedStart: new Date("2026-08-01T14:00:00Z"),
    durationMinutes: 60,
    timezone: "America/Toronto",
    staffMemberId: null,
    externalEvent: null,
  };
  const prismaClient = {
    calendarConnection: {
      findMany: async () => [connection],
      update: async ({ data }) => ({ ...connection, ...data }),
    },
    calendarEventLink: {
      upsert: async ({ create }) => { savedLink = create; return create; },
    },
  };
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ id: "google-event-17", htmlLink: "https://calendar.google.com/event?eid=17", etag: "etag-17" }) };
  };
  const result = await syncAppointmentToCalendar(appointment, { prismaClient, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(request.options.method, "POST");
  assert.equal(request.body.attendees[0].email, "jamie@example.com");
  assert.equal(savedLink.externalEventId, "google-event-17");
}));

test("customer calendar choices work without OAuth", () => {
  const links = buildCustomerCalendarLinks({
    id: "appointment-1",
    calendarToken: "private-token",
    customerName: "Jamie",
    service: "Furnace repair",
    address: "10 Main St",
    requestedStart: new Date("2026-08-01T14:00:00Z"),
    confirmedStart: new Date("2026-08-01T14:00:00Z"),
    durationMinutes: 60,
    business: { name: "Hamilton Heating" },
  }, "https://api.myaipa.ca");
  assert.match(links.google, /^https:\/\/calendar\.google\.com/);
  assert.match(links.outlook, /^https:\/\/outlook\.live\.com/);
  assert.equal(links.apple, "https://api.myaipa.ca/api/appointments/appointment-1/calendar?token=private-token");
});
