const fs = require("fs");
const path = require("path");
const { copyDir, ensureDir, npmCommand, removeDir, rootPath, run } = require("./_helpers");

const buildDirName = "build-pages-output";
const buildDir = rootPath(buildDirName);
const docsDir = rootPath("docs");
const productionApiBase = process.env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca";

console.log("Building production React app...");
removeDir(buildDir);
run(npmCommand(), ["run", "build"], {
  env: {
    BUILD_PATH: buildDirName,
    REACT_APP_API_BASE_URL: productionApiBase,
    REACT_APP_CHECKOUT_API_BASE_URL: process.env.REACT_APP_CHECKOUT_API_BASE_URL || productionApiBase,
  },
});

if (!fs.existsSync(buildDir)) {
  throw new Error("Build folder was not created.");
}

console.log("Syncing build output into docs/ for GitHub Pages...");
ensureDir(docsDir);

// Only remove generated static assets. Keep extra docs/audio/transcript files intact.
removeDir(path.join(docsDir, "static"));
copyDir(buildDir, docsDir);
fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");
fs.copyFileSync(path.join(docsDir, "index.html"), path.join(docsDir, "404.html"));

// Create real 200-status entry points for shareable SPA routes.
for (const route of ["proof"]) {
  const routeDir = path.join(docsDir, route);
  ensureDir(routeDir);
  const routeHtml = fs
    .readFileSync(path.join(docsDir, "index.html"), "utf8")
    .replace(/(src|href)="\.\/([^\"]+)"/g, '$1="../$2"');
  fs.writeFileSync(path.join(routeDir, "index.html"), routeHtml);
}

console.log("Done. docs/ now contains the latest production build.");
