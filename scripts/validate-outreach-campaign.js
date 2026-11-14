const fs = require("node:fs");
const path = require("node:path");
const { rootDir } = require("./_helpers");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function fail(message) {
  process.stderr.write(`Campaign validation failed: ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const slug = arg("slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Pass a valid --slug=campaign-name.");

  const campaignDir = path.join(rootDir, "public", "campaigns", slug);
  const required = [
    "index.html",
    "email.html",
    "email.txt",
    "flyer.html",
    "flyer-preview.png",
    "campaign.json",
    "research.md",
    "README.md",
    `${slug}-campaign.zip`,
    path.join("assets", "hero.jpg"),
    path.join("assets", "email-flyer.jpg"),
  ];
  for (const relative of required) {
    const filePath = path.join(campaignDir, relative);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).size) fail(`Missing or empty ${relative}.`);
  }
  if (process.exitCode) return;

  const config = JSON.parse(fs.readFileSync(path.join(campaignDir, "campaign.json"), "utf8"));
  const indexHtml = fs.readFileSync(path.join(campaignDir, "index.html"), "utf8");
  const emailHtml = fs.readFileSync(path.join(campaignDir, "email.html"), "utf8");
  const emailText = fs.readFileSync(path.join(campaignDir, "email.txt"), "utf8");
  const allText = `${indexHtml}\n${emailHtml}\n${emailText}`;

  if (config.send_policy?.send_to_target_company !== false) fail("send_to_target_company must be false for a test campaign.");
  if (config.send_policy?.test_recipient !== "olliefromcanada@gmail.com") fail("The test recipient is not the approved Gmail address.");
  if (config.send_policy?.target_company_email_stored !== false) fail("The campaign must not store a target-company email address.");
  if (/{{[^}]+}}|\bTODO\b|localhost|file:\/\//i.test(allText)) fail("A placeholder or local-only URL remains in the campaign.");
  if (/<(?:script|audio|embed|object|iframe)\b/i.test(emailHtml)) fail("The email contains Gmail-unsafe markup.");
  if (!/utm_source=gmail/.test(emailHtml) || !emailHtml.includes(`utm_campaign=${slug}`)) fail("The email is missing campaign tracking parameters.");
  if (!/tel:\+12495033301/.test(indexHtml + emailHtml)) fail("The live-demo tel link is missing or incorrect.");
  if (!/noindex,nofollow/.test(indexHtml)) fail("The private concept page must be noindex/nofollow.");

  const imagePath = path.join(campaignDir, "assets", "email-flyer.jpg");
  const imageBytes = fs.statSync(imagePath).size;
  if (imageBytes < 100_000 || imageBytes > 700_000) fail(`Email flyer size ${imageBytes} is outside the 100–700 KB delivery target.`);

  if (arg("live", "false") === "true") {
    const urls = [config.public?.page_url, config.public?.image_url];
    for (const url of urls) {
      if (!/^https:\/\//.test(String(url || ""))) return fail(`Invalid public URL: ${url || "missing"}.`);
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) fail(`${url} returned HTTP ${response.status}.`);
      if (url.endsWith(".jpg") && !String(response.headers.get("content-type") || "").startsWith("image/")) {
        fail(`${url} did not return an image content type.`);
      }
    }
  }

  if (!process.exitCode) {
    process.stdout.write(JSON.stringify({
      ok: true,
      slug,
      recipient: config.send_policy.test_recipient,
      page_url: config.public.page_url,
      image_url: config.public.image_url,
      email_image_bytes: imageBytes,
    }, null, 2) + "\n");
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
