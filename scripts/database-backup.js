if (require.main === module) require("dotenv").config({
  path: process.env.OPERATIONS_ENV_FILE || ".env.local",
});

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { privateDirectory, removePrivateDirectory } = require('./backup-safety');

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const readinessOutput = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) || "";
const encryptionSecret = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
const outputDir = path.resolve(
  root,
  process.env.BACKUP_OUTPUT_DIR || path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'MyAIPA', 'Backups')
);

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 600000,
    ...options,
  });
}

function toolVersion(command) {
  const result = run(command, ["--version"]);
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function databaseEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgresql:// protocol.");
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

function safeError(result) {
  return String(result?.stderr || result?.error?.message || "command failed")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL redacted]")
    .replace(/password=\S+/gi, "password=[redacted]")
    .slice(0, 500);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function encryptBackup(sourcePath, secret = encryptionSecret) {
  if (secret.length < 24) throw new Error("A 24+ character BACKUP_ENCRYPTION_KEY is required before creating a backup.");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const plaintext = fs.readFileSync(sourcePath);
  let encrypted, tag;
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    tag = cipher.getAuthTag();
  } finally { key.fill(0); plaintext.fill(0); }
  const encryptedPath = `${sourcePath}.enc`;
  fs.writeFileSync(encryptedPath, encrypted, { flag: 'wx', mode: 0o600 });
  fs.rmSync(sourcePath, { force: true });
  return {
    encryptedPath,
    encryption: {
      cipher: "aes-256-gcm",
      keyDerivation: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: tag.toString("base64"),
    },
  };
}

function main() {
  const pgDumpVersion = toolVersion("pg_dump");
  const pgRestoreVersion = toolVersion("pg_restore");
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const readiness = {
    checkedAt: new Date().toISOString(),
    databaseUrlConfigured: Boolean(databaseUrl),
    pgDumpVersion,
    pgRestoreVersion,
    encryptionConfigured: encryptionSecret.length >= 24,
    ready: Boolean(databaseUrl && pgDumpVersion && pgRestoreVersion && encryptionSecret.length >= 24),
  };

  if (checkOnly) {
    if (readinessOutput) {
      const readinessPath = path.isAbsolute(readinessOutput) ? readinessOutput : path.resolve(root, readinessOutput);
      fs.mkdirSync(path.dirname(readinessPath), { recursive: true });
      fs.writeFileSync(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(readiness, null, 2));
    if (!readiness.ready) process.exitCode = 2;
    return;
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!pgDumpVersion || !pgRestoreVersion) {
    throw new Error("pg_dump and pg_restore must be installed before creating a verified backup.");
  }
  if (encryptionSecret.length < 24) throw new Error("A 24+ character BACKUP_ENCRYPTION_KEY is required. Unencrypted production backups are refused.");
  const syncedRoots = [root, process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean).map(p => path.resolve(p).toLowerCase());
  if (syncedRoots.some(p => outputDir.toLowerCase() === p || outputDir.toLowerCase().startsWith(p + path.sep))) throw new Error('Keep backup output outside the repository and OneDrive.');

  const pgEnv = databaseEnvironment(databaseUrl);
  fs.mkdirSync(outputDir, { recursive: true });
  const privateWork = privateDirectory('myaipa-backup-drill-');
  const snapshotStartedAt = new Date().toISOString();
  const backupPath = path.join(privateWork, `myaipa-${timestamp()}.dump`);
  try {
  const result = run(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      backupPath,
    ],
    { env: { ...process.env, ...pgEnv, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on -c lock_timeout=5000' } }
  );
  if (result.status !== 0) {
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
    throw new Error(`pg_dump failed: ${safeError(result)}`);
  }

  const verification = run("pg_restore", ["--list", backupPath]);
  if (verification.status !== 0) {
    throw new Error(`Backup archive verification failed: ${safeError(verification)}`);
  }

  const encrypted = encryptBackup(backupPath);
  const finalPath = path.join(outputDir, path.basename(encrypted.encryptedPath));
  fs.copyFileSync(encrypted.encryptedPath, finalPath, fs.constants.COPYFILE_EXCL);
  encrypted.encryptedPath = finalPath;

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    snapshotCreatedAt: snapshotStartedAt,
    archiveFormat: 'postgres-custom',
    file: path.basename(encrypted.encryptedPath),
    bytes: fs.statSync(encrypted.encryptedPath).size,
    sha256: sha256(encrypted.encryptedPath),
    pgDumpVersion,
    pgRestoreVersion,
    archiveListVerified: true,
    encrypted: true,
    encryption: encrypted.encryption,
    containsPersonalInformation: true,
    handling: "Encrypt, restrict access, keep out of Git, and expire under the approved backup schedule.",
  };
  const manifestPath = `${encrypted.encryptedPath}.manifest.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...manifest, backupPath: encrypted.encryptedPath, manifestPath }, null, 2));
  } finally { removePrivateDirectory(privateWork); }
}

if (require.main === module) try {
  main();
} catch (error) {
  console.error(`Database backup failed safely: ${String(error?.message || error).slice(0, 600)}`);
  process.exitCode = 1;
}
module.exports = { databaseEnvironment, encryptBackup, main };
