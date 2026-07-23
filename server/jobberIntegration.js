const crypto = require("crypto");

const PROVIDER = "JOBBER";
const AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";

function clean(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function httpError(message, statusCode = 400, code = "JOBBER_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getConfig(env = process.env) {
  return {
    clientId: clean(env.JOBBER_CLIENT_ID, 500),
    clientSecret: clean(env.JOBBER_CLIENT_SECRET, 500),
    redirectUri: clean(env.JOBBER_REDIRECT_URI, 1000),
    graphQlVersion: clean(env.JOBBER_GRAPHQL_VERSION || "2025-04-16", 40),
    tokenEncryptionKey: clean(env.FIELD_SERVICE_TOKEN_ENCRYPTION_KEY || env.CALENDAR_TOKEN_ENCRYPTION_KEY, 500),
    stateSecret: clean(env.FIELD_SERVICE_OAUTH_STATE_SECRET || env.ADMIN_SESSION_SECRET, 500),
  };
}

function isConfigured(env = process.env) {
  const config = getConfig(env);
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.tokenEncryptionKey && config.stateSecret);
}

function encryptionKey(env = process.env) {
  const secret = getConfig(env).tokenEncryptionKey;
  if (secret.length < 32) throw httpError("Field-service token encryption is not configured.", 503, "JOBBER_ENCRYPTION_NOT_CONFIGURED");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(value, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value, env = process.env) {
  const [version, iv, tag, encrypted] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || encrypted == null) throw httpError("Stored Jobber credentials are invalid.", 500, "JOBBER_TOKEN_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function stateToken(payload, env = process.env) {
  const secret = getConfig(env).stateSecret;
  if (secret.length < 24) throw httpError("Field-service OAuth state signing is not configured.", 503, "JOBBER_STATE_NOT_CONFIGURED");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function parseState(token, env = process.env) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw httpError("Invalid Jobber connection state.", 400, "JOBBER_STATE_INVALID");
  const expected = crypto.createHmac("sha256", getConfig(env).stateSecret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw httpError("Invalid Jobber connection state.", 400, "JOBBER_STATE_INVALID");
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_error) { throw httpError("Invalid Jobber connection state.", 400, "JOBBER_STATE_INVALID"); }
  if (!payload?.businessId || Number(payload.exp || 0) < Date.now()) throw httpError("The Jobber connection link expired.", 410, "JOBBER_STATE_EXPIRED");
  return payload;
}

function getAuthorizationUrl({ businessId, env = process.env }) {
  if (!isConfigured(env)) throw httpError("Jobber integration is not configured yet.", 503, "JOBBER_NOT_CONFIGURED");
  const config = getConfig(env);
  const state = stateToken({ businessId: Number(businessId), exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomUUID() }, env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function requestTokens(parameters, { env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getConfig(env);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_error) { data = {}; }
  if (!response.ok || !data.access_token) throw httpError(`Jobber authorization failed${data.error_description ? `: ${clean(data.error_description, 300)}` : "."}`, 502, "JOBBER_TOKEN_EXCHANGE_FAILED");
  return data;
}

function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    return payload.exp ? new Date(Number(payload.exp) * 1000) : new Date(Date.now() + 55 * 60 * 1000);
  } catch (_error) {
    return new Date(Date.now() + 55 * 60 * 1000);
  }
}

async function graphQlRequest({ accessToken, query, variables = {}, env = process.env, fetchImpl = global.fetch }) {
  const response = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": getConfig(env).graphQlVersion,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_error) { throw httpError("Jobber returned an unreadable response.", 502, "JOBBER_RESPONSE_INVALID"); }
  if (!response.ok) throw httpError(`Jobber API returned HTTP ${response.status}.`, 502, "JOBBER_HTTP_ERROR");
  if (Array.isArray(data.errors) && data.errors.length) throw httpError(clean(data.errors.map((item) => item.message).join("; "), 700), 502, "JOBBER_GRAPHQL_ERROR");
  return data.data || {};
}

async function completeOAuth({ prisma, code, state, env = process.env, fetchImpl = global.fetch }) {
  const payload = parseState(state, env);
  const config = getConfig(env);
  const tokens = await requestTokens({ grant_type: "authorization_code", code: clean(code, 2000), redirect_uri: config.redirectUri }, { env, fetchImpl });
  const accountData = await graphQlRequest({ accessToken: tokens.access_token, query: "query MyAipaJobberAccount { account { id name } }", env, fetchImpl });
  const account = accountData.account || {};
  return prisma.fieldServiceConnection.upsert({
    where: { businessId_provider: { businessId: Number(payload.businessId), provider: PROVIDER } },
    create: {
      businessId: Number(payload.businessId), provider: PROVIDER, status: "CONNECTED",
      externalAccountId: clean(account.id, 500) || null, externalAccountName: clean(account.name, 300) || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token, env), refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token, env) : null,
      tokenExpiresAt: jwtExpiry(tokens.access_token), scope: clean(tokens.scope, 1000) || null,
    },
    update: {
      status: "CONNECTED", externalAccountId: clean(account.id, 500) || null, externalAccountName: clean(account.name, 300) || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token, env), refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token, env) : undefined,
      tokenExpiresAt: jwtExpiry(tokens.access_token), scope: clean(tokens.scope, 1000) || null, lastError: null, connectedAt: new Date(),
    },
  });
}

async function getAccessToken({ prisma, connection, env = process.env, fetchImpl = global.fetch }) {
  if (connection.status !== "CONNECTED") throw httpError("Jobber is not connected for this business.", 409, "JOBBER_NOT_CONNECTED");
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) return decryptSecret(connection.accessTokenEncrypted, env);
  if (!connection.refreshTokenEncrypted) throw httpError("Jobber must be reconnected.", 409, "JOBBER_REAUTH_REQUIRED");
  const tokens = await requestTokens({ grant_type: "refresh_token", refresh_token: decryptSecret(connection.refreshTokenEncrypted, env) }, { env, fetchImpl });
  await prisma.fieldServiceConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptSecret(tokens.access_token, env),
      refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token, env) : connection.refreshTokenEncrypted,
      tokenExpiresAt: jwtExpiry(tokens.access_token), lastError: null,
    },
  });
  return tokens.access_token;
}

function splitName(name) {
  const parts = clean(name, 200).split(" ").filter(Boolean);
  return { firstName: parts.shift() || "Unknown", lastName: parts.join(" ") || "Caller" };
}

async function syncLeadToJobber({ prisma, businessId, leadId, env = process.env, fetchImpl = global.fetch }) {
  const lead = await prisma.lead.findFirst({ where: { id: Number(leadId), businessId: Number(businessId) } });
  if (!lead) throw httpError("Lead not found for this business.", 404, "JOBBER_LEAD_NOT_FOUND");
  const connection = await prisma.fieldServiceConnection.findUnique({ where: { businessId_provider: { businessId: Number(businessId), provider: PROVIDER } } });
  if (!connection || connection.status !== "CONNECTED") return { skipped: true, reason: "jobber_not_connected" };

  const idempotencyKey = `jobber:lead:${lead.id}:client:v1`;
  let sync;
  try {
    sync = await prisma.fieldServiceSync.create({
      data: {
        businessId: Number(businessId), connectionId: connection.id, leadId: lead.id, provider: PROVIDER,
        entityType: "CLIENT", idempotencyKey, status: "PENDING", attempts: 1,
        payloadDigest: crypto.createHash("sha256").update(JSON.stringify({ name: lead.name, phone: lead.callbackNumber })).digest("hex"),
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const existing = await prisma.fieldServiceSync.findUnique({ where: { idempotencyKey } });
    if (!existing || existing.status !== "FAILED") return { duplicate: true, sync: existing };
    sync = await prisma.fieldServiceSync.update({
      where: { id: existing.id },
      data: { status: "PENDING", attempts: { increment: 1 }, lastError: null },
    });
  }

  try {
    const accessToken = await getAccessToken({ prisma, connection, env, fetchImpl });
    const input = { ...splitName(lead.name), phones: [{ description: "MAIN", primary: true, number: clean(lead.callbackNumber, 60) }] };
    const data = await graphQlRequest({
      accessToken,
      query: "mutation MyAipaCreateLead($input: ClientCreateAttributes!) { clientCreate(input: $input) { client { id firstName lastName jobberWebUri } userErrors { message path } } }",
      variables: { input }, env, fetchImpl,
    });
    const result = data.clientCreate || {};
    if (Array.isArray(result.userErrors) && result.userErrors.length) throw httpError(clean(result.userErrors.map((item) => item.message).join("; "), 700), 422, "JOBBER_CLIENT_REJECTED");
    if (!result.client?.id) throw httpError("Jobber did not return a client identifier.", 502, "JOBBER_CLIENT_MISSING");
    const updated = await prisma.fieldServiceSync.update({
      where: { id: sync.id },
      data: { status: "SYNCED", externalId: clean(result.client.id, 500), syncedAt: new Date(), lastError: null },
    });
    await prisma.fieldServiceConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date(), lastError: null } });
    return { synced: true, sync: updated, externalUri: clean(result.client.jobberWebUri, 1000) || null };
  } catch (error) {
    await prisma.fieldServiceSync.update({ where: { id: sync.id }, data: { status: "FAILED", lastError: clean(error.message, 700) } }).catch(() => {});
    await prisma.fieldServiceConnection.update({ where: { id: connection.id }, data: { lastError: clean(error.message, 700), status: error.code === "JOBBER_REAUTH_REQUIRED" ? "ERROR" : connection.status } }).catch(() => {});
    throw error;
  }
}

async function disconnectJobber({ prisma, businessId, env = process.env }) {
  const connection = await prisma.fieldServiceConnection.findUnique({ where: { businessId_provider: { businessId: Number(businessId), provider: PROVIDER } } });
  if (!connection) return null;
  return prisma.fieldServiceConnection.update({
    where: { id: connection.id },
    data: { status: "REVOKED", accessTokenEncrypted: encryptSecret("", env), refreshTokenEncrypted: null, tokenExpiresAt: null, lastError: null },
  });
}

function sanitizeConnection(connection, configured = isConfigured()) {
  return {
    provider: "jobber", configured,
    connected: connection?.status === "CONNECTED",
    status: connection?.status || "NOT_CONNECTED",
    accountName: connection?.externalAccountName || "",
    lastSyncedAt: connection?.lastSyncedAt || null,
    lastError: connection?.lastError || "",
  };
}

module.exports = {
  completeOAuth,
  disconnectJobber,
  getAuthorizationUrl,
  isConfigured,
  parseState,
  sanitizeConnection,
  syncLeadToJobber,
};
