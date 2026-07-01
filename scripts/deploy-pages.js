const { nodeCommand, rootPath, run } = require("./_helpers");

const messageIndex = process.argv.indexOf("--message");
const commitMessage =
  messageIndex >= 0 && process.argv[messageIndex + 1]
    ? process.argv[messageIndex + 1]
    : "Update website build";

console.log("Building and syncing GitHub Pages files...");
run(nodeCommand(), [rootPath("scripts", "build-pages.js")]);

console.log("Staging only known app and GitHub Pages build files...");
const stagePaths = [
  "package.json",
  "package-lock.json",
  "scripts/deploy-pages.js",
  "scripts/build-pages.js",
  "src",
  "docs/.nojekyll",
  "docs/index.html",
  "docs/asset-manifest.json",
  "docs/manifest.json",
  "docs/robots.txt",
  "docs/favicon.ico",
  "docs/logo192.png",
  "docs/logo512.png",
  "docs/static",
];
const existingStagePaths = stagePaths.filter((stagePath) => require("fs").existsSync(rootPath(stagePath)));
run("git", ["add", ...existingStagePaths]);

const diffCheck = run("git", ["diff", "--cached", "--quiet"], { allowFailure: true, capture: true });
if (diffCheck.status === 0) {
  console.log("No staged changes to commit. Nothing to deploy.");
  process.exit(0);
}

console.log(`Committing: ${commitMessage}`);
run("git", ["commit", "-m", commitMessage]);

const branchResult = run("git", ["branch", "--show-current"], { capture: true });
const branch = branchResult.stdout.trim() || "main";

console.log(`Pushing to origin ${branch}...`);
run("git", ["push", "origin", branch]);

console.log("Deploy push complete. GitHub Pages may take a minute or two to refresh.");
