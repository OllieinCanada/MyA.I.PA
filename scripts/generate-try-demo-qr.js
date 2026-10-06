const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { rootPath } = require("./_helpers");

const targetUrl = String(
  process.env.QR_TARGET_URL || "https://www.myaipa.ca/"
).trim();
const electricalUrl = "https://www.myaipa.ca/#/trades/electricians";
const generalContractorsUrl = "https://www.myaipa.ca/#/trades/general-contractors";
const fileBase = targetUrl === generalContractorsUrl ? "my-ai-pa-general-contractors-qr"
  : targetUrl === electricalUrl ? "my-ai-pa-electrical-qr" : "my-ai-pa-homepage-qr";
const publicPng = rootPath("public", `${fileBase}.png`);
const publicSvg = rootPath("public", `${fileBase}.svg`);
const phoneSharePng = rootPath("phone-share", `${fileBase}.png`);

async function main() {
  if (!["https://www.myaipa.ca/", electricalUrl, generalContractorsUrl].includes(targetUrl)) {
    throw new Error("QR_TARGET_URL must be the public My AI PA homepage, electrical or general-contractors landing page.");
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
