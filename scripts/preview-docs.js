const fs = require("fs");
const http = require("http");
const path = require("path");
const { rootPath } = require("./_helpers");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg ? portArg.split("=")[1] : process.env.PORT || "3101");
const host = "127.0.0.1";
const docsDir = rootPath("docs");

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
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(docsDir, relative);
  if (!candidate.startsWith(docsDir)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return rootPath("docs", "index.html");
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequestPath(req.url || "/");
  if (!filePath) return send(res, 403, "Forbidden");

  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Docs preview ready: http://${host}:${port}`);
});
