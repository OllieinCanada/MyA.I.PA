const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
function getBackendTestBatchSize(platform = process.platform, configured = process.env.BACKEND_TEST_BATCH_SIZE) {
  const batchSize = Number(configured || (platform === "win32" ? 1 : 4));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8) {
    throw new Error("BACKEND_TEST_BATCH_SIZE must be an integer from 1 to 8.");
  }
  return batchSize;
}

function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(fullPath);
      return entry.isFile() && /\.test\.js$/.test(entry.name) ? [fullPath] : [];
    })
    .sort();
}

function runBackendTests() {
  const BATCH_SIZE = getBackendTestBatchSize();
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
}

if (require.main === module) runBackendTests();
module.exports = { getBackendTestBatchSize };
