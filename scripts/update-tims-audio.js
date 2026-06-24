const fs = require("fs");
const path = require("path");
const { rootPath, run } = require("./_helpers");

const targetSecondsArg = process.argv.find((arg) => arg.startsWith("--seconds="));
const targetSeconds = targetSecondsArg ? Number(targetSecondsArg.split("=")[1]) : 133;
const audioNames = ["Tim's Electrical2.0.wav", "Tim's Electrical.wav"];

function findNewestTimWav() {
  const candidates = [];
  for (const folder of ["public", "docs"]) {
    const dir = rootPath(folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/tim'?s electrical.*\.wav$/i.test(file)) {
        const filePath = path.join(dir, file);
        candidates.push({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || "";
}

const source = process.argv[2] && !process.argv[2].startsWith("--") ? rootPath(process.argv[2]) : findNewestTimWav();
if (!source || !fs.existsSync(source)) {
  throw new Error("No Tim's Electrical .wav file found. Pass one like: npm run audio:update-tims -- public/Tim's Electrical2.0.wav");
}

console.log(`Source: ${source}`);
console.log(`Target duration: ${targetSeconds}s`);

const tempOutput = rootPath("public", "Tim's Electrical2.0.trimmed.wav");
const hasFfmpeg = run("ffmpeg", ["-version"], { capture: true, allowFailure: true }).status === 0;

if (hasFfmpeg) {
  run("ffmpeg", ["-y", "-i", source, "-t", String(targetSeconds), "-c", "copy", tempOutput]);
  for (const name of audioNames) {
    fs.copyFileSync(tempOutput, rootPath("public", name));
    fs.copyFileSync(tempOutput, rootPath("docs", name));
  }
  fs.unlinkSync(tempOutput);
  console.log("Trimmed and copied audio into public/ and docs/.");
} else {
  for (const name of audioNames) {
    fs.copyFileSync(source, rootPath("public", name));
    fs.copyFileSync(source, rootPath("docs", name));
  }
  console.log("ffmpeg was not found. Copied audio without trimming.");
  console.log("Install ffmpeg if you want this script to trim automatically.");
}
