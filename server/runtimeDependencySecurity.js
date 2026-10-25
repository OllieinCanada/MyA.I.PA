const { createRequire } = require('node:module');

function versionParts(value) {
  return /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split('.').map(Number) : null;
}

function atLeast(value, minimum) {
  const actual = versionParts(value), required = versionParts(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

function runtimeDependencySecurity(read = require) {
  try {
    // Resolve the parser actually loaded by Express, not an unrelated hoisted copy.
    const expressRequire = read === require ? createRequire(require.resolve('express')) : read;
    const versions = {
      express: read('express/package.json').version,
      bodyParser: expressRequire('body-parser/package.json').version,
      nodemailer: read('nodemailer/package.json').version,
    };
    const parts = versionParts(versions.bodyParser);
    const parserPatched = parts?.[0] === 1 ? atLeast(versions.bodyParser, '1.20.9')
      : parts?.[0] === 2 && atLeast(versions.bodyParser, '2.4.0');
    return { ok: Boolean(parserPatched && atLeast(versions.nodemailer, '10.1.4')), versions,
      requestCompression: 'rejected-before-body-parsing' };
  } catch (_) {
    return { ok: false, versions: null, reason: 'dependency_version_unavailable' };
  }
}

module.exports = { runtimeDependencySecurity, atLeast };
