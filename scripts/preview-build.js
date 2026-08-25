const fs = require("fs");
const http = require("http");
const path = require("path");
const { rootPath } = require("./_helpers");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg ? portArg.split("=")[1] : process.env.PORT || "3000");
const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
const host = hostArg ? hostArg.split("=").slice(1).join("=") : process.env.HOST || "127.0.0.1";
const configuredBuildDir = String(process.env.BUILD_PREVIEW_DIR || "").trim();
const buildDir = configuredBuildDir ? path.resolve(configuredBuildDir) : rootPath("build");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(buildDir, relative);
  if (!candidate.startsWith(buildDir)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return path.join(buildDir, "index.html");
}

if (!fs.existsSync(path.join(buildDir, "index.html"))) {
  throw new Error(`Missing ${path.join(buildDir, "index.html")}. Build the selected preview output first.`);
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequestPath(req.url || "/");
  if (!filePath) return send(res, 403, "Forbidden");

  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Build preview ready: http://${host}:${port}`);
});
