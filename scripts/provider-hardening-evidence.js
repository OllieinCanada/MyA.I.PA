const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'PENDING_OBSERVATION', 'STALE']);
const DEPENDENTS = {
  health: ['funding', 'restore', 'chain', 'intake', 'liveCanary', 'release'],
  funding: ['liveCanary', 'release'],
  restore: ['chain', 'intake', 'release'],
  chain: ['intake', 'liveCanary', 'release'],
  intake: ['liveCanary', 'release'],
  liveCanary: ['release'],
  observation: ['release'],
};
function newManifest(releaseCommit, now = new Date().toISOString()) {
  if (!/^[a-f0-9]{40}$/.test(releaseCommit)) throw Error('Exact release identity required');
  return { schemaVersion: 1, executionId: crypto.randomUUID(), createdAt: now, releaseCommit, gates: {}, invalidations: [],
    constraints: { productionWrites: false, billingChanges: false, maximumEstimatedUsageUsd: 5,
      maximumTexts: 5, maximumUserInitiatedCalls: 1, maximumCallSeconds: 120, automaticOutboundCalls: false } };
}
function recordGate(manifest, name, { status, evidence, prerequisites = [], restrictions = [], codeIdentity = '', checkedAt = new Date().toISOString() }) {
  if (!STATUSES.has(status) || !evidence || !Array.isArray(prerequisites)) throw Error('Gate evidence and valid status required');
  if (status === 'PASS' && prerequisites.some(key => manifest.gates[key]?.status !== 'PASS')) throw Error('Prerequisite is not passing');
  manifest.gates[name] = { status, evidence, prerequisites, restrictions, codeIdentity, checkedAt };
  return manifest;
}
function invalidateGates(manifest, names, reason, now = new Date().toISOString()) {
  if (!reason) throw Error('Invalidation reason required');
  const affected = new Set();
  function visit(key) { if (affected.has(key)) return; affected.add(key); for (const child of DEPENDENTS[key] || []) visit(child); }
  names.forEach(visit);
  for (const key of affected) if (manifest.gates[key]) manifest.gates[key] = { ...manifest.gates[key], status: 'STALE', invalidatedAt: now, invalidationReason: reason };
  manifest.invalidations.push({ at: now, reason, gates: [...affected] });
  return manifest;
}
function writeManifest(file, manifest) {
  const destination = path.resolve(file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, destination);
}
function fingerprintFiles(files, root = path.resolve(__dirname, '..')) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) { hash.update(file + '\0'); hash.update(fs.readFileSync(path.resolve(root, file))); }
  return hash.digest('hex');
}
function assertFreshHealth(manifest, now = Date.now()) {
  const gate = manifest.gates.health;
  const checkedAt = Date.parse(gate?.checkedAt);
  if (gate?.status !== 'PASS' || !Number.isFinite(checkedAt) || now - checkedAt > 600000 || checkedAt > now + 5000) throw Error('A passing live health check from the last ten minutes is required');
}
module.exports = { newManifest, recordGate, invalidateGates, writeManifest, fingerprintFiles, assertFreshHealth };
