const fs = require("fs");
const net = require("net");
const { npmCommand, rootPath, spawnDetached } = require("./_helpers");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const startPort = Number(portArg ? portArg.split("=")[1] : process.env.PORT || "3000");
const maxAttemptsArg = process.argv.find((arg) => arg.startsWith("--max-attempts="));
const maxAttempts = Number(maxAttemptsArg ? maxAttemptsArg.split("=")[1] : "10");

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort() {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (await isPortFree(port)) return port;
    console.log(`Port ${port} is busy or unhealthy; trying ${port + 1}...`);
  }

  throw new Error(`No free port found from ${startPort} through ${startPort + maxAttempts - 1}.`);
}

async function waitForServer(port) {
  const url = `http://localhost:${port}`;
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 45000) {
    try {
      const response = await fetch(url);
      if (response.ok) return url;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error(`Preview did not respond at ${url} within 45 seconds. Last error: ${lastError}`);
}

async function main() {
  const port = await findFreePort();
  const outPath = rootPath(".codex-preview-fresh.out.log");
  const errPath = rootPath(".codex-preview-fresh.err.log");
  const out = fs.openSync(outPath, "a");
  const err = fs.openSync(errPath, "a");

  console.log(`Starting local preview on http://localhost:${port}`);
  spawnDetached(npmCommand(), ["start"], {
    env: {
      BROWSER: "none",
      PORT: String(port),
    },
    stdio: ["ignore", out, err],
  });

  const url = await waitForServer(port);
  console.log(`Preview ready: ${url}`);
  console.log(`Logs: ${outPath} and ${errPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
