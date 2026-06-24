const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

function rootPath(...parts) {
  return path.join(rootDir, ...parts);
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const printable = [command, ...args].join(" ");
    throw new Error(`Command failed: ${printable}`);
  }

  return result;
}

function npmCommand() {
  return isWindows ? "npm.cmd" : "npm";
}

function nodeCommand() {
  return process.execPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const rawValue = match[2].trim();
    env[match[1]] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function loadProjectEnv() {
  return {
    ...parseEnvFile(rootPath(".env")),
    ...parseEnvFile(rootPath(".env.local")),
    ...process.env,
  };
}

function redact(value) {
  if (!value) return "(not set)";
  const text = String(value);
  if (text.length <= 10) return `${text.slice(0, 2)}...`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath);
}

function spawnDetached(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    stdio: options.stdio || "ignore",
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
  });
  child.unref();
  return child;
}

module.exports = {
  copyDir,
  ensureDir,
  listFiles,
  loadProjectEnv,
  nodeCommand,
  npmCommand,
  redact,
  removeDir,
  rootDir,
  rootPath,
  run,
  spawnDetached,
};
