const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function requireText(content, pattern, label) {
  if (!pattern.test(content)) failures.push(label);
}

const privacy = read("public/privacy.html");
const deletion = read("public/calendar-data.html");
const terms = read("public/terms.html");
const landing = read("src/LandingPage.js");
const render = read("render.yaml");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const buildPrivacy = fs.existsSync(path.join(root, "build")) ? read("build/privacy.html") : "";

requireText(privacy, /Google API Services User Data Policy/i, "Privacy page must disclose Google API policy compliance.");
requireText(privacy, /including the Limited Use requirements/i, "Privacy page must disclose Google Limited Use compliance.");
requireText(privacy, /calendar-data\.html/i, "Privacy page must link to calendar data controls.");
requireText(privacy, /do not sell/i, "Privacy page must explain that calendar data is not sold.");
requireText(deletion, /Disconnect inside My AI PA/i, "Calendar data page must explain in-product disconnection.");
requireText(deletion, /Request deletion/i, "Calendar data page must explain deletion requests.");
requireText(deletion, /Google connections/i, "Calendar data page must link to Google revocation controls.");
requireText(deletion, /Microsoft permissions/i, "Calendar data page must link to Microsoft revocation controls.");
requireText(terms, /Calendar authorization/i, "Terms page must describe calendar authorization.");
requireText(landing, /href="\/privacy\.html"/, "Homepage must visibly link to the direct privacy page.");
requireText(landing, /href="\/calendar-data\.html"/, "Homepage must visibly link to calendar data controls.");
requireText(landing, /calendar access is used only to check availability and manage appointments/i, "Homepage must explain why calendar access is requested.");
requireText(robots, /Sitemap: https:\/\/www\.myaipa\.ca\/sitemap\.xml/, "robots.txt must expose the public sitemap.");
requireText(sitemap, /https:\/\/www\.myaipa\.ca\/privacy\.html/, "Sitemap must include the direct privacy URL.");
requireText(sitemap, /https:\/\/www\.myaipa\.ca\/calendar-data\.html/, "Sitemap must include the calendar deletion URL.");
requireText(render, /GOOGLE_CALENDAR_REDIRECT_URI[\s\S]*https:\/\/api\.myaipa\.ca\/api\/calendar\/oauth\/google\/callback/, "Render must carry the exact Google callback URI.");
requireText(render, /MICROSOFT_CALENDAR_REDIRECT_URI[\s\S]*https:\/\/api\.myaipa\.ca\/api\/calendar\/oauth\/microsoft\/callback/, "Render must carry the exact Microsoft callback URI.");
if (buildPrivacy) requireText(buildPrivacy, /Google API Services User Data Policy/i, "Production build must include the calendar privacy disclosure.");

if (failures.length) {
  console.error("Calendar OAuth readiness validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Calendar OAuth readiness validation passed.");
