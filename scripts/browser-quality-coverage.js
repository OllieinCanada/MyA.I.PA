function coversCatalog(requested, required) {
  return Array.isArray(requested) && Array.isArray(required) && required.length > 0
    && new Set(required).size === required.length && new Set(requested).size === requested.length
    && requested.length === required.length && required.every(name => requested.includes(name));
}
const ENGINES = ['chromium', 'firefox', 'webkit'];
const ROUTES = ['home', 'signup', 'trades', 'electricians', 'plumbers', 'hvac', 'general-contractors', 'roofers', 'painters'];
const VIEWPORTS = ['desktop', 'tablet', 'mobile'];
const key = row => `${row.engine}/${row.route}/${row.viewport}`;
function requiredMatrix() {
  return [
    ...ENGINES.flatMap(engine => [...ROUTES, 'signup-journey'].flatMap(route => VIEWPORTS.map(viewport => ({ engine, route, viewport })))),
    ...['trade-image-fallback', 'trade-slow-image-layout', 'large-text-reflow'].map(route => ({ engine: 'chromium', route, viewport: route === 'large-text-reflow' ? '320px' : 'mobile' })),
  ];
}
function assessCoverage(value) {
  const checks = Array.isArray(value?.checks) ? value.checks : [];
  const actual = checks.map(key), required = requiredMatrix().map(key);
  const missing = required.filter(entry => !actual.includes(entry));
  const unexpected = actual.filter(entry => !required.includes(entry));
  const duplicate = actual.filter((entry, index) => actual.indexOf(entry) !== index);
  const engines = coversCatalog(value?.requestedEngines, ENGINES);
  const routes = coversCatalog(value?.requestedRoutes, ROUTES);
  return { complete: engines && routes && !missing.length && !unexpected.length && !duplicate.length,
    requiredChecks: required.length, completedChecks: checks.length, engines, routes, missing, unexpected, duplicate };
}
function browserQualityPassed(value) {
  return value?.ready === true && !value.failure && value.completedChecks === value.checks?.length
    && value.warningCount === 0 && assessCoverage(value).complete
    && Array.isArray(value.networkIsolation?.unexpectedWrites) && value.networkIsolation.unexpectedWrites.length === 0
    && !value.networkIsolation.clientErrors?.some(row => !row.expectedNegativeTest);
}
module.exports = { coversCatalog, ENGINES, ROUTES, VIEWPORTS, requiredMatrix, assessCoverage, browserQualityPassed };
