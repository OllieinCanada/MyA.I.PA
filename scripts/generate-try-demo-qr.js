const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { rootPath } = require("./_helpers");

const targetUrl = String(
  process.env.TRY_DEMO_URL || "https://www.myaipa.ca/#/try-demo?source=qr"
).trim();
const publicPng = rootPath("public", "my-ai-pa-try-demo-qr.png");
const publicSvg = rootPath("public", "my-ai-pa-try-demo-qr.svg");
const phoneSharePng = rootPath("phone-share", "my-ai-pa-try-demo-qr.png");

async function main() {
  if (!/^https:\/\/www\.myaipa\.ca\/#\/try-demo(?:\?|$)/i.test(targetUrl)) {
    throw new Error("TRY_DEMO_URL must point to the public My AI PA try-demo route.");
  }

  fs.mkdirSync(path.dirname(phoneSharePng), { recursive: true });
  const options = {
    errorCorrectionLevel: "H",
    margin: 4,
    color: {
      dark: "#07142AFF",
      light: "#FFFFFFFF",
    },
  };
  await QRCode.toFile(publicPng, targetUrl, { ...options, type: "png", width: 1200 });
  await QRCode.toFile(publicSvg, targetUrl, { ...options, type: "svg" });
  fs.copyFileSync(publicPng, phoneSharePng);

  console.log(JSON.stringify({
    ok: true,
    targetUrl,
    publicPng,
    publicSvg,
    phoneSharePng,
    errorCorrectionLevel: options.errorCorrectionLevel,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
