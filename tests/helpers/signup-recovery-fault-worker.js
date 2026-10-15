// Offline HTTP fault fixture, not a replacement for PostgreSQL/Render staging.
const fs = require("node:fs");
const http = require("node:http");
const { runProvisioningStep } = require("../../server/provisioningState");
const file = process.argv[2];
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (state) => fs.writeFileSync(file, JSON.stringify(state));
global.fetch = async () => { throw Error("External network forbidden in fault worker"); };
let tail = Promise.resolve();
const runtimeStore = {
  async findUnique({ where }) { const data = read().rows[where.key]; return data ? { data } : null; },
  async upsert({ where, create, update }) {
    const state = read(); const data = state.rows[where.key] ? update.data : create.data;
    state.rows[where.key] = data; save(state); return { data };
  },
};
const prisma = { runtimeStore, $transaction(work) {
  const next = tail.then(() => work({ runtimeStore, $queryRaw: async () => [] }));
  tail = next.catch(() => {}); return next;
} };
const server = http.createServer(async (req, res) => {
  if (req.url !== "/stage") { res.writeHead(404); return res.end(); }
  const state = read();
  try {
    const result = await runProvisioningStep({ prisma, kind: state.kind, idempotencyKey: "synthetic-business", contextHash: "same-signed-context",
      verifyCompleted: async (saved) => read().provider?.id === saved.id,
      reconcile: async () => read().provider || null,
      execute: async () => {
        if (state.fault === "before-provider") process.exit(86);
        const current = read(); current.creates++; current.provider = { id: `${state.kind}-synthetic-resource` }; save(current);
        if (state.fault === "after-provider") process.exit(86);
        return current.provider;
      },
    });
    if (state.fault === "after-commit") process.exit(86);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ result }));
  } catch (error) {
    res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ code: error.code }));
  }
});
server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
