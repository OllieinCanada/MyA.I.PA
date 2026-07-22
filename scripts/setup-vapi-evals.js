const fs = require("fs");
const { loadProjectEnv, redact, rootPath } = require("./_helpers");

const env = loadProjectEnv();

function parseArgs(argv) {
  const options = {
    dryRun: false,
    includeToolEvals: false,
    list: false,
    runAll: false,
    runSafe: false,
    sync: false,
    allowLiveTools: false,
    targetAssistantId: "",
    targetPhone: "",
    suiteFile: "",
    keys: [],
    pruneLegacy: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--include-tool-evals") options.includeToolEvals = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--run-all") options.runAll = true;
    else if (arg === "--run-safe") options.runSafe = true;
    else if (arg === "--sync") options.sync = true;
    else if (arg === "--allow-live-tools") options.allowLiveTools = true;
    else if (arg === "--target") options.targetAssistantId = argv[++index] || "";
    else if (arg.startsWith("--target=")) options.targetAssistantId = arg.slice("--target=".length);
    else if (arg === "--target-phone") options.targetPhone = argv[++index] || "";
    else if (arg.startsWith("--target-phone=")) options.targetPhone = arg.slice("--target-phone=".length);
    else if (arg === "--suite") options.suiteFile = argv[++index] || "";
    else if (arg.startsWith("--suite=")) options.suiteFile = arg.slice("--suite=".length);
    else if (arg === "--keys") options.keys = String(argv[++index] || "").split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg.startsWith("--keys=")) options.keys = arg.slice("--keys=".length).split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--prune-legacy") options.pruneLegacy = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.sync && (options.runSafe || options.runAll)) options.sync = true;
  if (!options.sync && !options.dryRun && !options.list && !options.help) options.list = true;
  if (options.runAll) options.includeToolEvals = true;

  return options;
}

function usage() {
  return [
    "Usage: node scripts/setup-vapi-evals.js [options]",
    "",
    "Options:",
    "  --list                    Show local eval definitions without network calls",
    "  --dry-run                 Show what would sync without network calls",
    "  --sync                    Create or update default-safe evals in Vapi",
    "  --run-safe                Run only evals marked safeToRun",
    "  --include-tool-evals      Also sync evals that require a mock SMS target",
    "  --run-all --allow-live-tools",
    "                            Run every eval, including tool-call evals",
    "  --target <assistant-id>   Override the target assistant ID",
    "  --target-phone <number>   Resolve the target from an assigned phone number or last four digits",
    "  --suite <path>            Override the suite JSON file",
    "  --keys <key,key>          Limit sync/run to selected local eval keys",
    "  --prune-legacy            Delete duplicate evals with listed legacy names after sync",
  ].join("\n");
}

function readSuite(filePath) {
  const resolved = rootPath(filePath || env.VAPI_EVAL_SUITE_FILE || "config/vapi-agent-evals.json");
  const suite = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!Array.isArray(suite.evals) || suite.evals.length === 0) {
    throw new Error(`No evals found in ${resolved}`);
  }
  return { suite, resolved };
}

function aiJudgePlan(instructions, defaults) {
  return {
    type: "ai",
    model: {
      provider: defaults.judgeProvider || "openai",
      model: defaults.judgeModel || "gpt-4o-mini",
      temperature: defaults.judgeTemperature ?? 0,
      maxTokens: defaults.judgeMaxTokens ?? 50,
      messages: [
        {
          role: "system",
          content: `${instructions}\n\nReply with exactly pass or fail.`,
        },
        {
          role: "user",
          content: "Conversation messages:\n{{messages}}\n\nEvaluate only the latest assistant message:\n{{messages[-1]}}",
        },
      ],
    },
  };
}

function normalizeMessage(message, defaults) {
  const clone = JSON.parse(JSON.stringify(message));
  const aiJudge = clone.aiJudge;
  delete clone.aiJudge;

  if (aiJudge) {
    if (clone.judgePlan) {
      throw new Error("Eval message cannot define both aiJudge and judgePlan.");
    }
    clone.judgePlan = aiJudgePlan(aiJudge, defaults);
  }

  return clone;
}

function toVapiEval(localEval, suite) {
  const defaults = suite.defaults || {};
  return {
    name: localEval.name,
    description: localEval.description,
    type: localEval.type || defaults.type || "chat.mockConversation",
    messages: localEval.messages.map((message) => normalizeMessage(message, defaults)),
  };
}

function selectedForSync(evals, includeToolEvals) {
  return evals.filter((item) => includeToolEvals || item.syncByDefault !== false);
}

function selectedForRun(evals, options) {
  if (options.runAll) return evals;
  if (!options.runSafe) return [];
  return evals.filter((item) => item.safeToRun !== false);
}

function requireApiKey() {
  const key = env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN;
  if (!key) {
    throw new Error("Set VAPI_API_KEY, VAPI_KEY, or VAPI_TOKEN before syncing or running Vapi evals.");
  }
  return key;
}

function buildClient(apiKey) {
  const baseUrl = (env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  return async function api(path, options = {}, label = path) {
    const method = options.method || "GET";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (response.ok) return data;
      if (method === "GET" && (response.status === 429 || response.status >= 500) && attempt < 4) {
        await sleep(attempt * 750);
        continue;
      }
      const detail = text ? `: ${text.slice(0, 700)}` : "";
      throw new Error(`${label} failed with HTTP ${response.status}${detail}`);
    }
    throw new Error(`${label} failed after read-only retries.`);
  };
}

async function listRemoteEvals(api) {
  const data = await api("/eval?limit=1000&page=1", {}, "List evals");
  if (Array.isArray(data)) return data;
  return data.results || data.data || [];
}

async function resolveTargetAssistantFromPhone(api, targetPhone) {
  const digits = String(targetPhone || "").replace(/\D/g, "");
  if (digits.length < 4) throw new Error("--target-phone requires at least the last four digits.");
  const data = await api("/phone-number?limit=1000", {}, "List phone numbers for eval target");
  const phones = Array.isArray(data) ? data : data.results || data.data || data.phoneNumbers || [];
  const matches = phones.filter((phone) => {
    const value = String(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || "").replace(/\D/g, "");
    return value.endsWith(digits);
  });
  if (matches.length !== 1) throw new Error(`Expected one Vapi phone ending in ${digits.slice(-4)}, found ${matches.length}.`);
  const assistantId = String(matches[0]?.assistantId || matches[0]?.assistant?.id || "").trim();
  if (!assistantId) throw new Error(`The Vapi phone ending in ${digits.slice(-4)} has no assigned assistant.`);
  return assistantId;
}

function findExistingEval(localEval, payload, existingByName) {
  const names = [payload.name, ...(localEval.legacyNames || [])];
  for (const name of names) {
    const existing = existingByName.get(name);
    if (existing) return existing;
  }
  return null;
}

async function upsertEval(api, localEval, payload, existingByName) {
  const existing = findExistingEval(localEval, payload, existingByName);
  if (existing) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const updated = await api(`/eval/${existing.id}`, { method: "PATCH", body: payload }, `Update ${payload.name}`);
        return { action: "updated", eval: updated || existing };
      } catch (error) {
        lastError = error;
        if (!/HTTP (?:429|5\d\d)\b/.test(String(error?.message || "")) || attempt === 3) break;
        await sleep(attempt * 750);
      }
    }
    if (/HTTP 5\d\d\b/.test(String(lastError?.message || ""))) {
      return {
        action: "kept-existing-after-vapi-error",
        eval: existing,
        warning: String(lastError.message || lastError),
      };
    }
    throw lastError;
  }
  const created = await api("/eval", { method: "POST", body: payload }, `Create ${payload.name}`);
  return { action: "created", eval: created };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRun(api, runId) {
  const started = Date.now();
  const timeoutMs = Number(env.VAPI_EVAL_RUN_TIMEOUT_MS || 180000);
  while (Date.now() - started < timeoutMs) {
    const run = await api(`/eval/run/${runId}`, {}, `Fetch eval run ${runId}`);
    if (run.status === "ended") return run;
    await sleep(3000);
  }
  throw new Error(`Eval run ${runId} did not finish within ${timeoutMs}ms.`);
}

async function findRecentRun(api, evalId, startedAtMs) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const data = await api("/eval/run?limit=25&page=1", {}, `Find recent eval run for ${evalId}`);
    const runs = Array.isArray(data) ? data : data.results || data.data || [];
    const matching = runs
      .filter((run) => run.evalId === evalId && new Date(run.createdAt).getTime() >= startedAtMs - 5000)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (matching[0]) return matching[0];
    await sleep(1000);
  }
  throw new Error(`Could not find recent eval run for ${evalId}.`);
}

async function runEval(api, evalRecord, payload, targetAssistantId) {
  const startedAtMs = Date.now();
  const created = await api(
    "/eval/run",
    {
      method: "POST",
      body: {
        type: "eval",
        evalId: evalRecord.id,
        target: {
          type: "assistant",
          assistantId: targetAssistantId,
        },
      },
    },
    `Run ${payload.name}`
  );
  const runId = created?.id || created?.run?.id || created?.data?.id;
  const createdRun = runId ? created : await findRecentRun(api, evalRecord.id, startedAtMs);
  const run = createdRun.status === "ended" ? createdRun : await pollRun(api, runId || createdRun.id);
  const resultStatuses = (run.results || []).map((result) => result.status);
  const passed =
    run.status === "ended" &&
    run.endedReason === "mockConversation.done" &&
    resultStatuses.length > 0 &&
    resultStatuses.every((status) => status === "pass");
  return { passed, run };
}

function printLocalSummary(suite, selectedSync, selectedRun, options, targetAssistantId, suitePath) {
  console.log("MyAIPA Vapi eval suite");
  console.log("======================");
  console.log(`Suite: ${suite.suiteName} (${suite.version})`);
  console.log(`File: ${suitePath}`);
  console.log(`Target assistant: ${targetAssistantId}`);
  console.log(`Default sync evals: ${selectedSync.length}/${suite.evals.length}`);
  if (options.runSafe || options.runAll) console.log(`Run evals: ${selectedRun.length}/${suite.evals.length}`);
  console.log("");
  for (const item of suite.evals) {
    const flags = [
      item.safeToRun === false ? "mock-target-required" : "safe",
      item.syncByDefault === false ? "local-by-default" : "sync-by-default",
    ].join(", ");
    console.log(`- ${item.key}: ${item.name} (${flags})`);
  }
}

function summarizeRunFailure(run) {
  const lines = [];
  for (const result of run.results || []) {
    for (const message of result.messages || []) {
      if (message.judge?.status === "fail") {
        if (message.judge.failureReason) lines.push(message.judge.failureReason);
        if (message.content) lines.push(`Assistant said: ${message.content}`);
        if (message.toolCalls) lines.push(`Assistant tool calls: ${JSON.stringify(message.toolCalls)}`);
      }
    }
  }
  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.runAll && !options.allowLiveTools) {
    throw new Error("--run-all requires --allow-live-tools because tool-call evals can invoke live SMS tools.");
  }

  const { suite, resolved } = readSuite(options.suiteFile);
  const targetPhone = options.targetPhone
    || env.VAPI_EVAL_TARGET_PHONE
    || (!options.targetAssistantId && !env.VAPI_EVAL_TARGET_ASSISTANT_ID ? suite.recommendedTargetPhoneLast4 : "");
  let targetAssistantId = options.targetPhone
    ? ""
    : options.targetAssistantId || env.VAPI_EVAL_TARGET_ASSISTANT_ID || suite.targetAssistantIdDefault;
  if (!targetAssistantId && !targetPhone) throw new Error("Set VAPI_EVAL_TARGET_ASSISTANT_ID, VAPI_EVAL_TARGET_PHONE, --target, or --target-phone.");

  const scopedEvals = options.keys.length
    ? suite.evals.filter((item) => options.keys.includes(item.key))
    : suite.evals;
  if (options.keys.length && scopedEvals.length !== new Set(options.keys).size) {
    throw new Error("One or more --keys values do not match an eval in the suite.");
  }
  const syncItems = selectedForSync(scopedEvals, options.includeToolEvals);
  const runItems = selectedForRun(scopedEvals, options);
  printLocalSummary(suite, syncItems, runItems, options, targetPhone ? `phone ending ${String(targetPhone).replace(/\D/g, "").slice(-4)}` : targetAssistantId, resolved);

  if (options.list) return;
  if (options.dryRun) {
    console.log("");
    console.log("Dry run only. No Vapi changes were made.");
    return;
  }

  const apiKey = requireApiKey();
  const api = buildClient(apiKey);
  if (targetPhone) targetAssistantId = await resolveTargetAssistantFromPhone(api, targetPhone);
  console.log("");
  console.log(`Vapi API: ${(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "")} (${redact(apiKey)})`);

  const existing = await listRemoteEvals(api);
  const existingByName = new Map(existing.map((item) => [item.name, item]));
  const syncedByKey = new Map();

  if (options.sync) {
    console.log("");
    console.log("Syncing eval definitions");
    for (const item of syncItems) {
      const payload = toVapiEval(item, suite);
      const result = await upsertEval(api, item, payload, existingByName);
      syncedByKey.set(item.key, result.eval);
      existingByName.set(payload.name, result.eval);
      console.log(`- ${result.action}: ${payload.name} (${result.eval.id})`);
      if (result.warning) console.log(`  warning: ${result.warning.slice(0, 300)}`);
    }

    const skipped = suite.evals.filter((item) => !syncItems.includes(item));
    if (skipped.length) {
      console.log("");
      console.log("Skipped by default");
      for (const item of skipped) console.log(`- ${item.name}: ${item.description}`);
    }

    if (options.pruneLegacy) {
      console.log("");
      console.log("Pruning renamed duplicate evals");
      let pruned = 0;
      for (const item of syncItems) {
        const canonical = syncedByKey.get(item.key);
        for (const legacyName of item.legacyNames || []) {
          const legacy = existingByName.get(legacyName);
          if (!legacy?.id || legacy.id === canonical?.id) continue;
          await api(`/eval/${legacy.id}`, { method: "DELETE", body: {} }, `Delete legacy eval ${legacyName}`);
          existingByName.delete(legacyName);
          pruned += 1;
          console.log(`- deleted: ${legacyName} (${legacy.id})`);
        }
      }
      if (!pruned) console.log("- none");
    }
  }

  if (runItems.length) {
    console.log("");
    console.log("Running evals");
    const results = [];
    for (const item of runItems) {
      let evalRecord = syncedByKey.get(item.key) || existingByName.get(item.name);
      if (!evalRecord) {
        const payloadForSync = toVapiEval(item, suite);
        const result = await upsertEval(api, item, payloadForSync, existingByName);
        evalRecord = result.eval;
        existingByName.set(payloadForSync.name, result.eval);
        console.log(`- ${result.action}: ${payloadForSync.name} (${result.eval.id})`);
      }

      const payload = toVapiEval(item, suite);
      const result = await runEval(api, evalRecord, payload, targetAssistantId);
      results.push({ item, ...result });
      const cost = typeof result.run.cost === "number" ? `, $${result.run.cost.toFixed(4)}` : "";
      console.log(
        `- ${result.passed ? "pass" : "fail"}: ${item.name} (${result.run.endedReason || result.run.status}${cost})`
      );
    }

    const failures = results.filter((result) => !result.passed);
    if (failures.length) {
      console.log("");
      console.log("Failures");
      for (const failure of failures) {
        console.log(`- ${failure.item.name}: run ${failure.run.id}, endedReason=${failure.run.endedReason}`);
        for (const line of summarizeRunFailure(failure.run).slice(0, 3)) {
          console.log(`  ${line}`);
        }
      }
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
