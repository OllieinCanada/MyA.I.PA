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
  if (!token) {
    fail("Missing TELEGRAM_BOT_TOKEN in .env or .env.local.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    fail(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}

async function resolveChatId() {
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    fail("Missing TELEGRAM_BOT_TOKEN in .env or .env.local.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    fail(`Telegram getUpdates failed: ${JSON.stringify(data)}`);
  }

  const messages = data.result
    .map((update) => update.message || update.edited_message || update.channel_post)
    .filter(Boolean);
  const latest = messages[messages.length - 1];
  const chatId = latest?.chat?.id;
  if (!chatId) {
    fail("No Telegram chat found. Open your bot in Telegram, send /start, then rerun this command.");
  }

  console.log(`Using latest Telegram chat id: ${chatId}`);
  console.log("Optional: save TELEGRAM_CHAT_ID in .env to pin this destination.");
  return String(chatId);
}

async function main() {
  const photoArg = getArg("photo");
  if (!photoArg) fail("Usage: node scripts/telegram-send-photo.js --photo=path/to/image.png [--caption=text]");

  const photoPath = path.resolve(photoArg);
  if (!fs.existsSync(photoPath)) fail(`Photo not found: ${photoPath}`);

  const caption = getArg("caption", "");
  const chatId = await resolveChatId();
  const bytes = fs.readFileSync(photoPath);
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("photo", new Blob([bytes]), path.basename(photoPath));

  await telegram("sendPhoto", form);
  console.log(`Sent ${photoPath} to Telegram chat ${chatId}.`);
}

main().catch((error) => fail(error.stack || error.message));
