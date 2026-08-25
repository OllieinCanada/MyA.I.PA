const test = require('node:test');
const assert = require('node:assert/strict');

const { containsSignal, parseIssueUrl, scoreIssue, validateConfig } = require('../scripts/github-contribution-radar');

const baseConfig = {
  version: 1,
  ownerLogin: 'OllieinCanada',
  lookbackDays: 45,
  searches: [{ id: 'bounded', priority: 4, query: 'is:issue is:open' }],
  watchIssues: ['https://github.com/example/project/issues/12'],
  familiarRepositories: [{ name: 'example/project', familiarity: 30, reason: 'Known context' }],
  skillSignals: ['typescript', 'test', 'false positive']
};

test('parses canonical GitHub issue URLs', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/example/project/issues/12'), {
    owner: 'example',
    repo: 'project',
    number: 12
  });
  assert.equal(parseIssueUrl('https://github.com/example/project/pull/12'), null);
});

test('matches skill signals as terms instead of substrings', () => {
  assert.equal(containsSignal('AI prompt regression', 'ai'), true);
  assert.equal(containsSignal('maintainer prompt regression', 'ai'), false);
  assert.equal(containsSignal('A Node test fails', 'node'), true);
  assert.equal(containsSignal('undefined symbol', 'node'), false);
});

test('rejects malformed watch issue URLs', () => {
  assert.throws(() => validateConfig({ ...baseConfig, watchIssues: ['not-a-url'] }), /invalid watch issue URL/);
});

test('rewards familiar, bounded, evidence-backed issues', () => {
  const now = new Date().toISOString();
  const repository = {
    full_name: 'example/project',
    archived: false,
    pushed_at: now,
    stargazers_count: 200,
    has_issues: true,
    license: { key: 'mit' },
    language: 'TypeScript'
  };
  const strong = scoreIssue({
    number: 12,
    title: 'Fix TypeScript test false positive',
    body: '## Deterministic reproduction\n`tests/focus.test.ts` fails.\n## Expected fix\nAdd a regression test.\n## Acceptance criteria\nThe test passes.',
    html_url: 'https://github.com/example/project/issues/12',
    updated_at: now,
    labels: [{ name: 'good first issue' }, { name: 'help wanted' }, { name: 'ready' }, { name: 'size: small' }],
    assignee: null,
    user: { login: 'someone-else' }
  }, repository, baseConfig, ['bounded']);
  const owned = scoreIssue({
    number: 13,
    title: 'Large feature',
    body: 'I will implement this and send a PR.',
    html_url: 'https://github.com/example/project/issues/13',
    updated_at: now,
    labels: [],
    assignee: null,
    user: { login: 'someone-else' }
  }, repository, baseConfig, ['bounded']);
  assert.ok(strong.score > owned.score);
  assert.equal(strong.effort, 'small');
  assert.match(owned.nextStep, /Watch only/);
});

test('safe-skips issues when discussion links an existing pull request', () => {
  const now = new Date().toISOString();
  const repository = {
    full_name: 'example/project',
    archived: false,
    pushed_at: now,
    stargazers_count: 200,
    has_issues: true,
    license: { key: 'mit' },
    language: 'TypeScript'
  };
  const issue = {
    number: 14,
    title: 'Fix TypeScript test false positive',
    body: 'The test reports a false positive.',
    html_url: 'https://github.com/example/project/issues/14',
    updated_at: now,
    labels: [{ name: 'help wanted' }],
    assignee: null,
    user: { login: 'someone-else' },
    radarComments: [{ body: 'I opened pull request #25 with the fix.' }]
  };
  const scored = scoreIssue(issue, repository, baseConfig, ['bounded']);
  assert.equal(scored.breakdown.penalties.some(penalty => penalty.reason.includes('existing pull request')), true);
  assert.match(scored.nextStep, /Watch only/);
});

test('safe-skips persisted collisions even when comment APIs are unavailable', () => {
  const now = new Date().toISOString();
  const config = {
    ...baseConfig,
    knownCollisions: [{
      url: 'https://github.com/example/project/issues/15',
      reason: 'Maintainer PR #30 is already open'
    }]
  };
  const repository = {
    full_name: 'example/project',
    archived: false,
    pushed_at: now,
    stargazers_count: 200,
    has_issues: true,
    license: { key: 'mit' },
    language: 'TypeScript'
  };
  const scored = scoreIssue({
    number: 15,
    title: 'Fix a false positive',
    body: 'Concrete reproduction.',
    html_url: 'https://github.com/example/project/issues/15',
    updated_at: now,
    labels: [],
    assignee: null,
    user: { login: 'someone-else' }
  }, repository, config, ['bounded']);
  assert.equal(scored.breakdown.penalties.some(penalty => penalty.reason.includes('PR #30')), true);
  assert.match(scored.nextStep, /Watch only/);
});
