const fs = require("fs");
const net = require("net");
const os = require("os");
const { npmCommand, rootPath, spawnDetached } = require("./_helpers");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const startPort = Number(portArg ? portArg.split("=")[1] : process.env.PORT || "3000");
const maxAttemptsArg = process.argv.find((arg) => arg.startsWith("--max-attempts="));
const maxAttempts = Number(maxAttemptsArg ? maxAttemptsArg.split("=")[1] : "10");
const timeoutSecondsArg = process.argv.find((arg) => arg.startsWith("--timeout-seconds="));
const timeoutMs = Number(timeoutSecondsArg ? timeoutSecondsArg.split("=")[1] : "120") * 1000;
const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
const host = hostArg ? hostArg.split("=").slice(1).join("=") : process.env.HOST || "127.0.0.1";
const lanMode = process.argv.includes("--lan") || host === "0.0.0.0";
const loopbackHost = host === "127.0.0.1" || host === "localhost" || host === "::1";

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
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

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return url;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error(`Preview did not respond at ${url} within ${Math.round(timeoutMs / 1000)} seconds. Last error: ${lastError}`);
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
      HOST: host,
      PORT: String(port),
      // CRA 5 creates an invalid empty allowedHosts entry when a proxy is
      // configured and the dev server is bound only to loopback.
      ...(loopbackHost ? { DANGEROUSLY_DISABLE_HOST_CHECK: "true" } : {}),
    },
    stdio: ["ignore", out, err],
  });

  const url = await waitForServer(port);
  console.log(`Preview ready: ${url}`);
  if (lanMode) {
    const lanAddresses = getLanAddresses();
    if (lanAddresses.length) {
      console.log("Same-network URLs:");
      for (const address of lanAddresses) console.log(`- http://${address}:${port}`);
    } else {
      console.log("No non-internal IPv4 network address was detected.");
    }
  }
  console.log(`Logs: ${outPath} and ${errPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
