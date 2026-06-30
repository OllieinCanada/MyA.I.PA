const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail("Missing TELEGRAM_BOT_TOKEN in .env or .env.local.");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}

async function resolveChatId() {
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail("Missing TELEGRAM_BOT_TOKEN in .env or .env.local.");

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) fail(`Telegram getUpdates failed: ${JSON.stringify(data)}`);

  const messages = data.result
    .map((update) => update.message || update.edited_message || update.channel_post)
    .filter(Boolean);
  const latest = messages[messages.length - 1];
  const chatId = latest?.chat?.id;
  if (!chatId) fail("No Telegram chat found. Open your bot in Telegram, send /start, then rerun this command.");
  return String(chatId);
}

async function main() {
  const animationArg = getArg("animation");
  if (!animationArg) fail("Usage: node scripts/telegram-send-animation.js --animation=path/to/file.gif [--caption=text]");

  const animationPath = path.resolve(animationArg);
  if (!fs.existsSync(animationPath)) fail(`Animation not found: ${animationPath}`);

  const caption = getArg("caption", "");
  const chatId = await resolveChatId();
  const bytes = fs.readFileSync(animationPath);
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("animation", new Blob([bytes], { type: "image/gif" }), path.basename(animationPath));

  await telegram("sendAnimation", form);
  console.log(`Sent ${animationPath} to Telegram chat ${chatId}.`);
}

main().catch((error) => fail(error.stack || error.message));
