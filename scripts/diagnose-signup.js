const fs = require("fs");
const { loadProjectEnv, redact, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const configPath = rootPath("src", "features", "signup", "signupConfig.js");
const configSource = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

const defaultHookMatch = configSource.match(/DEFAULT_SIGNUP_WEBHOOK_URL\s*=\s*"([^"]+)"/);
const captchaProviderMatch = configSource.match(/CAPTCHA_PROVIDER\s*=\s*"([^"]*)"/);

console.log("Signup diagnostic");
console.log("=================");
console.log(`Config file: ${fs.existsSync(configPath) ? "found" : "missing"}`);
console.log(`Default Make webhook: ${defaultHookMatch ? redact(defaultHookMatch[1]) : "(not found)"}`);
console.log(`REACT_APP_API_BASE_URL: ${redact(env.REACT_APP_API_BASE_URL)}`);
console.log(`REACT_APP_MAKE_SIGNUP_WEBHOOK_URL: ${redact(env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL)}`);
console.log(`REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY: ${redact(env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY)}`);
console.log(`Configured captcha provider: ${captchaProviderMatch ? captchaProviderMatch[1] || "(disabled)" : "(unknown)"}`);
console.log("");

if (!env.REACT_APP_API_BASE_URL && !env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL && !defaultHookMatch) {
  console.log("Problem: no signup endpoint appears to be configured.");
} else {
  console.log("Endpoint config exists.");
}

if (!captchaProviderMatch || !captchaProviderMatch[1]) {
  console.log("Captcha UI is disabled. Current protection is honeypot + timing + browser attempt limiting.");
} else {
  console.log("Captcha UI is enabled. Make sure the site key domain matches www.myaipa.ca.");
}

console.log("");
console.log("To generate a sample payload: npm run test:signup-payload");
console.log("To post a sample payload: npm run test:signup-payload -- --post");
