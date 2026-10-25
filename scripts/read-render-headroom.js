const path = require('node:path');
const { readRenderCredentials } = require('./run-with-render-env');
const { writeManifest } = require('./provider-hardening-evidence');
const RESOURCES = ['srv-d92503a8qa3s73crdpog', 'dpg-d924vjq8qa3s73crd29g-a'];
const METRICS = ['cpu', 'cpu-limit', 'memory', 'memory-limit', 'disk-usage', 'disk-capacity', 'active-connections'];
function summarizeSeries(payload, resource) {
  if (!Array.isArray(payload)) throw Error('Unrecognized metrics response');
  return payload.filter(series => series.labels?.some(label => label.field === 'resource' && label.value === resource))
    .map(series => {
      const points = (series.values || []).filter(point => typeof point.value === 'number' && Number.isFinite(point.value) && Number.isFinite(Date.parse(point.timestamp)))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      return { unit: series.unit, samples: points.length, minimum: points.length ? Math.min(...points.map(x => x.value)) : null,
        maximum: points.length ? Math.max(...points.map(x => x.value)) : null, latest: points.at(-1) || null, points };
    });
}
function matchedUtilization(usage, capacity) {
  if (usage?.series?.length !== 1 || capacity?.series?.length !== 1) return null;
  const left = usage.series[0], right = capacity.series[0];
  if (!left.unit || left.unit !== right.unit) return null;
  const limits = new Map(right.points.map(point => [point.timestamp, point.value]));
  const ratios = left.points.filter(point => limits.get(point.timestamp) > 0)
    .map(point => ({ timestamp: point.timestamp, percent: 100 * point.value / limits.get(point.timestamp) }));
  return ratios.length ? { matchedSamples: ratios.length, peakPercent: Math.max(...ratios.map(x => x.percent)), latest: ratios.at(-1) } : null;
}
async function main() {
  const credentials = readRenderCredentials();
  if (new URL(credentials.host).origin !== 'https://api.render.com') throw Error('Unexpected Render API origin');
  const endTime = new Date().toISOString(), startTime = new Date(Date.parse(endTime) - 3600000).toISOString();
  const readings = [];
  for (const resource of RESOURCES) {
    for (const metric of METRICS) {
      if (metric === 'active-connections' && !resource.startsWith('dpg-')) continue;
      const url = new URL(credentials.host + '/metrics/' + metric);
      for (const [key, value] of Object.entries({ resource, startTime, endTime, resolutionSeconds: '300' })) url.searchParams.set(key, value);
      try {
        const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + credentials.key }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        readings.push({ resource, metric, httpStatus: response.status, series: response.ok ? summarizeSeries(await response.json(), resource) : [], unavailable: !response.ok });
      } catch (_) { readings.push({ resource, metric, series: [], unavailable: true, reason: 'Read or response validation failed' }); }
    }
  }
  const utilization = RESOURCES.map(resource => {
    const get = metric => readings.find(item => item.resource === resource && item.metric === metric);
    return { resource, cpu: matchedUtilization(get('cpu'), get('cpu-limit')),
      memory: matchedUtilization(get('memory'), get('memory-limit')), disk: matchedUtilization(get('disk-usage'), get('disk-capacity')) };
  });
  const report = { checkedAt: new Date().toISOString(), startTime, endTime, resolutionSeconds: 300, mode: 'GET-only', readings, utilization,
    productionWrites: 0, planChanges: 0,
    limitations: ['Five-minute samples over one hour do not prove absence of short spikes or historical pressure.',
      'Connection usage is observed, but the account connection limit is not certified.',
      'Memory is provider-reported usage, not proof of cache pressure, OOM events or transaction root cause. No upgrade is inferred from this snapshot.'] };
  writeManifest(path.resolve(__dirname, '../diagnostics/provider-hardening/headroom.json'), report);
  console.log(JSON.stringify({ checkedAt: report.checkedAt, utilization,
    connections: readings.filter(item => item.metric === 'active-connections').map(item => ({ resource: item.resource, series: item.series.map(({ points, ...summary }) => summary) })),
    unavailable: readings.filter(item => item.unavailable).map(item => ({ resource: item.resource, metric: item.metric, httpStatus: item.httpStatus || null })), productionWrites: 0 }, null, 2));
}
if (require.main === module) main().catch(error => { console.error('Read-only metrics stopped: ' + error.message); process.exitCode = 1; });
module.exports = { summarizeSeries, matchedUtilization };
