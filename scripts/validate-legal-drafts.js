const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const legalDir = path.resolve(root, String(process.env.LEGAL_DRAFTS_DIR || "legal"));
const required = process.argv.includes("--required") || String(process.env.LEGAL_DRAFTS_REQUIRED || "").trim().toLowerCase() === "true";
const requiredFiles = [
  "README.md",
  "PRIVACY_POLICY_DRAFT.md",
  "TERMS_OF_SERVICE_DRAFT.md",
  "DATA_PROCESSING_ADDENDUM_DRAFT.md",
  "DATA_INVENTORY_AND_RETENTION_DRAFT.md",
  "PRIVACY_MANAGEMENT_PROGRAM_DRAFT.md",
  "BREACH_RESPONSE_PLAN_DRAFT.md",
  "CASL_AND_MESSAGING_COMPLIANCE_DRAFT.md",
  "CUSTOMER_COMPLIANCE_ACKNOWLEDGEMENT_DRAFT.md",
  "LEGAL_REVIEW_ISSUES.md",
];

if (!fs.existsSync(legalDir)) {
  if (required) {
    console.error("Legal draft validation failed: private legal draft directory is missing.");
    process.exit(1);
  }
  console.log("Legal draft validation skipped: private drafts are not present in this public checkout.");
  console.log("Counsel approval and completed customer-facing legal documents remain separate launch requirements.");
  process.exit(0);
}

const failures = [];
for (const filename of requiredFiles) {
  const filePath = path.join(legalDir, filename);
  if (!fs.existsSync(filePath)) {
    failures.push(`${filename} is missing`);
    continue;
  }
  const text = fs.readFileSync(filePath, "utf8");
  if (!/DRAFT/i.test(text) || !/COUNSEL REVIEW REQUIRED/i.test(text)) {
    failures.push(`${filename} must remain clearly marked as a draft requiring counsel review`);
  }
  if (text.trim().length < 500) {
    failures.push(`${filename} appears unexpectedly short`);
  }
}

const packageText = requiredFiles
  .filter((filename) => fs.existsSync(path.join(legalDir, filename)))
  .map((filename) => fs.readFileSync(path.join(legalDir, filename), "utf8"))
  .join("\n");

for (const expected of [
  "PIPEDA",
  "Privacy Officer",
  "retention",
  "breach",
  "consent",
  "CASL",
  "subprocessor",
  "access",
  "correction",
  "complaint",
]) {
  if (!packageText.toLowerCase().includes(expected.toLowerCase())) {
    failures.push(`legal package should address ${expected}`);
  }
}

if (failures.length) {
  console.error("Legal draft validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Legal draft validation passed (${requiredFiles.length} files).`);
console.log("These remain drafts and still require completion of placeholders, operational verification, and qualified Canadian counsel review.");
