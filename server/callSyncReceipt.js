const KEY = 'vapi-call-sync:completion:v1';
function completion(data) {
  const count = x => Number.isSafeInteger(x) && x >= 0 && x <= 1000000;
  const start = Date.parse(data?.startedAt), end = Date.parse(data?.completedAt);
  if (!/^[a-f0-9]{40}$/.test(data?.releaseCommit || '') || !Number.isFinite(start)
    || !Number.isFinite(end) || end < start || !['fetched', 'synced', 'skippedUnmapped'].every(k => count(data[k]))
    || data.fetched !== data.synced + data.skippedUnmapped) throw Error('Invalid completion evidence');
  return { schemaVersion: 1, releaseCommit: data.releaseCommit,
    startedAt: new Date(start).toISOString(), completedAt: new Date(end).toISOString(),
    fetched: data.fetched, synced: data.synced, skippedUnmapped: data.skippedUnmapped };
}
async function saveCompletion({ prisma, ...data }) {
  const receipt = completion(data);
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1000ms'");
    await tx.runtimeStore.upsert({ where: { key: KEY }, create: { key: KEY, data: receipt }, update: { data: receipt } });
  }, { maxWait: 500, timeout: 1500 });
}
function inspectCompletion(data, releaseCommit, now) {
  let r;
  if (data?.schemaVersion !== 1) return { status: 'unknown', completedOnRelease: false };
  try { r = completion(data); } catch (_) { return { status: 'unknown', completedOnRelease: false }; }
  const age = now - Date.parse(r.completedAt);
  const status = age < 0 ? 'unknown' : !r.fetched ? 'empty_result' : r.releaseCommit !== releaseCommit ? 'previous_release'
    : age > 1800000 ? 'stale' : 'verified';
  return { status, completedOnRelease: status === 'verified',
    ...(status === 'verified' ? { fetched: r.fetched, synced: r.synced, skippedUnmapped: r.skippedUnmapped } : {}) };
}
module.exports = { KEY, completion, saveCompletion, inspectCompletion };
