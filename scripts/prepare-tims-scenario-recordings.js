const fs = require("fs");
const path = require("path");
const { rootPath } = require("./_helpers");

const defaultIds = ["repair-request", "maintenance", "unresolved-concern", "urgent-outage", "safety-redirect"];
const only = process.argv.find((arg) => arg.startsWith("--only="))?.split("=").slice(1).join("=") || "";
const selectedIds = only ? only.split(",").map((value) => value.trim()).filter(Boolean) : defaultIds;
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

fs.mkdirSync(rawDir, { recursive: true });
const results = [];
for (const id of selectedIds) {
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario?.exactDialogue?.length) throw new Error(`${id} does not define an exact dialogue.`);
  const filePath = rootPath("public", "audio", "tims-electrical", `${id}.wav`);
  const rawPath = path.join(rawDir, `${id}.wav`);
  fs.copyFileSync(filePath, rawPath);
  const { format, data } = readWave(rawPath);
  const detected = detectSpeechRegions(data, format.sampleRate);
  if (detected.length < scenario.exactDialogue.length) {
    throw new Error(`${id}: expected ${scenario.exactDialogue.length} spoken turns but detected ${detected.length}.`);
  }
  const selected = detected.slice(0, scenario.exactDialogue.length);
  const chunks = [silenceBuffer(leadSeconds, format)];
  let cursorSeconds = leadSeconds;
  const captions = [];
  selected.forEach((region, index) => {
    const pcm = data.subarray(region.startSample * format.blockAlign, region.endSample * format.blockAlign);
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
  };
  results.push({ id, detectedTurns: detected.length, keptTurns: selected.length, durationSeconds: Number(cursorSeconds.toFixed(2)) });
}

fs.writeFileSync(captionsPath, `${JSON.stringify(existingCaptions, null, 2)}\n`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
