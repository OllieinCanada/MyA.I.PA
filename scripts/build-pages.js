const fs = require("fs");
const path = require("path");
const { copyDir, ensureDir, npmCommand, removeDir, rootPath, run } = require("./_helpers");

const buildDirName = "build-pages-output";
const buildDir = rootPath(buildDirName);
const docsDir = rootPath("docs");
const productionApiBase = process.env.REACT_APP_API_BASE_URL || "https://myaipa-api.onrender.com";

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

console.log("Done. docs/ now contains the latest production build.");
