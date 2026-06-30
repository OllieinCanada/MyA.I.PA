const path = require("path");
const fs = require("fs");
const { nodeCommand, rootPath, run } = require("./_helpers");

const screenshotName = "telegram-admin-latest.png";
const screenshotPath = rootPath("diagnostics", "browser-drive", screenshotName);
const phoneSharePath = rootPath("phone-share", screenshotName);
const adminUrl =
  process.env.TELEGRAM_ADMIN_URL ||
  "file:///C:/Users/Olive/OneDrive/Desktop/MyAIPA-Website/docs/index.html#/admin";

run(nodeCommand(), [
  path.join("scripts", "browser-drive.js"),
  `--url=${adminUrl}`,
  "--viewport=1280x720",
  `--screenshot=${screenshotName}`,
  "--wait=5000",
  "--viewport-only",
]);

fs.mkdirSync(path.dirname(phoneSharePath), { recursive: true });
fs.copyFileSync(screenshotPath, phoneSharePath);

run(nodeCommand(), [
  path.join("scripts", "telegram-send-photo.js"),
  `--photo=${screenshotPath}`,
  "--caption=MyAIPA admin screenshot",
]);
