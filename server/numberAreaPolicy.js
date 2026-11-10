// Ontario overlay groups share a numbering-plan region, not necessarily a
// local-call tariff. Never substitute an arbitrary province-wide area code.
const GROUPS = Object.freeze([
  Object.freeze(['289', '905', '365', '742']),
  Object.freeze(['416', '647', '437', '942']),
  Object.freeze(['519', '226', '548', '382']),
  Object.freeze(['613', '343', '753']),
  Object.freeze(['705', '249', '683']),
]);
function regionalAreaCodes(preferred, region) {
  if (!preferred) return [];
  const group = region === 'ON' && GROUPS.find(g => g.includes(preferred));
  return group ? [preferred, ...group.filter(code => code !== preferred)] : [preferred];
}
function allowedAreaCodes(preferred, region, requested) {
  if (requested === undefined) return preferred ? [preferred] : [];
  const regionCodes = regionalAreaCodes(preferred, region);
  if (!preferred || !Array.isArray(requested) || !requested.length || requested.length > 4
    || requested[0] !== preferred || new Set(requested).size !== requested.length
    || requested.some(code => typeof code !== 'string' || !regionCodes.includes(code))) {
    throw Object.assign(Error('The signed area-code alternatives are not valid for this region.'),
      { code: 'PROVISIONING_AREA_CODE_POLICY_INVALID', statusCode: 409 });
  }
  return [...requested];
}
module.exports = { regionalAreaCodes, allowedAreaCodes };
