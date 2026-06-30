const path = require("path");
const { nodeCommand, rootPath, run } = require("./_helpers");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const url = getArg("url", process.env.PREVIEW_URL || "http://localhost:3000");
const viewport = getArg("viewport", process.env.PREVIEW_VIEWPORT || "480x270");
const screenshot = getArg("screenshot", process.env.PREVIEW_SCREENSHOT || "standard-local-preview-check.jpg");
const quality = getArg("quality", process.env.PREVIEW_SCREENSHOT_QUALITY || "55");
const wait = getArg("wait", process.env.PREVIEW_WAIT || "1200");

run(nodeCommand(), [
  path.join("scripts", "browser-drive.js"),
  `--url=${url}`,
  `--viewport=${viewport}`,
  `--screenshot=${screenshot}`,
  `--quality=${quality}`,
  `--wait=${wait}`,
  "--viewport-only",
]);

console.log("");
console.log(`Standard chat-friendly preview screenshot: ${rootPath("diagnostics", "browser-drive", screenshot)}`);
