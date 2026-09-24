const fs = require("fs");
const path = require("path");
const { prisma } = require("../server/prisma");
const { recordRuntimeIncidentDb } = require("../server/runtimeIncidentRepository");
const { rootPath } = require("./_helpers");

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : rootPath("data");

const stores = [
  ["pending-signup-verifications", "pending-signup-verifications.json"],
  ["trial-reminders", "trial-reminders.json"],
  ["signup-dashboard", "signup-dashboard.json"],
  ["vapi-call-sync", "vapi-call-sync.json"],
];

function readJsonStore(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }
}

function readJsonDocument(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }
}

async function importRuntimeIncidents() {
  const document = readJsonDocument(path.join(dataDir, "runtime-incidents.json"), { items: [] });
  const items = Array.isArray(document?.items) ? document.items : [];
  let imported = 0;
  for (const item of items) {
    const incident = {
      ...(item?.incident || {}),
      incidentId: item?.id,
      severity: item?.severity,
      whatFailed: item?.title,
      impact: item?.summary,
      snapshot: item?.snapshot,
      detectedAt: item?.detectedAt,
      businessName: item?.businessName,
      remediation: item?.remediation,
    };
    const result = await recordRuntimeIncidentDb(prisma, incident);
    if (result.recorded) imported += 1;
  }
  console.log(`- runtime-incidents: ${imported} records`);
}

async function importTelegramOutbox() {
  const document = readJsonDocument(path.join(dataDir, "telegram-outbox.json"), { items: [], deliveryReceipts: [] });
  const items = Array.isArray(document?.items) ? document.items : [];
  const receipts = Array.isArray(document?.deliveryReceipts) ? document.deliveryReceipts : [];
  let imported = 0;
  for (const item of items) {
    if (!/^[a-f0-9]{24}$/i.test(String(item?.id || "")) || !/^[a-f0-9]{64}$/i.test(String(item?.dedupeHash || ""))) continue;
    await prisma.telegramOutboxMessage.upsert({
      where: { id: String(item.id).toLowerCase() },
      update: {},
      create: {
        id: String(item.id).toLowerCase(),
        dedupeHash: String(item.dedupeHash).toLowerCase(),
        text: String(item.text || "").slice(0, 3900),
        adminUrl: item.adminUrl || null,
        buttonText: item.buttonText || null,
        inlineKeyboard: item.inlineKeyboard || undefined,
        status: "PENDING",
        attempts: Math.max(0, Number(item.attempts || 0)),
        nextAttemptAt: new Date(Number(item.nextAttemptAt || Date.now())),
        lastAttemptAt: item.lastAttemptAt ? new Date(Number(item.lastAttemptAt)) : null,
        lastStatus: Number.isInteger(Number(item.lastStatus)) ? Number(item.lastStatus) : null,
        lastFailure: item.lastFailure ? String(item.lastFailure).slice(0, 40) : null,
        createdAt: new Date(Number(item.createdAt || Date.now())),
      },
    });
    imported += 1;
  }
  for (const receipt of receipts) {
    if (!/^[a-f0-9]{24}$/i.test(String(receipt?.id || "")) || !/^[a-f0-9]{64}$/i.test(String(receipt?.dedupeHash || ""))) continue;
    await prisma.telegramOutboxMessage.upsert({
      where: { id: String(receipt.id).toLowerCase() },
      update: {
        status: "DELIVERED",
        deliveredAt: new Date(Number(receipt.deliveredAt || Date.now())),
        providerMessageId: Number.isSafeInteger(Number(receipt.providerMessageId)) ? Number(receipt.providerMessageId) : null,
      },
      create: {
        id: String(receipt.id).toLowerCase(),
        dedupeHash: String(receipt.dedupeHash).toLowerCase(),
        text: "Migrated Telegram delivery receipt",
        status: "DELIVERED",
        nextAttemptAt: new Date(Number(receipt.deliveredAt || Date.now())),
        deliveredAt: new Date(Number(receipt.deliveredAt || Date.now())),
        providerMessageId: Number.isSafeInteger(Number(receipt.providerMessageId)) ? Number(receipt.providerMessageId) : null,
      },
    });
  }
  console.log(`- telegram-outbox: ${imported} pending messages; ${receipts.length} delivery receipts`);
}

async function main() {
  console.log(`Importing runtime JSON stores from ${dataDir}`);

  for (const [key, fileName] of stores) {
    const filePath = path.join(dataDir, fileName);
    const data = readJsonStore(filePath);
    const count = Object.keys(data).length;

    await prisma.runtimeStore.upsert({
      where: { key },
      update: { data },
      create: { key, data },
    });

    console.log(`- ${key}: ${count} records`);
  }

  await importRuntimeIncidents();
  await importTelegramOutbox();

  console.log("Runtime JSON store import complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
