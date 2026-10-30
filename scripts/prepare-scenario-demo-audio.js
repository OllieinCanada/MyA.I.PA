// Local conversion of existing synthetic recordings only. No voice generation,
// provider requests, cuts or replacement dialogue. Original WAVs stay intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sourceManifestPath = path.join(root, 'src/timsElectricalAudioManifest.json');
const integrityPath = path.join(root, 'config/scenario-demo-audio.json');
const originals = {
  'new-installation': '386be90fcd478e68e7d2768ae544632d61426cd1454133b29cb564da5af03427',
  'repair-request': '7e76c9f5a4c73321b4f5c85e8cc34f3fdff756efc46121ec85d95668840c38b9',
  maintenance: 'd1a7e51085244c58d036a302a733fac8fe4c246abfd1c24c4d4036305708de33',
  'unresolved-concern': '27575d76322e0b481fb891273bcf1549bc65e90ae8531643b34a0fc857e9b361',
  'hero-new-installation': '21769c6f2e425a702391d63dc2e53ddfd11dc3c7edb46bde64c36235450807d3',
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const asset = (id, extension) => `/audio/tims-electrical/${id}.${extension}`;
const file = assetPath => path.join(root, 'public', assetPath);

function check() {
  const entries = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  const integrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
  const available = Object.keys(entries).filter(id => entries[id].status === 'available').sort();
  if (JSON.stringify(available) !== JSON.stringify(Object.keys(originals).sort())
    || JSON.stringify(Object.keys(integrity.recordings).sort()) !== JSON.stringify(available)) throw Error('Scenario inventory changed; review the recordings before publishing.');
  for (const id of available) {
    const entry = entries[id], proof = integrity.recordings[id];
    if (entry.src !== asset(id, 'mp3') || entry.fallbackSrc !== asset(id, 'wav')
      || proof.sourceSha256 !== originals[id] || hash(file(entry.fallbackSrc)) !== originals[id]
      || hash(file(entry.src)) !== proof.outputSha256 || fs.statSync(file(entry.src)).size !== proof.bytes
      || proof.bytes >= fs.statSync(file(entry.fallbackSrc)).size / 2
      || Math.abs(proof.decodedDurationSeconds - entry.durationSeconds) > 1
      || proof.dialogueChanged !== false || proof.originalPreserved !== true) {
      throw Error(`Scenario integrity failed: ${id}; do not publish a stale or substituted recording.`);
    }
  }
  return { ok: true, recordings: available.length, originalsPreserved: true };
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--check')) { console.log(JSON.stringify(check())); return; }
  const encoder = argv.find(arg => arg.startsWith('--ffmpeg='))?.slice(9);
  if (!encoder || !path.isAbsolute(encoder) || !fs.existsSync(encoder)) throw Error('Provide the absolute path to a local encoder.');
  if (fs.existsSync(integrityPath)) throw Error('Prepared scenario recordings already exist; use --check.');
  const entries = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  // Validate every target before creating any output. Never overwrite a file.
  for (const [id, sha] of Object.entries(originals)) {
    if (entries[id]?.status !== 'available' || entries[id].src !== asset(id, 'wav')
      || hash(file(asset(id, 'wav'))) !== sha || fs.existsSync(file(asset(id, 'mp3')))
      || fs.existsSync(file(asset(id, 'pending.mp3')))) throw Error(`Original/target validation failed: ${id}`);
  }
  const recordings = {};
  for (const [id, sha] of Object.entries(originals)) {
    const pending = file(asset(id, 'pending.mp3'));
    const encoded = spawnSync(encoder, ['-hide_banner', '-loglevel', 'error', '-n', '-i', file(asset(id, 'wav')),
      '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k',
      '-write_xing', '1', '-id3v2_version', '3', pending], {encoding:'utf8', windowsHide:true, timeout:60000});
    if (encoded.error || encoded.status !== 0) throw Error(`Scenario encoding failed: ${id}`);
    const decoded = spawnSync(encoder, ['-hide_banner', '-loglevel', 'error', '-i', pending,
      '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], {encoding:'utf8', windowsHide:true, timeout:60000});
    const times = [...String(decoded.stdout).matchAll(/^out_time_us=(\d+)$/gm)];
    const duration = Number(times.at(-1)?.[1]) / 1000000;
    if (decoded.error || decoded.status !== 0 || !Number.isFinite(duration)
      || Math.abs(duration - entries[id].durationSeconds) > 1) throw Error(`Scenario decode/timing failed: ${id}`);
    recordings[id] = {sourceSha256:sha, outputSha256:hash(pending), bytes:fs.statSync(pending).size,
      decodedDurationSeconds:duration, dialogueChanged:false, originalPreserved:true};
    fs.renameSync(pending, file(asset(id, 'mp3')));
    entries[id] = {...entries[id], src:asset(id, 'mp3'), fallbackSrc:asset(id, 'wav')};
  }
  fs.writeFileSync(integrityPath, JSON.stringify({schemaVersion:1, encoding:'MPEG-1 Layer III, mono, 44100 Hz, 96 kbit/s', recordings},null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(sourceManifestPath, JSON.stringify(entries,null,2)+'\n');
  console.log(JSON.stringify(check()));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode=1; } }
module.exports = {check};
