const fs = require("fs");
const path = require("path");
const { listFiles, rootPath, run } = require("./_helpers");

function capture(command, args) {
  const result = run(command, args, { capture: true, allowFailure: true });
  return (result.stdout || result.stderr || "").trim();
}

console.log("Site diagnostic");
console.log("===============");

console.log(`Branch: ${capture("git", ["branch", "--show-current"]) || "(unknown)"}`);
console.log(`Latest commit: ${capture("git", ["log", "-1", "--oneline"]) || "(unknown)"}`);
console.log("");

console.log("Git status:");
console.log(capture("git", ["status", "--short"]) || "Clean");
console.log("");

const buildIndex = rootPath("build", "index.html");
const docsIndex = rootPath("docs", "index.html");
const docsStatic = rootPath("docs", "static");

console.log("Build outputs:");
console.log(`build/index.html: ${fs.existsSync(buildIndex) ? "yes" : "no"}`);
console.log(`docs/index.html: ${fs.existsSync(docsIndex) ? "yes" : "no"}`);
console.log(`docs/static/: ${fs.existsSync(docsStatic) ? "yes" : "no"}`);

if (fs.existsSync(docsIndex)) {
  const index = fs.readFileSync(docsIndex, "utf8");
  const scriptMatch = index.match(/static\/js\/main\.[^"]+\.js/);
  const cssMatch = index.match(/static\/css\/main\.[^"]+\.css/);
  console.log(`docs JS bundle: ${scriptMatch ? scriptMatch[0] : "(not found)"}`);
  console.log(`docs CSS bundle: ${cssMatch ? cssMatch[0] : "(not found)"}`);
}

const staticFiles = listFiles(path.join(docsStatic, "js"));
console.log(`docs/static/js files: ${staticFiles.length}`);
console.log("");
console.log("If the live site is stale, run: npm run deploy:pages");
