const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const BATCH_SIZE = 4;

function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(fullPath);
      return entry.isFile() && /\.test\.js$/.test(entry.name) ? [fullPath] : [];
    })
    .sort();
}

const files = collectTestFiles(TESTS_DIR);
if (files.length === 0) {
  console.error("No backend test files were found.");
  process.exit(1);
}

for (let index = 0; index < files.length; index += BATCH_SIZE) {
  const batch = files.slice(index, index + BATCH_SIZE);
  const batchNumber = Math.floor(index / BATCH_SIZE) + 1;
  const batchCount = Math.ceil(files.length / BATCH_SIZE);
  console.log(`[backend-tests] Batch ${batchNumber}/${batchCount} (${batch.length} files)`);
  const result = spawnSync(process.execPath, ["--test", ...batch], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`[backend-tests] Passed ${files.length} files in bounded batches of ${BATCH_SIZE}.`);
