const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const trackerRoot = path.join(root, "linkedin-outreach-tracker");
const databasePath = path.join(trackerRoot, "linkedin_job_leads.json");
const indexPath = path.join(trackerRoot, "index.html");
const appPath = path.join(trackerRoot, "app.js");
const stylePath = path.join(trackerRoot, "styles.css");

const allowedCategories = new Set([
  "IT Support",
  "Customer Support",
  "AI Automation",
  "Junior Dev",
  "Cybersecurity/SOC",
  "SAP/Other",
]);
const allowedPriorities = new Set([
  "Very High",
  "High",
  "Medium-High",
  "Medium",
  "Low-Medium",
]);
const allowedStatuses = new Set([
  "Not Applied",
  "Applied",
  "Connection Sent",
  "Accepted",
  "Follow-up Sent",
  "Rejected",
  "Closed",
]);
const requiredFields = [
  "id",
  "contact_name",
  "contact_title",
  "company",
  "role",
  "category",
  "priority",
  "odds_score",
  "post_link",
  "job_link",
  "evidence",
  "why_good",
  "connection_request",
  "follow_up_message",
  "status",
  "notes",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(filePath) {
  assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

const leads = JSON.parse(readText(databasePath));
const indexHtml = readText(indexPath);
const appJs = readText(appPath);
const styles = readText(stylePath);

assert(Array.isArray(leads), "linkedin_job_leads.json must contain an array.");
assert(leads.length === 23, `Expected 23 leads, found ${leads.length}.`);

const ids = new Set();
for (const [index, lead] of leads.entries()) {
  for (const field of requiredFields) {
    assert(
      Object.hasOwn(lead, field),
      `Lead ${index + 1} is missing required field "${field}".`,
    );
  }

  assert(!ids.has(lead.id), `Duplicate lead id: ${lead.id}`);
  ids.add(lead.id);
  assert(
    allowedCategories.has(lead.category),
    `Unsupported category on ${lead.id}: ${lead.category}`,
  );
  assert(
    allowedPriorities.has(lead.priority),
    `Unsupported priority on ${lead.id}: ${lead.priority}`,
  );
  assert(
    allowedStatuses.has(lead.status),
    `Unsupported status on ${lead.id}: ${lead.status}`,
  );
  assert(
    Number.isInteger(lead.odds_score) &&
      lead.odds_score >= 0 &&
      lead.odds_score <= 100,
    `Invalid odds_score on ${lead.id}.`,
  );
  assert(
    lead.connection_request.length <= 250,
    `Connection request exceeds 250 characters on ${lead.id}: ${lead.connection_request.length}`,
  );
  assert(
    lead.connection_request.length > 0,
    `Connection request is empty on ${lead.id}.`,
  );
  assert(
    lead.follow_up_message.length > 0,
    `Follow-up message is empty on ${lead.id}.`,
  );
  assert(
    lead.post_link.startsWith("https://www.linkedin.com/"),
    `Post link is not a LinkedIn URL on ${lead.id}.`,
  );
}

const hooks = [
  "leadCardTemplate",
  "categoryFilter",
  "statusFilter",
  "topFiveViewButton",
  "exportCsvButton",
  "exportJsonButton",
];
for (const hook of hooks) {
  assert(indexHtml.includes(`id="${hook}"`), `Missing UI hook: ${hook}`);
}

for (const category of allowedCategories) {
  assert(indexHtml.includes(`value="${category}"`), `Missing filter: ${category}`);
}
for (const status of allowedStatuses) {
  assert(indexHtml.includes(`value="${status}"`), `Missing status: ${status}`);
}

assert(appJs.includes("navigator.clipboard"), "Clipboard support is missing.");
assert(appJs.includes("window.localStorage"), "Local persistence is missing.");
assert(appJs.includes("exportCsv"), "CSV export is missing.");
assert(appJs.includes("exportJson"), "JSON export is missing.");
assert(appJs.includes("slice(0, 5)"), "Today's Top 5 logic is missing.");
assert(
  styles.includes("@media (max-width: 620px)"),
  "Mobile breakpoint is missing.",
);

const topFive = [...leads]
  .sort((left, right) => right.odds_score - left.odds_score)
  .slice(0, 5)
  .map((lead) => `${lead.contact_name} (${lead.odds_score})`);

console.log(`Validated ${leads.length} LinkedIn leads.`);
console.log("All connection requests are 250 characters or fewer.");
console.log(`Today's Top 5: ${topFive.join(", ")}`);
