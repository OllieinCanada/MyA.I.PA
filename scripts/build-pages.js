const fs = require("fs");
const path = require("path");
const { copyDir, ensureDir, npmCommand, removeDir, rootPath, run } = require("./_helpers");

const buildDir = rootPath("build");
const docsDir = rootPath("docs");

console.log("Building production React app...");
run(npmCommand(), ["run", "build"]);

if (!fs.existsSync(buildDir)) {
  throw new Error("Build folder was not created.");
}

console.log("Syncing build output into docs/ for GitHub Pages...");
ensureDir(docsDir);

// Only remove generated static assets. Keep extra docs/audio/transcript files intact.
removeDir(path.join(docsDir, "static"));
copyDir(buildDir, docsDir);

console.log("Done. docs/ now contains the latest production build.");
