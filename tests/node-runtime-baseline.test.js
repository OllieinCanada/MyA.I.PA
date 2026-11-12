const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const version = '24.22.3';

test('development, manifest, lockfile, container and Render agree on the reviewed Node baseline', () => {
  assert.equal(read('.node-version').trim(), version);
  assert.equal(JSON.parse(read('package.json')).engines.node, `>=${version} <25`);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].engines.node, `>=${version} <25`);
  assert.match(read('Dockerfile'), new RegExp(`^FROM node:${version.replaceAll('.', '\\.')}\u002dbookworm-slim@sha256:[a-f0-9]{64}\\r?$`, 'm'));
  const service = YAML.parse(read('render.yaml')).services.find(item => item.name === 'myaipa-api');
  assert.deepEqual(service.envVars.filter(item => item.key === 'NODE_VERSION'), [{ key: 'NODE_VERSION', value: version }]);
});

test('all workflow jobs invoking application Node select the patched runtime first', () => {
  for (const file of fs.readdirSync(path.join(root, '.github/workflows')).filter(file => /\.ya?ml$/.test(file))) {
    const workflow = YAML.parse(read(`.github/workflows/${file}`));
    for (const [name, job] of Object.entries(workflow.jobs || {})) {
      let selected = false;
      for (const step of job.steps || []) {
        if (String(step.uses || '').startsWith('actions/setup-node@')) {
          assert.equal(String(step.with?.['node-version']), version, `${file}:${name}`);
          selected = true;
        }
        if (/\b(?:node|npm|npx)\s/.test(step.run || '')) {
          assert.equal(selected, true, `${file}:${name} invokes Node before selecting the runtime`);
        }
      }
    }
  }
});
