// Local conversion only: preserves the exact original dialogue and timing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public/tims-electrical-2.wav');
const output = path.join(root, 'public/tims-electrical-2.mp3');
const manifestPath = path.join(root, 'config/public-demo-audio.json');
const ORIGINAL_SHA256 = '8ed9d2671ae2b54739fb29fe9e009aa6bdf8b60fa59e858cd269d6a234f1ff23';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function check() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (hash(source) !== ORIGINAL_SHA256 || manifest.sourceSha256 !== ORIGINAL_SHA256
    || manifest.source !== '/tims-electrical-2.wav' || manifest.output !== '/tims-electrical-2.mp3'
    || hash(output) !== manifest.outputSha256 || fs.statSync(output).size !== manifest.bytes
    || manifest.bytes >= fs.statSync(source).size / 5 || manifest.durationSeconds !== 133) {
    throw Error('Public demo integrity check failed; do not publish a missing, stale or substituted recording.');
  }
  return manifest;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--check')) { console.log(JSON.stringify({ ok: true, ...check() }, null, 2)); return; }
  const encoder = argv.find(arg => arg.startsWith('--ffmpeg='))?.slice('--ffmpeg='.length);
  if (!encoder || !path.isAbsolute(encoder) || !fs.existsSync(encoder)) throw Error('Provide --ffmpeg=<absolute path to a local encoder>.');
  if (hash(source) !== ORIGINAL_SHA256) throw Error('Original demo changed; refuse to convert an unreviewed recording.');
  if (fs.existsSync(output) || fs.existsSync(manifestPath)) throw Error('A prepared demo already exists; validate it with --check.');
  const temporary = output + '.pending.mp3';
  if (fs.existsSync(temporary)) throw Error('An earlier conversion is incomplete; preserve it for inspection.');
  const encoded = spawnSync(encoder, ['-hide_banner', '-loglevel', 'error', '-n', '-i', source,
    '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k',
    '-write_xing', '1', '-id3v2_version', '3', temporary], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (encoded.error || encoded.status !== 0) throw Error('Local audio conversion failed: ' + String(encoded.stderr || encoded.error).slice(-1000));
  const decoded = spawnSync(encoder, ['-hide_banner', '-loglevel', 'error', '-i', temporary, '-f', 'null', '-'],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (decoded.error || decoded.status !== 0) throw Error('Converted public demo did not decode cleanly.');
  const manifest = { schemaVersion: 1, source: '/tims-electrical-2.wav', sourceSha256: ORIGINAL_SHA256,
    output: '/tims-electrical-2.mp3', outputSha256: hash(temporary), bytes: fs.statSync(temporary).size,
    durationSeconds: 133, encoding: 'MPEG-1 Layer III, mono, 44100 Hz, 96 kbit/s',
    dialogueChanged: false, originalPreserved: true };
  fs.renameSync(temporary, output);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, ...check() }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { check, main };
