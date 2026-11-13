// Pure read-evidence validation. No provider request, state change or readiness grant.
function completeInventoryRead(data, keys = [], limit = 1000) {
  const refuse = () => { throw Object.assign(Error('Vapi audit inventory is failed, malformed or incomplete.'), { code: 'VAPI_INVENTORY_INCOMPLETE', statusCode: 503 }); };
  const raw = Array.isArray(data);
  const candidates = raw ? [data] : [...new Set(['data', 'items', 'results', ...keys])].map(k => data?.[k]).filter(Array.isArray);
  if (candidates.length !== 1) refuse();
  const records = candidates[0];
  if (records.length > limit || records.some(r => !r || typeof r.id !== 'string' || !r.id.trim() || r.id !== r.id.trim()) || new Set(records.map(r => r.id)).size !== records.length) refuse();
  const metadata = raw ? [] : [data, data?.metadata, data?.pagination, data?.meta].filter(m => m && typeof m === 'object');
  if (metadata.some(m => m.hasMore || m.has_more || m.hasNextPage || m.nextCursor || m.nextPage || m.next || m.itemsBeyondRetention
    || (m.currentPage !== undefined && m.currentPage !== 1) || (m.totalPages !== undefined && m.totalPages !== 1))) refuse();
  const totals = metadata.flatMap(m => ['totalItems', 'total', 'totalCount'].filter(k => m[k] !== undefined).map(k => m[k]));
  if (raw) { if (records.length >= limit) refuse(); }
  else if (!totals.length || totals.some(total => !Number.isSafeInteger(total) || total !== records.length)) refuse();
  return { records, evidence: { successful: true, complete: true, count: records.length,
    basis: raw ? 'documented-limit1000-array-below-cap' : 'explicit-total-and-no-next-page', checkedAt: new Date().toISOString() } };
}
module.exports = { completeInventoryRead };
