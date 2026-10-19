const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HISTORY_FILE = 'static-asset-history.json';
function filesIn(root, directory = root) {
  if (!fs.existsSync(directory)) return [];
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Static asset symlinks are not allowed.');
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Static asset symlinks are not allowed.');
    if (entry.isDirectory()) return filesIn(root, file);
    if (!entry.isFile()) throw new Error('Unexpected static asset type.');
    return [path.relative(root, file).split(path.sep).join('/')];
  }).sort();
}
function safeAsset(relative) {
  return typeof relative === 'string' && /^static\/[a-zA-Z0-9_./-]+$/.test(relative)
    && relative.split('/').every(part => part && part !== '.' && part !== '..');
}
function generation(files) {
  return { id: crypto.createHash('sha256').update(files.join('\n')).digest('hex'), files };
}
function readHistory(file) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Static history symlinks are not allowed.');
  const history = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (history.version !== 1 || !Array.isArray(history.generations) || !history.generations.length
    || history.generations.some(item => !Array.isArray(item.files) || !item.files.length || item.files.some(file => !safeAsset(file)) || item.id !== generation(item.files).id)) throw new Error('Invalid static asset history; refusing to prune.');
  return history;
}
function syncRetainedStaticAssets({ buildDir, docsDir, keepGenerations = 3 }) {
  if (!Number.isInteger(keepGenerations) || keepGenerations < 2 || keepGenerations > 10) throw new Error('Invalid retention count.');
  const available = filesIn(buildDir, path.join(buildDir, 'static'));
  if (!available.length || available.some(file => !safeAsset(file))) throw new Error('Build static assets are missing or invalid.');
  const sourceHistoryPath = path.join(buildDir, HISTORY_FILE);
  const sourceHistory = fs.existsSync(sourceHistoryPath) ? readHistory(sourceHistoryPath) : null;
  const current = sourceHistory ? sourceHistory.generations[0].files : available;
  const existing = filesIn(docsDir, path.join(docsDir, 'static'));
  const historyPath = path.join(docsDir, HISTORY_FILE);
  const history = fs.existsSync(historyPath) ? readHistory(historyPath) : { version: 1, generations: existing.length ? [generation(existing)] : [] };
  const next = generation(current);
  const candidates = [next, ...(sourceHistory?.generations.slice(1) || []), ...history.generations];
  const generations = candidates.filter((item, index) => candidates.findIndex(other => other.id === item.id) === index).slice(0, keepGenerations);
  const retained = new Set(generations.flatMap(item => item.files));
  // Validate all paths before any copying or deletion. Only generated static files are pruned.
  if (existing.some(file => !safeAsset(file))) throw new Error('Invalid existing static path.');
  for (const file of retained) if (!available.includes(file) && !existing.includes(file)) throw new Error('Retained static asset is missing.');
  for (const file of available.filter(file => retained.has(file))) {
    const target = path.join(docsDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(buildDir, file), target);
  }
  for (const file of existing) if (!retained.has(file)) fs.unlinkSync(path.join(docsDir, file));
  fs.writeFileSync(historyPath, JSON.stringify({ version: 1, generations }, null, 2) + '\n');
  return { generations: generations.length, retainedFiles: retained.size, prunedFiles: existing.filter(file => !retained.has(file)).length };
}
module.exports = { syncRetainedStaticAssets, HISTORY_FILE };
