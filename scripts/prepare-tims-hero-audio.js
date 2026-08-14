const fs = require("fs");
const path = require("path");
const { rootPath } = require("./_helpers");

const input = rootPath(process.argv[2] || "public/audio/tims-electrical/hero-new-installation.wav");
const output = rootPath(process.argv[3] || "public/audio/tims-electrical/hero-new-installation-tight.wav");
const timingsOutput = rootPath("src/timsElectricalHeroTranscriptTimings.json");
const scenarioConfig = JSON.parse(fs.readFileSync(rootPath("config/tims-electrical-recording-scenarios.json"), "utf8"));
const heroScenario = scenarioConfig.find((scenario) => scenario.id === "hero-new-installation");
const expectedTurns = heroScenario?.exactDialogue?.length || 0;
if (!expectedTurns) throw new Error("The hero-new-installation scenario must define an exactDialogue script.");
const frameSeconds = 0.02;
const bridgeSilenceSeconds = 0.75;
const betweenTurnSeconds = 0.42;
const leadSeconds = 0.12;
const tailSeconds = 0.24;

function readWave(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE audio file.");
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

  if (!format || !data) throw new Error("The WAV file is missing a fmt or data chunk.");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error("This preparer expects mono 16-bit PCM audio.");
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
      regions.push({
        startSample: Math.max(0, index * frameSamples),
        endSample: Math.min(totalSamples, end * frameSamples),
      });
    }
    index = end;
  }
  return regions;
}

function silenceBuffer(seconds, format) {
  const samples = Math.round(seconds * format.sampleRate);
  return Buffer.alloc(samples * format.blockAlign);
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

const { format, data } = readWave(input);
const regions = detectSpeechRegions(data, format.sampleRate);
if (regions.length !== expectedTurns) {
  throw new Error(`Expected ${expectedTurns} spoken turns but detected ${regions.length}; refusing to prepare mistimed audio.`);
}

const chunks = [silenceBuffer(leadSeconds, format)];
let cursorSeconds = leadSeconds;
const turns = regions.map((region, index) => {
  const pcm = data.subarray(region.startSample * format.blockAlign, region.endSample * format.blockAlign);
  const durationSeconds = pcm.length / format.byteRate;
  const timing = {
    start: Number(cursorSeconds.toFixed(2)),
    end: Number((cursorSeconds + durationSeconds).toFixed(2)),
  };
  chunks.push(pcm);
  cursorSeconds += durationSeconds;
  if (index < regions.length - 1) {
    chunks.push(silenceBuffer(betweenTurnSeconds, format));
    cursorSeconds += betweenTurnSeconds;
  }
  return timing;
});
chunks.push(silenceBuffer(tailSeconds, format));
cursorSeconds += tailSeconds;

const pcm = Buffer.concat(chunks);
writeWave(output, format, pcm);
fs.writeFileSync(timingsOutput, `${JSON.stringify({
  src: "/audio/tims-electrical/hero-new-installation-tight.wav",
  durationSeconds: Number(cursorSeconds.toFixed(2)),
  turns,
}, null, 2)}\n`);

console.log(JSON.stringify({
  input: path.relative(rootPath(), input),
  output: path.relative(rootPath(), output),
  durationSeconds: Number(cursorSeconds.toFixed(2)),
  turns,
}, null, 2));
