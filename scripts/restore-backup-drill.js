require("dotenv").config({ path: process.env.OPERATIONS_ENV_FILE || ".env.local" });

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const backupInput = String(process.env.RESTORE_BACKUP_PATH || process.argv[2] || "").trim();
const backupPath = backupInput ? path.resolve(backupInput) : "";
const manifestInput = String(process.env.RESTORE_MANIFEST_PATH || "").trim();
const manifestPath = manifestInput ? path.resolve(manifestInput) : backupPath ? `${backupPath}.manifest.json` : "";
const encryptionSecret = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
const restoreUrl = String(process.env.RESTORE_DATABASE_URL || "").trim();
const applyRestore = process.argv.includes("--restore");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
}

function pgEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

function decryptBackup(manifest) {
  const metadata = manifest.encryption || {};
  const key = crypto.scryptSync(encryptionSecret, Buffer.from(metadata.salt, "base64"), 32);
  const decipher = crypto.createDecipheriv(metadata.cipher || "aes-256-gcm", key, Buffer.from(metadata.iv, "base64"));
  decipher.setAuthTag(Buffer.from(metadata.authTag, "base64"));
  return Buffer.concat([decipher.update(fs.readFileSync(backupPath)), decipher.final()]);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error("RESTORE_BACKUP_PATH must point to an encrypted backup file.");
  if (!fs.existsSync(manifestPath)) throw new Error("The backup manifest was not found.");
  if (!encryptionSecret) throw new Error("BACKUP_ENCRYPTION_KEY is required for a restore drill.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (sha256(backupPath) !== manifest.sha256) throw new Error("Backup checksum verification failed.");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-restore-drill-"));
  const decryptedPath = path.join(tempDir, "restore.dump");
  try {
    fs.writeFileSync(decryptedPath, decryptBackup(manifest));
    const list = run("pg_restore", ["--list", decryptedPath]);
    if (list.status !== 0) throw new Error("The decrypted archive could not be read by pg_restore.");

    let restored = false;
    if (applyRestore) {
      if (process.env.RESTORE_DRILL_CONFIRM !== "RESTORE_TO_DISPOSABLE_DATABASE") {
        throw new Error("Restore refused. Set RESTORE_DRILL_CONFIRM=RESTORE_TO_DISPOSABLE_DATABASE.");
      }
      if (!restoreUrl) throw new Error("RESTORE_DATABASE_URL is required for --restore.");
      if (restoreUrl === String(process.env.DATABASE_URL || "").trim()) throw new Error("Restore drill database must not be the production database.");
      const restore = run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", new URL(restoreUrl).pathname.replace(/^\//, ""), decryptedPath], { env: { ...process.env, ...pgEnvironment(restoreUrl) } });
      if (restore.status !== 0) throw new Error("Restore into the disposable database failed.");
      restored = true;
    }
    console.log(JSON.stringify({ ok: true, checksumVerified: true, archiveReadable: true, restored, testedAt: new Date().toISOString() }, null, 2));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`Restore drill failed safely: ${String(error?.message || error).slice(0, 400)}`);
  process.exitCode = 1;
}
