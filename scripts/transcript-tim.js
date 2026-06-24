const fs = require("fs");
const path = require("path");
const { rootPath } = require("./_helpers");

function findNewestTranscriptSource() {
  const docsDir = rootPath("docs");
  if (!fs.existsSync(docsDir)) return "";
  const candidates = fs
    .readdirSync(docsDir)
    .filter((file) => /tims?_electrical.*transcript.*\.txt$/i.test(file))
    .map((file) => {
      const filePath = path.join(docsDir, file);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || "";
}

const source = process.argv[2] && !process.argv[2].startsWith("--") ? rootPath(process.argv[2]) : findNewestTranscriptSource();
if (!source || !fs.existsSync(source)) {
  console.log("No local transcript text file found.");
  console.log("This project does not include an offline speech-to-text engine yet.");
  console.log("After transcribing, place the .txt in docs/ and rerun this script to create a simple PDF placeholder workflow.");
  process.exit(1);
}

const text = fs.readFileSync(source, "utf8");
const outputTxt = rootPath("docs", "Tims_Electrical_2_Transcript_Polished.txt");
fs.writeFileSync(outputTxt, text);

console.log(`Updated transcript text: ${outputTxt}`);
console.log("PDF generation is intentionally not automated yet because this repo has no PDF library installed.");
console.log("Recommended next step: add a small PDF dependency or keep using the existing manual PDF export.");
