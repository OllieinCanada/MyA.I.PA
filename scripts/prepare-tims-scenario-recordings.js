const fs = require("fs");
const path = require("path");
const { loadProjectEnv, rootPath } = require("./_helpers");

const defaultIds = ["repair-request", "maintenance", "unresolved-concern", "urgent-outage", "safety-redirect"];
const only = process.argv.find((arg) => arg.startsWith("--only="))?.split("=").slice(1).join("=") || "";
const selectedIds = only ? only.split(",").map((value) => value.trim()).filter(Boolean) : defaultIds;
const useVapiTimings = process.argv.includes("--use-vapi-timings");
const env = useVapiTimings ? loadProjectEnv() : {};
const apiKey = String(env.VAPI_API_KEY || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const scenarios = JSON.parse(fs.readFileSync(rootPath("config", "tims-electrical-recording-scenarios.json"), "utf8"));
const manifestPath = rootPath("src", "timsElectricalAudioManifest.json");
const captionsPath = rootPath("src", "timsElectricalRecordedScenarioCaptions.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const existingCaptions = fs.existsSync(captionsPath) ? JSON.parse(fs.readFileSync(captionsPath, "utf8")) : {};
const rawDir = rootPath("artifacts", "tims-electrical-vapi-recordings", "raw-audio");
const frameSeconds = 0.02;
const bridgeSilenceSeconds = 0.72;
const leadSeconds = 0.14;
const betweenTurnSeconds = 0.48;
const tailSeconds = 0.28;

async function fetchPreparedTurns(id, expectedTurns) {
  if (!useVapiTimings) return null;
  if (!apiKey) throw new Error("VAPI_API_KEY is required with --use-vapi-timings.");
  const artifactPath = rootPath("artifacts", "tims-electrical-vapi-recordings", `${id}.json`);
  if (!fs.existsSync(artifactPath)) throw new Error(`${id}: the local recording artifact is missing.`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!artifact.callId) throw new Error(`${id}: the recording artifact has no call ID.`);
  const response = await fetch(`${apiBase}/call/${encodeURIComponent(artifact.callId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${id}: Vapi call timing lookup failed (${response.status}).`);
  const call = await response.json();
  const messages = (call?.artifact?.messages || call?.messages || [])
    .filter((message) => ["user", "bot", "assistant"].includes(message?.role))
    .slice(0, expectedTurns.length);
  if (messages.length !== expectedTurns.length) {
    throw new Error(`${id}: expected ${expectedTurns.length} timed turns but received ${messages.length}.`);
  }
  return messages.map((message, index) => {
    const expectedRole = expectedTurns[index].role === "receptionist" ? "user" : "bot";
    const normalizedRole = message.role === "assistant" ? "bot" : message.role;
    if (normalizedRole !== expectedRole) {
      throw new Error(`${id}: timed turn ${index + 1} did not alternate as expected.`);
    }
    const start = Number(message.secondsFromStart);
    const spokenSeconds = (Number(message.endTime) - Number(message.time)) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(spokenSeconds) || spokenSeconds <= 0) {
      throw new Error(`${id}: timed turn ${index + 1} is missing a usable speech boundary.`);
    }
    return { start, end: start + spokenSeconds };
  });
}

function readWave(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path.basename(filePath)} is not a RIFF/WAVE file.`);
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === "data") data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error(`${path.basename(filePath)} is missing WAV format or audio data.`);
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`${path.basename(filePath)} must be mono 16-bit PCM.`);
  }
  return { format, data };
}

function frameRms(data, startSample, sampleCount) {
  let sum = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = data.readInt16LE((startSample + index) * 2);
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(sampleCount, 1));
}

function detectSpeechRegions(data, sampleRate) {
  const totalSamples = Math.floor(data.length / 2);
  const frameSamples = Math.max(1, Math.round(sampleRate * frameSeconds));
  const values = [];
  for (let start = 0; start < totalSamples; start += frameSamples) {
    values.push(frameRms(data, start, Math.min(frameSamples, totalSamples - start)));
  }
  const peak = Math.max(...values);
  const threshold = Math.max(120, peak * 0.035);
  const active = values.map((value) => value >= threshold);
  const bridgeFrames = Math.round(bridgeSilenceSeconds / frameSeconds);
  for (let index = 0; index < active.length;) {
    if (active[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < active.length && !active[end]) end += 1;
    if (index > 0 && end < active.length && end - index <= bridgeFrames) {
      for (let fill = index; fill < end; fill += 1) active[fill] = true;
    }
    index = end;
  }
  const regions = [];
  for (let index = 0; index < active.length;) {
    if (!active[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < active.length && active[end]) end += 1;
    if ((end - index) * frameSeconds >= 0.22) {
      regions.push({ startSample: index * frameSamples, endSample: Math.min(totalSamples, end * frameSamples) });
    }
    index = end;
  }
  return regions;
}

function silenceBuffer(seconds, format) {
  return Buffer.alloc(Math.round(seconds * format.sampleRate) * format.blockAlign);
}

function writeWave(filePath, format, pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format.audioFormat, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.byteRate, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

async function main() {
  fs.mkdirSync(rawDir, { recursive: true });
  const results = [];
  for (const id of selectedIds) {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario?.exactDialogue?.length) throw new Error(`${id} does not define an exact dialogue.`);
    const filePath = rootPath("public", "audio", "tims-electrical", `${id}.wav`);
    const rawPath = path.join(rawDir, `${id}.wav`);
    if (!fs.existsSync(rawPath)) fs.copyFileSync(filePath, rawPath);
    const { format, data } = readWave(rawPath);
    const timedTurns = await fetchPreparedTurns(id, scenario.exactDialogue);
    const detected = timedTurns ? [] : detectSpeechRegions(data, format.sampleRate);
    if (!timedTurns && detected.length < scenario.exactDialogue.length) {
      throw new Error(`${id}: expected ${scenario.exactDialogue.length} spoken turns but detected ${detected.length}.`);
    }
    const selected = timedTurns || detected.slice(0, scenario.exactDialogue.length).map((region) => ({
      start: region.startSample / format.sampleRate,
      end: region.endSample / format.sampleRate,
    }));
    const chunks = [silenceBuffer(leadSeconds, format)];
    let cursorSeconds = leadSeconds;
    const captions = [];
    selected.forEach((region, index) => {
      const startSample = Math.max(0, Math.floor((region.start - .03) * format.sampleRate));
      const endSample = Math.min(Math.floor(data.length / format.blockAlign), Math.ceil((region.end + .08) * format.sampleRate));
      const pcm = data.subarray(startSample * format.blockAlign, endSample * format.blockAlign);
      const durationSeconds = pcm.length / format.byteRate;
      const turn = scenario.exactDialogue[index];
      captions.push({
        speaker: turn.role === "receptionist" ? "assistant" : "caller",
        startSeconds: Number(cursorSeconds.toFixed(2)),
        text: turn.text,
      });
      chunks.push(pcm);
      cursorSeconds += durationSeconds;
      if (index < selected.length - 1) {
        chunks.push(silenceBuffer(betweenTurnSeconds, format));
        cursorSeconds += betweenTurnSeconds;
      }
    });
    chunks.push(silenceBuffer(tailSeconds, format));
    cursorSeconds += tailSeconds;
    writeWave(filePath, format, Buffer.concat(chunks));
    existingCaptions[id] = captions;
    manifest[id] = {
      ...manifest[id],
      durationSeconds: Number(cursorSeconds.toFixed(2)),
      preparedAt: new Date().toISOString(),
      timingSource: timedTurns ? "vapi-message-boundaries" : "speech-region-detection",
    };
    results.push({ id, timingSource: manifest[id].timingSource, keptTurns: selected.length, durationSeconds: Number(cursorSeconds.toFixed(2)) });
  }

  fs.writeFileSync(captionsPath, `${JSON.stringify(existingCaptions, null, 2)}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
