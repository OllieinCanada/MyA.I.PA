const fs = require("fs");
const path = require("path");

const { loadProjectEnv, rootPath } = require("./_helpers");

const localEnv = loadProjectEnv();
const serviceId = String(localEnv.RENDER_SERVICE_ID || "").trim();
const renderConfigPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".render",
  "cli.yaml"
);
const reportPath = rootPath("diagnostics", "security", "credential-readiness-latest.json");

const groups = [
  {
    id: "twilio-reporting",
    label: "Twilio cost reporting",
    priority: "required-now",
    source: "Twilio Console",
    keys: ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET"],
  },
  {
    id: "twilio-runtime",
    label: "Twilio calling, texting, and webhook verification",
    priority: "required-now",
    source: "Twilio Console",
    keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
  },
  {
    id: "vapi",
    label: "AI phone system",
    priority: "required-now",
    source: "Vapi Dashboard",
    keys: ["VAPI_API_KEY"],
  },
  {
    id: "stripe",
    label: "Trials and paid checkout",
    priority: "required-before-sales",
    source: "Stripe Dashboard",
    keys: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"],
  },
  {
    id: "openai",
    label: "AI support suggestions and transcription helpers",
    priority: "required-for-feature",
    source: "OpenAI Platform",
    keys: ["OPENAI_API_KEY"],
  },
  {
    id: "make-runtime",
    label: "Signup workflow handoff",
    priority: "required-now",
    source: "Make scenario/webhook settings",
    keys: ["MAKE_SIGNUP_WEBHOOK_URL", "MAKE_SIGNUP_WEBHOOK_API_KEY"],
  },
  {
    id: "make-ops",
    label: "Make scenario administration by local automation",
    priority: "operator-only",
    source: "Make API Tokens",
    scope: "local",
    keys: ["MAKE_API_TOKEN"],
  },
  {
    id: "integration-auth",
    label: "Protected backend integration routes",
    priority: "required-now",
    source: "Generate a long random secret",
    keys: ["INTEGRATION_API_KEY"],
  },
  {
    id: "vapi-webhook-auth",
    label: "Vapi webhook authentication",
    priority: "derived-if-missing",
    source: "Generate a separate random secret",
    keys: ["VAPI_WEBHOOK_SECRET"],
  },
  {
    id: "bot-protection",
    label: "Public signup bot protection (server)",
    priority: "recommended-before-sales",
    source: "Cloudflare Turnstile",
    keys: ["TURNSTILE_SECRET_KEY"],
  },
  {
    id: "bot-protection-frontend",
    label: "Public signup bot protection (website)",
    priority: "recommended-before-sales",
    source: "Cloudflare Turnstile",
    scope: "local",
    keys: ["REACT_APP_TURNSTILE_SITE_KEY"],
  },
  {
    id: "email",
    label: "Email verification and trial reminders",
    priority: "required-if-enabled",
    source: "Transactional email provider",
    keys: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"],
  },
  {
    id: "telegram",
    label: "High-priority support alerts",
    priority: "optional",
    source: "Telegram BotFather / destination chat",
    keys: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  },
  {
    id: "github-support",
    label: "One-click GitHub support issues",
    priority: "optional",
    source: "GitHub fine-grained access token",
    keys: ["GITHUB_SUPPORT_TOKEN", "GITHUB_SUPPORT_REPO"],
  },
  {
    id: "google-calendar",
    label: "Google Calendar connection",
    priority: "optional",
    source: "Google Cloud Console",
    keys: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
  },
  {
    id: "microsoft-calendar",
    label: "Microsoft Outlook Calendar connection",
    priority: "optional",
    source: "Microsoft Entra app registration",
    keys: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"],
  },
  {
    id: "jobber",
    label: "Jobber connection",
    priority: "optional",
    source: "Jobber Developer Center",
    keys: ["JOBBER_CLIENT_ID", "JOBBER_CLIENT_SECRET"],
  },
  {
    id: "google-maps",
    label: "Google Maps-assisted address entry",
    priority: "optional",
    source: "Google Cloud Console",
    scope: "local",
    keys: ["REACT_APP_GOOGLE_MAPS_API_KEY"],
  },
  {
    id: "x-operator",
    label: "Local X job-finder automation",
    priority: "operator-only",
    source: "X Developer Portal",
    scope: "local",
    keys: ["X_BEARER_TOKEN"],
  },
];

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\""))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function isUsable(value) {
  const text = String(value || "").trim();
  return Boolean(
    text
    && !/^(?:change-me|your[_ -]?key|replace[_ -]?me|todo|example)$/i.test(text)
    && !/^<.+>$/.test(text)
  );
}

function readRenderCredentials() {
  const source = fs.readFileSync(renderConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  if (!apiBlock) throw new Error("The signed-in Render CLI profile has no API section.");
  const key = stripYamlValue(apiBlock[1].match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock[1].match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The signed-in Render CLI profile is incomplete.");
  return { key, host };
}

async function renderRequest(credentials, endpoint) {
  const response = await fetch(`${credentials.host}${endpoint}`, {
    headers: {
      authorization: `Bearer ${credentials.key}`,
      accept: "application/json",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Render request failed with HTTP ${response.status}.`);
  return response.json();
}

function envValue(payload) {
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

async function getRemotePresence(credentials, key) {
  const payload = await renderRequest(
    credentials,
    `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
  );
  return isUsable(envValue(payload));
}

async function validateTwilio(remotePresence, remoteValues) {
  const accountSid = remoteValues.TWILIO_ACCOUNT_SID;
  const apiKeySid = remoteValues.TWILIO_API_KEY_SID;
  const apiKeySecret = remoteValues.TWILIO_API_KEY_SECRET;
  const authToken = remoteValues.TWILIO_AUTH_TOKEN;
  let username = "";
  let password = "";
  let mode = "";

  if (
    remotePresence.TWILIO_ACCOUNT_SID
    && remotePresence.TWILIO_API_KEY_SID
    && remotePresence.TWILIO_API_KEY_SECRET
  ) {
    username = apiKeySid;
    password = apiKeySecret;
    mode = "api-key";
  } else if (remotePresence.TWILIO_ACCOUNT_SID && remotePresence.TWILIO_AUTH_TOKEN) {
    username = accountSid;
    password = authToken;
    mode = "auth-token";
  } else {
    return { checked: false, valid: false, mode: "incomplete", status: null };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records.json?PageSize=1`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        accept: "application/json",
      },
    }
  );
  return {
    checked: true,
    valid: response.ok,
    mode,
    status: response.status,
  };
}

async function main() {
  if (!serviceId) throw new Error("RENDER_SERVICE_ID is not configured.");
  const renderCredentials = readRenderCredentials();
  const remoteKeys = [...new Set(
    groups.filter((group) => group.scope !== "local").flatMap((group) => group.keys)
  )];
  const remoteValues = {};
  const remotePresence = {};

  await Promise.all(remoteKeys.map(async (key) => {
    const payload = await renderRequest(
      renderCredentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
    );
    const value = envValue(payload);
    remoteValues[key] = value;
    remotePresence[key] = isUsable(value);
  }));

  const localPresence = Object.fromEntries(
    [...new Set(groups.flatMap((group) => group.keys))]
      .map((key) => [key, isUsable(localEnv[key])])
  );
  const twilio = await validateTwilio(remotePresence, remoteValues);

  const inventory = groups.map((group) => {
    const presence = group.keys.map((key) => ({
      key,
      present: group.scope === "local" ? localPresence[key] : remotePresence[key],
    }));
    const missing = presence.filter((item) => !item.present).map((item) => item.key);
    return {
      id: group.id,
      label: group.label,
      priority: group.priority,
      source: group.source,
      scope: group.scope || "render",
      ready: missing.length === 0,
      present: presence.filter((item) => item.present).map((item) => item.key),
      missing,
      availableLocally: group.scope === "local"
        ? []
        : missing.filter((key) => localPresence[key]),
      missingEverywhere: missing.filter((key) => !localPresence[key]),
    };
  });

  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    serviceId,
    secretValuesPrinted: false,
    validation: { twilio },
    inventory,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportPath}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
