// Jest's crawler skips hidden .codex worktrees on Windows. Run the normal CRA
// test command from a disposable non-hidden copy, without copying local secrets.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-forwarding-ui-'));
const tests = process.argv.slice(2);
if (tests.some(name => !/^src\/[\w./-]+\.test\.js$/.test(name) || name.includes('..'))) throw Error('Use project-relative src/*.test.js paths.');
try {
  for (const name of ['src', 'public', 'config', 'package.json']) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/react-scripts/bin/react-scripts.js'), 'test', '--env=jsdom', '--watchAll=false', '--runInBand', '--runTestsByPath', ...(tests.length ? tests : ['src/ForwardingSetup.test.js'])], {
    cwd: stage, env: { ...process.env, CI: 'true' }, stdio: 'inherit', timeout: 120000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status || (result.signal ? 1 : 0);
} finally {
  const resolved = fs.realpathSync(stage);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('myaipa-forwarding-ui-') || fs.lstatSync(stage).isSymbolicLink()) throw Error('Refusing cleanup outside exact forwarding UI temp directory');
  fs.rmSync(resolved, { recursive: true, force: true });
}
