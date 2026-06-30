const fs = require("fs");
const path = require("path");
const { prisma } = require("../server/prisma");
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
