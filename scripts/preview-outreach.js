const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { rootDir } = require("./_helpers");

const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg ? portArg.split("=")[1] : 8791);
const previewFile = fileArg ? path.resolve(rootDir, fileArg.split("=").slice(1).join("=")) : "";

if (!previewFile || !fs.existsSync(previewFile) || path.extname(previewFile).toLowerCase() !== ".html") {
  throw new Error("Pass an existing HTML preview with --file=outreach-previews/<file>.html");
}

const server = http.createServer((req, res) => {
  if (!["/", "/index.html"].includes(String(req.url || "").split("?")[0])) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  fs.readFile(previewFile, (error, html) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Preview could not be read");
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(html);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Outreach preview ready: http://127.0.0.1:${port}\n`);
});
