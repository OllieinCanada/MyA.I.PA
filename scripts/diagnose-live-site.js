const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { ensureDir, rootPath } = require("./_helpers");

const DEFAULT_SITE_URL = "https://www.myaipa.ca/";
const DEFAULT_API_HEALTH_URL = "https://api.myaipa.ca/api/health";

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function fetchText(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, url, status: 0, body: "", headers: {}, ms: 0, error: error.message });
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "MyAIPA-live-site-diagnostic/1.0",
          Accept: "text/html,application/json,text/plain,*/*",
        },
        timeout: 12000,
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(status) && redirectsLeft > 0) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          fetchText(nextUrl, redirectsLeft - 1).then(resolve);
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: status >= 200 && status < 300,
            url,
            status,
            body,
            headers: response.headers,
            ms: Date.now() - startedAt,
            error: "",
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Request timed out"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, url, status: 0, body: "", headers: {}, ms: Date.now() - startedAt, error: error.message });
    });
  });
}

function assetPathsFromHtml(html) {
  const js = html.match(/static\/js\/main\.[^"']+\.js/)?.[0] || "";
  const css = html.match(/static\/css\/main\.[^"']+\.css/)?.[0] || "";
  return { js, css };
}

function resolveAssetUrl(siteUrl, assetPath) {
  if (!assetPath) return "";
  return new URL(assetPath.replace(/^\.\//, ""), siteUrl).toString();
}

function readLocalDocsAssets() {
  const indexPath = rootPath("docs", "index.html");
  if (!fs.existsSync(indexPath)) return { js: "", css: "" };
  return assetPathsFromHtml(fs.readFileSync(indexPath, "utf8"));
}

function scanBundle(bundle) {
  return {
    usesApiDomain: bundle.includes("https://api.myaipa.ca"),
    usesOldRenderApi: bundle.includes("https://myaipa-api.onrender.com"),
    usesLocalApi: /https?:\/\/(?:localhost|127\.0\.0\.1):8787/.test(bundle),
    includesAdminShell: bundle.includes("Control Center") || bundle.includes("Admin Dashboard"),
    includesSignupFlow: bundle.includes("Start free trial") || bundle.includes("Your new My AI PA number"),
  };
}

function statusLine(result) {
  if (!result.ok) return result.error ? `failed (${result.error})` : `HTTP ${result.status}`;
  return `HTTP ${result.status} in ${result.ms}ms`;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

async function main() {
  const siteUrl = getArg("url", process.env.LIVE_SITE_URL || DEFAULT_SITE_URL);
  const apiHealthUrl = getArg("api-health", process.env.LIVE_API_HEALTH_URL || DEFAULT_API_HEALTH_URL);
  const diagnosticsDir = rootPath("diagnostics", "live-site");
  const reportPath = path.join(diagnosticsDir, "live-site-report.md");

  console.log("Live site diagnostic");
  console.log("====================");
  console.log(`Site URL: ${siteUrl}`);
  console.log(`API health URL: ${apiHealthUrl}`);

  const localAssets = readLocalDocsAssets();
  const site = await fetchText(siteUrl);
  const liveAssets = site.ok ? assetPathsFromHtml(site.body) : { js: "", css: "" };
  const liveJs = liveAssets.js ? await fetchText(resolveAssetUrl(siteUrl, liveAssets.js)) : null;
  const apiHealth = await fetchText(apiHealthUrl);
  const bundleScan = liveJs?.ok ? scanBundle(liveJs.body) : null;
  const matchesLocalJs = Boolean(liveAssets.js && localAssets.js && liveAssets.js === localAssets.js);
  const matchesLocalCss = Boolean(liveAssets.css && localAssets.css && liveAssets.css === localAssets.css);

  const recommendations = [];
  if (!site.ok) {
    recommendations.push("Public website did not return a successful response; verify GitHub Pages/domain status.");
  } else if (!matchesLocalJs || !matchesLocalCss) {
    recommendations.push("Public website bundle differs from local `docs/`; live site is probably stale until Pages deploy is approved.");
  }
  if (bundleScan?.usesOldRenderApi || bundleScan?.usesLocalApi) {
    recommendations.push("Public bundle contains an unsafe/stale API base. Deploy the rebuilt `docs/` bundle after backend health is ready.");
  }
  if (bundleScan && !bundleScan.usesApiDomain) {
    recommendations.push("Public bundle did not contain `https://api.myaipa.ca`; confirm API base before deployment.");
  }
  if (!apiHealth.ok) {
    recommendations.push("Public API health is not reachable yet; Render service, DNS, or HTTPS certificate setup is still external launch work.");
  }
  if (!recommendations.length) {
    recommendations.push("Public site and API health matched the expected live assumptions in this read-only check.");
  }

  ensureDir(diagnosticsDir);
  const lines = [
    "# MyAIPA Live Site Diagnostic",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Public Site",
    "",
    `- URL: ${siteUrl}`,
    `- Result: ${statusLine(site)}`,
    `- Live JS bundle: ${liveAssets.js || "(not found)"}`,
    `- Live CSS bundle: ${liveAssets.css || "(not found)"}`,
    `- Local docs JS bundle: ${localAssets.js || "(not found)"}`,
    `- Local docs CSS bundle: ${localAssets.css || "(not found)"}`,
    `- JS matches local docs: ${yesNo(matchesLocalJs)}`,
    `- CSS matches local docs: ${yesNo(matchesLocalCss)}`,
    "",
    "## Public Bundle Scan",
    "",
    liveJs
      ? `- JS fetch: ${statusLine(liveJs)}`
      : "- JS fetch: skipped because no live JS bundle was found",
    `- Contains api.myaipa.ca: ${yesNo(bundleScan?.usesApiDomain)}`,
    `- Contains old Render API: ${yesNo(bundleScan?.usesOldRenderApi)}`,
    `- Contains localhost API: ${yesNo(bundleScan?.usesLocalApi)}`,
    `- Contains admin shell copy: ${yesNo(bundleScan?.includesAdminShell)}`,
    `- Contains signup flow copy: ${yesNo(bundleScan?.includesSignupFlow)}`,
    "",
    "## Public API",
    "",
    `- URL: ${apiHealthUrl}`,
    `- Result: ${statusLine(apiHealth)}`,
    "",
    "## Recommendations",
    "",
    ...recommendations.map((item) => `- ${item}`),
    "",
  ];

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);

  console.log(`Public site: ${statusLine(site)}`);
  console.log(`Live JS: ${liveAssets.js || "(not found)"}`);
  console.log(`Local JS: ${localAssets.js || "(not found)"}`);
  console.log(`JS matches local docs: ${yesNo(matchesLocalJs)}`);
  console.log(`CSS matches local docs: ${yesNo(matchesLocalCss)}`);
  console.log(`API health: ${statusLine(apiHealth)}`);
  console.log(`Report saved: ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
