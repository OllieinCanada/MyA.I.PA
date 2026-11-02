const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Windows private assemblies can fail to resolve when CreateProcess receives
// a junction pathname. Resolve paths, not Windows security/runtime settings.
function configureBrowserCache({
  env = process.env, platform = process.platform, home = os.homedir(), cwd = process.cwd(),
  realpath = fs.realpathSync.native, lstat = fs.lstatSync,
} = {}) {
  if (platform !== 'win32' || env.PLAYWRIGHT_BROWSERS_PATH === '0') return { changed: false };
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  const cache = configured
    ? path.win32.resolve(env.INIT_CWD || cwd, configured)
    : path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'ms-playwright');
  let resolved;
  try { resolved = realpath(cache); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let dangling = false;
    try { dangling = lstat(cache).isSymbolicLink(); }
    catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
    if (dangling) throw new Error('The configured browser-cache link target is unavailable. Reconnect its drive; do not recreate the cache on C:.', { cause: error });
    // Let Playwright report its ordinary missing-installation error. No download
    // or directory creation is performed by this module.
    return { changed: false, original: cache, missing: true };
  }
  const changed = path.win32.normalize(cache).toLowerCase() !== path.win32.normalize(resolved).toLowerCase();
  if (changed) env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  return { changed, original: cache, resolved };
}

function canonicalLaunchOptions(options, { platform = process.platform, realpath = fs.realpathSync.native } = {}) {
  if (platform !== 'win32' || !options?.executablePath) return options;
  return { ...options, executablePath: realpath(options.executablePath) };
}

function wrapBrowserType(type, dependencies) {
  const methods = new Map();
  return new Proxy(type, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(property)) {
        if (['launch', 'launchServer'].includes(property)) {
          methods.set(property, options => value.call(target, canonicalLaunchOptions(options, dependencies)));
        } else if (property === 'launchPersistentContext') {
          methods.set(property, (userDataDir, options) => value.call(target, userDataDir, canonicalLaunchOptions(options, dependencies)));
        } else {
          methods.set(property, value.bind(target));
        }
      }
      return methods.get(property);
    },
  });
}

function initializePlaywright({ load, ...dependencies }) {
  // Configure before importing Playwright: its registry captures the cache root
  // at import time. Explicit executable overrides are resolved on each launch.
  configureBrowserCache(dependencies);
  const playwright = load();
  return {
    ...playwright,
    chromium: wrapBrowserType(playwright.chromium, dependencies),
    firefox: wrapBrowserType(playwright.firefox, dependencies),
    webkit: wrapBrowserType(playwright.webkit, dependencies),
  };
}

module.exports = { configureBrowserCache, canonicalLaunchOptions, initializePlaywright };
