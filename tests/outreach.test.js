const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SEND_CONFIRMATION,
  createBusinessOutreachPackage,
  htmlToText,
  loadOutreachPackage,
  resolveAudioFile,
  saveOutreachPackage,
  sendStoredOutreachPackage,
} = require("../server/outreach");

const input = {
  business_name: "First Class Rentals",
  business_website: "https://www.firstclassrentalsniagara.ca/",
  business_description: "Affordable rental housing company in St. Catharines with listings, applications, convenient locations, resident support and rental units near transit and shopping.",
};

const generatedContent = {
  industry: "Rental housing",
  location: "St. Catharines",
  customer_type: "Renters and residents",
  services: ["Rental listings", "Applications", "Resident support"],
  likely_questions: ["What units are available?", "How do I apply?", "Is the property near transit?", "Who do I contact for resident support?"],
  pain_points: ["After-hours rental questions", "Repeated application and location questions"],
  my_ai_pa_use_cases: ["Answer common questions", "Guide renters to listings", "Direct residents to support"],
  source_facts: ["St. Catharines", "Rental listings", "Applications", "Resident support", "Near transit and shopping"],
  audio_script: "Hi First Class Rentals — this is My AI PA. A renter visiting your site could ask what units are available, how to apply, whether a property is close to transit or shopping, or where to find resident support. I can respond right away, guide them toward the right listing, application, or support path, and help your team spend less time repeating the same information.",
  email_subject: "A renter-assistant concept for First Class Rentals",
  email_headline: "A 24/7 rental assistant built around First Class Rentals",
  email_intro: "I noticed First Class Rentals focuses on affordable St. Catharines housing, with listings, applications, convenient locations and resident support.",
  email_pain_point: "A prospective renter can arrive after hours with a few practical questions before they are ready to apply:",
  email_value: "My AI PA could answer those routine questions immediately, guide renters toward the right listing or application, and direct residents to the appropriate support path—without claiming an integration already exists.",
};

function fakeMp3() {
  return Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2400, 1)]);
}

test("outreach package creates a real MP3 path and Gmail-safe personalized email", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-outreach-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const outreachPackage = await createBusinessOutreachPackage(input, {
    baseUrl: "https://api.myaipa.ca",
    dataDir,
    contentGenerator: async () => generatedContent,
    ttsGenerator: async () => fakeMp3(),
    fetchWebsite: async () => new Response("<html><body>Listings, applications and resident support in St. Catharines.</body></html>", { headers: { "content-type": "text/html" } }),
  });

  assert.equal(outreachPackage.quality.passed, true);
  assert.match(outreachPackage.audio.url, /^https:\/\/api\.myaipa\.ca\/api\/outreach\/audio\/.+\.mp3$/);
  assert.ok(resolveAudioFile(dataDir, outreachPackage.audio.filename));
  assert.match(outreachPackage.email.html, /Personalized for First Class Rentals/);
  assert.match(outreachPackage.email.html, /href="https:\/\/www\.myaipa\.ca\/"/);
  assert.doesNotMatch(outreachPackage.email.html, /<(audio|embed|object|iframe)\b/i);
  assert.doesNotMatch(outreachPackage.email.html, /{{[^}]+}}/);
  assert.equal((outreachPackage.audio.script.match(/First Class Rentals/g) || []).length, 1);
});

test("website text extraction excludes executable and styled content", () => {
  const text = htmlToText("<style>.secret{display:none}</style><script>steal()</script><h1>Rental listings</h1><p>Near transit</p>");
  assert.equal(text, "Rental listings Near transit");
});

test("stored package sends once only after explicit confirmation", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-outreach-send-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const outreachPackage = await createBusinessOutreachPackage(input, {
    baseUrl: "https://api.myaipa.ca",
    dataDir,
    contentGenerator: async () => generatedContent,
    ttsGenerator: async () => fakeMp3(),
  });
  saveOutreachPackage(outreachPackage, { dataDir });
  let sends = 0;
  const sendMail = async (message) => {
    sends += 1;
    assert.equal(message.to, "olliefromcanada@gmail.com");
    return { messageId: "test-message-id" };
  };

  await assert.rejects(
    sendStoredOutreachPackage({ packageId: outreachPackage.id, to: "olliefromcanada@gmail.com", confirmation: "no" }, { dataDir, sendMail }),
    /Explicit confirmation/
  );
  const sent = await sendStoredOutreachPackage({
    packageId: outreachPackage.id,
    to: "olliefromcanada@gmail.com",
    confirmation: SEND_CONFIRMATION,
  }, { dataDir, sendMail });
  assert.equal(sent.package.delivery.status, "sent");
  assert.equal(sends, 1);
  await assert.rejects(
    sendStoredOutreachPackage({ packageId: outreachPackage.id, to: "olliefromcanada@gmail.com", confirmation: SEND_CONFIRMATION }, { dataDir, sendMail }),
    /already has a delivery attempt/
  );
  assert.equal(sends, 1);
  assert.equal(loadOutreachPackage(outreachPackage.id, { dataDir }).delivery.message_id, "test-message-id");
});
