const crypto = require("crypto");
const { prisma } = require("./prisma");

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
const MICROSOFT_SCOPES = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeProvider(value) {
  const provider = clean(value, 20).toUpperCase();
  if (!['GOOGLE', 'MICROSOFT'].includes(provider)) throw httpError("Calendar provider must be Google or Microsoft.");
  return provider;
}

function getProviderConfig(providerValue) {
  const provider = normalizeProvider(providerValue);
  if (provider === "GOOGLE") {
    return {
      provider,
      clientId: clean(process.env.GOOGLE_CALENDAR_CLIENT_ID),
      clientSecret: clean(process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
      redirectUri: clean(process.env.GOOGLE_CALENDAR_REDIRECT_URI),
      scopes: GOOGLE_SCOPES,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }
  return {
    provider,
    clientId: clean(process.env.MICROSOFT_CALENDAR_CLIENT_ID),
    clientSecret: clean(process.env.MICROSOFT_CALENDAR_CLIENT_SECRET),
    redirectUri: clean(process.env.MICROSOFT_CALENDAR_REDIRECT_URI),
    scopes: MICROSOFT_SCOPES,
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  };
}

function isProviderConfigured(provider) {
  const config = getProviderConfig(provider);
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && process.env.CALENDAR_TOKEN_ENCRYPTION_KEY);
}

function getEncryptionKey() {
  const secret = clean(process.env.CALENDAR_TOKEN_ENCRYPTION_KEY, 500);
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw httpError("CALENDAR_TOKEN_ENCRYPTION_KEY is not configured.", 503);
    return crypto.createHash("sha256").update("myaipa-local-calendar-token-key").digest();
  }
  if (secret.length < 32) throw httpError("CALENDAR_TOKEN_ENCRYPTION_KEY must be at least 32 characters.", 503);
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value) {
  const [version, iv, tag, encrypted] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || encrypted == null) throw httpError("Stored calendar credentials are invalid.", 500);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function getStateSecret() {
  const secret = clean(process.env.CALENDAR_OAUTH_STATE_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.CALENDAR_TOKEN_ENCRYPTION_KEY, 500);
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw httpError("CALENDAR_OAUTH_STATE_SECRET is not configured.", 503);
    return "myaipa-local-calendar-oauth-state";
  }
  return secret;
}

function signState(payload) {
  return crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

function createOAuthState({ businessId, staffMemberId, provider }) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    businessId: Number(businessId),
    staffMemberId: clean(staffMemberId, 100) || null,
    provider: normalizeProvider(provider),
    nonce: crypto.randomBytes(16).toString("base64url"),
    exp: Date.now() + 10 * 60 * 1000,
  })).toString("base64url");
  return `${payload}.${signState(payload)}`;
}

function parseOAuthState(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw httpError("Calendar connection state is invalid.", 400);
  const expected = signState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw httpError("Calendar connection state is invalid.", 400);
  }
  let value;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch (_error) { throw httpError("Calendar connection state is invalid.", 400); }
  if (value?.v !== 1 || Number(value.exp || 0) <= Date.now()) throw httpError("Calendar connection state expired. Please try again.", 400);
  return { ...value, provider: normalizeProvider(value.provider) };
}

function getAuthorizationUrl({ businessId, staffMemberId, provider }) {
  const config = getProviderConfig(provider);
  if (!isProviderConfigured(config.provider)) throw httpError(`${config.provider === "GOOGLE" ? "Google" : "Microsoft"} Calendar is not configured yet.`, 503);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state: createOAuthState({ businessId, staffMemberId, provider: config.provider }),
  });
  if (config.provider === "GOOGLE") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  } else {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }
  return config.authorizationUrl + "?" + params.toString();
}

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = httpError(clean(data.error_description || data.error?.message || data.error || `Calendar provider returned ${response.status}.`, 1000), 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  return data;
}

async function exchangeAuthorizationCode({ provider, code }, fetchImpl = fetch) {
  const config = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code: clean(code, 2000),
  });
  if (config.provider === "MICROSOFT") body.set("scope", config.scopes.join(" "));
  return fetchJson(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, fetchImpl);
}

async function getAccountEmail(provider, accessToken, fetchImpl = fetch) {
  const url = provider === "GOOGLE" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } }, fetchImpl);
  return clean(data.email || data.mail || data.userPrincipalName, 254).toLowerCase();
}

async function completeOAuthConnection({ state, code, provider }, { prismaClient = prisma, fetchImpl = fetch } = {}) {
  const decoded = parseOAuthState(state);
  if (provider && normalizeProvider(provider) !== decoded.provider) throw httpError("Calendar connection provider does not match this callback.", 400);
  const tokens = await exchangeAuthorizationCode({ provider: decoded.provider, code }, fetchImpl);
  const accessToken = clean(tokens.access_token, 10000);
  if (!accessToken) throw httpError("The calendar provider did not return an access token.", 502);
  const accountEmail = await getAccountEmail(decoded.provider, accessToken, fetchImpl);
  if (!accountEmail) throw httpError("The connected calendar account did not provide an email address.", 502);
  if (decoded.staffMemberId) {
    const staff = await prismaClient.staffMember.findFirst({ where: { id: decoded.staffMemberId, businessId: decoded.businessId, active: true } });
    if (!staff) throw httpError("The selected team member no longer exists.", 404);
  }
  const existing = await prismaClient.calendarConnection.findFirst({
    where: { businessId: decoded.businessId, staffMemberId: decoded.staffMemberId, provider: decoded.provider },
  });
  const data = {
    businessId: decoded.businessId,
    staffMemberId: decoded.staffMemberId,
    provider: decoded.provider,
    status: "CONNECTED",
    accountEmail,
    calendarId: "primary",
    accessTokenEncrypted: encryptSecret(accessToken),
    refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : existing?.refreshTokenEncrypted || null,
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null,
    scope: clean(tokens.scope || getProviderConfig(decoded.provider).scopes.join(" "), 2000) || null,
    lastError: null,
    connectedAt: new Date(),
  };
  return existing
    ? prismaClient.calendarConnection.update({ where: { id: existing.id }, data })
    : prismaClient.calendarConnection.create({ data });
}

async function refreshConnection(connection, { prismaClient = prisma, fetchImpl = fetch } = {}) {
  if (!connection.refreshTokenEncrypted) throw httpError("Reconnect this calendar to continue.", 401);
  const config = getProviderConfig(connection.provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.refreshTokenEncrypted),
  });
  if (connection.provider === "MICROSOFT") body.set("scope", config.scopes.join(" "));
  const tokens = await fetchJson(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, fetchImpl);
  return prismaClient.calendarConnection.update({
    where: { id: connection.id },
    data: {
      status: "CONNECTED",
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : connection.refreshTokenEncrypted,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null,
      scope: clean(tokens.scope || connection.scope, 2000) || null,
      lastError: null,
    },
  });
}

async function getAccessToken(connection, dependencies = {}) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const current = expiresAt && expiresAt <= Date.now() + 60000 ? await refreshConnection(connection, dependencies) : connection;
  return { connection: current, accessToken: decryptSecret(current.accessTokenEncrypted) };
}

async function listCandidateConnections({ businessId, staffMemberId }, { prismaClient = prisma } = {}) {
  if (!prismaClient.calendarConnection?.findMany) return [];
  const connections = await prismaClient.calendarConnection.findMany({
    where: { businessId: Number(businessId), status: "CONNECTED", ...(staffMemberId ? { OR: [{ staffMemberId: String(staffMemberId) }, { staffMemberId: null }] } : {}) },
    include: { staffMember: true },
    orderBy: [{ staffMemberId: "asc" }, { connectedAt: "asc" }],
  });
  return staffMemberId
    ? [...connections.filter((item) => item.staffMemberId === String(staffMemberId)), ...connections.filter((item) => !item.staffMemberId)]
    : [...connections.filter((item) => !item.staffMemberId), ...connections.filter((item) => item.staffMemberId)];
}

async function isConnectionBusy(connection, start, end, { prismaClient = prisma, fetchImpl = fetch } = {}) {
  const auth = await getAccessToken(connection, { prismaClient, fetchImpl });
  if (connection.provider === "GOOGLE") {
    const data = await fetchJson("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), items: [{ id: connection.calendarId || "primary" }] }),
    }, fetchImpl);
    return Boolean(data.calendars?.[connection.calendarId || "primary"]?.busy?.length);
  }
  const params = new URLSearchParams({ startDateTime: new Date(start).toISOString(), endDateTime: new Date(end).toISOString(), "$select": "id,start,end,isCancelled,showAs" });
  const calendarPath = connection.calendarId && connection.calendarId !== "primary" ? `/me/calendars/${encodeURIComponent(connection.calendarId)}/calendarView` : "/me/calendar/calendarView";
  const data = await fetchJson(`https://graph.microsoft.com/v1.0${calendarPath}?${params}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }, fetchImpl);
  return (data.value || []).some((event) => !event.isCancelled && event.showAs !== "free");
}

async function findAvailableConnection({ businessId, staffMemberId, start, end }, dependencies = {}) {
  const candidates = await listCandidateConnections({ businessId, staffMemberId }, dependencies);
  let busyCount = 0;
  let errorCount = 0;
  for (const connection of candidates) {
    try {
      if (!await isConnectionBusy(connection, start, end, dependencies)) return { connection, busy: false };
      busyCount += 1;
    } catch (error) {
      errorCount += 1;
      await (dependencies.prismaClient || prisma).calendarConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: clean(error.message, 1000) } }).catch(() => {});
    }
  }
  return { connection: null, busy: busyCount > 0, hadConnections: Boolean(candidates.length), providerErrors: errorCount };
}

function buildProviderEvent(appointment) {
  const start = new Date(appointment.confirmedStart || appointment.requestedStart);
  const end = new Date(start.getTime() + Number(appointment.durationMinutes || 60) * 60000);
  const description = [`Customer: ${appointment.customerName}`, `Phone: ${appointment.customerPhone}`, appointment.service, appointment.address].filter(Boolean).join("\n");
  return { start, end, summary: `${appointment.service} - ${appointment.customerName}`, description };
}

async function syncAppointmentToCalendar(appointmentValue, { prismaClient = prisma, fetchImpl = fetch } = {}) {
  const appointment = appointmentValue.externalEvent !== undefined
    ? appointmentValue
    : await prismaClient.appointmentRequest.findUnique({ where: { id: appointmentValue.id }, include: { business: true, staffMember: true, externalEvent: true } });
  if (!appointment || appointment.status !== "CONFIRMED") return { ok: false, skipped: true, reason: "not_confirmed" };
  const candidates = await listCandidateConnections({ businessId: appointment.businessId, staffMemberId: appointment.staffMemberId }, { prismaClient });
  const connection = appointment.externalEvent
    ? candidates.find((item) => item.id === appointment.externalEvent.connectionId)
    : candidates[0];
  if (!connection) return { ok: false, skipped: true, reason: "no_connected_calendar" };
  try {
    const auth = await getAccessToken(connection, { prismaClient, fetchImpl });
    const event = buildProviderEvent(appointment);
    let providerEvent;
    if (connection.provider === "GOOGLE") {
      const calendarId = encodeURIComponent(connection.calendarId || "primary");
      const existingId = appointment.externalEvent?.externalEventId;
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events${existingId ? `/${encodeURIComponent(existingId)}` : ""}?sendUpdates=all`;
      providerEvent = await fetchJson(url, {
        method: existingId ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: event.summary, description: event.description, location: appointment.address || undefined, start: { dateTime: event.start.toISOString(), timeZone: appointment.timezone }, end: { dateTime: event.end.toISOString(), timeZone: appointment.timezone }, attendees: appointment.customerEmail ? [{ email: appointment.customerEmail, displayName: appointment.customerName }] : [] }),
      }, fetchImpl);
    } else {
      const existingId = appointment.externalEvent?.externalEventId;
      const calendarPath = connection.calendarId && connection.calendarId !== "primary" ? `/me/calendars/${encodeURIComponent(connection.calendarId)}/events` : "/me/events";
      const url = `https://graph.microsoft.com/v1.0${existingId ? `/me/events/${encodeURIComponent(existingId)}` : calendarPath}`;
      providerEvent = await fetchJson(url, {
        method: existingId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subject: event.summary, body: { contentType: "Text", content: event.description }, start: { dateTime: event.start.toISOString().replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: event.end.toISOString().replace(/Z$/, ""), timeZone: "UTC" }, location: appointment.address ? { displayName: appointment.address } : undefined, attendees: appointment.customerEmail ? [{ emailAddress: { address: appointment.customerEmail, name: appointment.customerName }, type: "required" }] : [], transactionId: appointment.id }),
      }, fetchImpl);
    }
    const linkData = { connectionId: connection.id, provider: connection.provider, externalEventId: providerEvent.id, externalCalendarId: connection.calendarId || "primary", webLink: clean(providerEvent.htmlLink || providerEvent.webLink, 2000) || null, etag: clean(providerEvent.etag || providerEvent['@odata.etag'], 500) || null, status: "SYNCED", lastError: null, lastSyncedAt: new Date() };
    const externalEvent = await prismaClient.calendarEventLink.upsert({ where: { appointmentId: appointment.id }, update: linkData, create: { appointmentId: appointment.id, ...linkData } });
    await prismaClient.calendarConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastError: null, lastSyncedAt: new Date() } });
    return { ok: true, connectionId: connection.id, provider: connection.provider, externalEvent };
  } catch (error) {
    await prismaClient.calendarConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: clean(error.message, 1000) } }).catch(() => {});
    if (appointment.externalEvent) await prismaClient.calendarEventLink.update({ where: { appointmentId: appointment.id }, data: { status: "ERROR", lastError: clean(error.message, 1000) } }).catch(() => {});
    return { ok: false, error: error.message, provider: connection.provider };
  }
}

async function cancelAppointmentCalendarEvent(appointmentValue, { prismaClient = prisma, fetchImpl = fetch } = {}) {
  const appointment = appointmentValue.externalEvent !== undefined
    ? appointmentValue
    : await prismaClient.appointmentRequest.findUnique({ where: { id: appointmentValue.id }, include: { externalEvent: { include: { connection: true } } } });
  const link = appointment?.externalEvent;
  if (!link) return { ok: false, skipped: true, reason: "no_external_event" };
  const connection = link.connection || await prismaClient.calendarConnection.findUnique({ where: { id: link.connectionId } });
  if (!connection || connection.status === "REVOKED") return { ok: false, skipped: true, reason: "calendar_disconnected" };
  try {
    const auth = await getAccessToken(connection, { prismaClient, fetchImpl });
    const url = connection.provider === "GOOGLE"
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.externalCalendarId)}/events/${encodeURIComponent(link.externalEventId)}?sendUpdates=all`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(link.externalEventId)}`;
    const response = await fetchImpl(url, { method: "DELETE", headers: { Authorization: `Bearer ${auth.accessToken}` } });
    if (!response.ok && response.status !== 404) throw httpError(`Calendar provider returned ${response.status}.`, 502);
    await prismaClient.calendarEventLink.update({ where: { appointmentId: appointment.id }, data: { status: "CANCELLED", lastError: null, lastSyncedAt: new Date() } });
    return { ok: true, provider: connection.provider };
  } catch (error) {
    await prismaClient.calendarEventLink.update({ where: { appointmentId: appointment.id }, data: { status: "ERROR", lastError: clean(error.message, 1000) } }).catch(() => {});
    return { ok: false, error: error.message };
  }
}

async function disconnectCalendar({ businessId, connectionId }, { prismaClient = prisma } = {}) {
  const connection = await prismaClient.calendarConnection.findFirst({ where: { id: String(connectionId), businessId: Number(businessId) } });
  if (!connection) throw httpError("Calendar connection was not found.", 404);
  return prismaClient.calendarConnection.update({ where: { id: connection.id }, data: { status: "REVOKED", accessTokenEncrypted: encryptSecret(""), refreshTokenEncrypted: null, tokenExpiresAt: null, lastError: null } });
}

function sanitizeCalendarConnection(connection) {
  return { id: connection.id, provider: connection.provider, status: connection.status, accountEmail: connection.accountEmail, calendarId: connection.calendarId, staffMemberId: connection.staffMemberId || "", staffMemberName: connection.staffMember?.name || "Owner/shared calendar", lastError: connection.lastError || "", connectedAt: connection.connectedAt, lastSyncedAt: connection.lastSyncedAt };
}

function buildCustomerCalendarLinks(appointment, publicBaseUrl) {
  const start = new Date(appointment.confirmedStart || appointment.requestedStart);
  const end = new Date(start.getTime() + Number(appointment.durationMinutes || 60) * 60000);
  const title = `${appointment.service} - ${appointment.business?.name || "Appointment"}`;
  const details = `Appointment for ${appointment.customerName || "customer"}.`;
  const base = clean(publicBaseUrl, 1000).replace(/\/+$/, "");
  const ics = `${base}/api/appointments/${encodeURIComponent(appointment.id)}/calendar?token=${encodeURIComponent(appointment.calendarToken)}`;
  const compact = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const google = new URL("https://calendar.google.com/calendar/render");
  google.search = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${compact(start)}/${compact(end)}`, details, location: appointment.address || "" }).toString();
  const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlook.search = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: title, startdt: start.toISOString(), enddt: end.toISOString(), body: details, location: appointment.address || "" }).toString();
  return { google: google.toString(), outlook: outlook.toString(), apple: ics, ics };
}

module.exports = {
  buildCustomerCalendarLinks,
  cancelAppointmentCalendarEvent,
  completeOAuthConnection,
  createOAuthState,
  decryptSecret,
  disconnectCalendar,
  encryptSecret,
  findAvailableConnection,
  getAuthorizationUrl,
  getProviderConfig,
  isConnectionBusy,
  isProviderConfigured,
  normalizeProvider,
  parseOAuthState,
  sanitizeCalendarConnection,
  syncAppointmentToCalendar,
};
