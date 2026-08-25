const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'config', 'github-contribution-radar.json');
const outputJsonPath = path.join(projectRoot, 'ops', 'GITHUB_CONTRIBUTION_RADAR.json');
const outputMarkdownPath = path.join(projectRoot, 'ops', 'GITHUB_CONTRIBUTION_RADAR.md');
const checkOnly = process.argv.includes('--check');
const dryRun = process.argv.includes('--dry-run');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateConfig(config) {
  const errors = [];
  if (config.version !== 1) errors.push('version must be 1');
  if (!Number.isInteger(config.lookbackDays) || config.lookbackDays < 1) errors.push('lookbackDays must be a positive integer');
  if (!Array.isArray(config.searches) || config.searches.length === 0) errors.push('searches must contain at least one query');
  if (!Array.isArray(config.watchIssues)) errors.push('watchIssues must be an array');
  if (config.knownCollisions && !Array.isArray(config.knownCollisions)) errors.push('knownCollisions must be an array');
  for (const search of config.searches || []) {
    if (!search.id || !search.query) errors.push('every search needs an id and query');
  }
  for (const issueUrl of config.watchIssues || []) {
    if (!parseIssueUrl(issueUrl)) errors.push(`invalid watch issue URL: ${issueUrl}`);
  }
  if (errors.length) throw new Error(`Invalid Contribution Radar config:\n- ${errors.join('\n- ')}`);
}

function parseIssueUrl(issueUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/.exec(issueUrl);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function daysAgoIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function daysSince(isoDate) {
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000));
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeLabels(labels) {
  return (labels || []).map(label => typeof label === 'string' ? label : label.name).filter(Boolean);
}

function repositoryNameFromApiUrl(repositoryUrl) {
  return repositoryUrl.replace(/^https:\/\/api\.github\.com\/repos\//, '');
}

function hasAny(text, patterns) {
  return patterns.some(pattern => text.includes(pattern));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsSignal(text, signal) {
  const normalized = signal.toLowerCase();
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalized)}(?:$|[^a-z0-9])`, 'i').test(text);
}

function issuePreScore(issue, config) {
  const text = `${issue.title || ''}\n${issue.body || ''}`.toLowerCase();
  const labels = normalizeLabels(issue.labels).map(label => label.toLowerCase());
  const familiar = config.familiarRepositories.find(item => item.name.toLowerCase() === repositoryNameFromApiUrl(issue.repository_url).toLowerCase());
  let score = familiar ? familiar.familiarity : 0;
  score += Math.min(12, config.skillSignals.filter(signal => containsSignal(text, signal)).length * 2);
  if (labels.includes('good first issue')) score += 8;
  if (labels.includes('help wanted')) score += 7;
  if (hasAny(text, ['acceptance criteria', 'expected fix', 'deterministic reproduction'])) score += 7;
  score += Math.max(0, 8 - Math.floor(daysSince(issue.updated_at) / 14));
  return score;
}

function scoreIssue(issue, repository, config, sources) {
  const title = issue.title || '';
  const body = issue.body || '';
  const text = `${title}\n${body}`.toLowerCase();
  const discussionText = (issue.radarComments || []).map(comment => comment.body || '').join('\n').toLowerCase();
  const labels = normalizeLabels(issue.labels);
  const lowerLabels = labels.map(label => label.toLowerCase());
  const repoName = repository.full_name;
  const familiar = config.familiarRepositories.find(item => item.name.toLowerCase() === repoName.toLowerCase());
  const signalText = `${text}\n${repository.language || ''}\n${(repository.topics || []).join(' ')}`;
  const signalHits = unique(config.skillSignals.filter(signal => containsSignal(signalText, signal)));
  const sourcePriority = Math.max(0, ...sources.map(sourceId => config.searches.find(search => search.id === sourceId)?.priority || 0));
  const ageDays = daysSince(issue.updated_at);

  let strategicFit = Math.min(40, (familiar?.familiarity || 0) + Math.min(10, signalHits.length * 2));
  if (familiar && text.includes('false positive')) strategicFit = Math.min(40, strategicFit + 5);

  let issueReadiness = issue.assignee ? 0 : 5;
  if (lowerLabels.includes('ready')) issueReadiness += 5;
  if (lowerLabels.includes('help wanted')) issueReadiness += 5;
  if (lowerLabels.includes('good first issue')) issueReadiness += 5;
  if (lowerLabels.some(label => label.includes('size: small') || label.includes('points: 1'))) issueReadiness += 3;
  if (hasAny(text, ['acceptance criteria', 'expected fix', 'deterministic reproduction'])) issueReadiness += 5;
  if (/\b(?:apps|packages|src|tests|docs|fs|include)\/[\w./-]+/.test(body)) issueReadiness += 3;
  issueReadiness = Math.min(25, issueReadiness);

  let evidenceQuality = 0;
  if (text.includes('false positive')) evidenceQuality += 5;
  if (hasAny(text, ['deterministic reproduction', 'reproduce', 'reproducer'])) evidenceQuality += 5;
  if (body.includes('`')) evidenceQuality += 3;
  if (hasAny(text, ['expected fix', 'expected behavior', 'git grep', 'commit ', 'passes', 'fails'])) evidenceQuality += 4;
  if (hasAny(text, ['test', 'regression', 'assert'])) evidenceQuality += 3;
  if (hasAny(text, ['locally', 'claude', 'gemini']) && text.includes('false positive')) evidenceQuality += 4;
  evidenceQuality = Math.min(20, evidenceQuality);

  let repoHealth = repository.archived ? 0 : 4;
  const pushedDays = daysSince(repository.pushed_at);
  repoHealth += pushedDays <= 60 ? 5 : pushedDays <= 180 ? 3 : 0;
  repoHealth += repository.stargazers_count >= 100 ? 4 : repository.stargazers_count >= 20 ? 3 : 1;
  if (repository.has_issues) repoHealth += 1;
  if (repository.license) repoHealth += 1;
  repoHealth = Math.min(15, repoHealth);

  let freshness = ageDays <= 7 ? 7 : ageDays <= 30 ? 5 : ageDays <= 90 ? 3 : 1;
  if (!issue.assignee) freshness += 1;
  freshness += Math.min(2, sourcePriority);
  freshness = Math.min(10, freshness);

  const penalties = [];
  if ((issue.user?.login || '').toLowerCase() === config.ownerLogin.toLowerCase()) penalties.push({ reason: 'Issue was opened by the owner', points: 30 });
  if (/\b(?:i(?:'ll| will| am going to)|we(?:'ll| will)).{0,60}(?:send|open|submit|implement).{0,30}(?:pr|pull request|diff)|working on this|already implemented/i.test(text)) {
    penalties.push({ reason: 'Another contributor signals active implementation', points: 20 });
  }
  if (/github\.com\/[^\s)]+\/pull\/\d+|\b(?:pr|pull request)\s*#?\d+|\bopened (?:a )?pull request\b/i.test(discussionText)) {
    penalties.push({ reason: 'Issue discussion links an existing pull request', points: 45 });
  }
  const knownCollision = (config.knownCollisions || []).find(item => item.url === issue.html_url);
  if (knownCollision) penalties.push({ reason: knownCollision.reason, points: 45 });
  if (repository.archived) penalties.push({ reason: 'Repository is archived', points: 50 });
  if (ageDays > 365) penalties.push({ reason: 'Issue has been inactive for over a year', points: 10 });

  const penaltyTotal = penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  const total = Math.max(0, Math.min(100, strategicFit + issueReadiness + evidenceQuality + repoHealth + freshness - penaltyTotal));
  const small = lowerLabels.some(label => label.includes('size: small') || label.includes('points: 1') || label === 'good first issue');
  const owned = penalties.some(penalty => penalty.reason.includes('active implementation') || penalty.reason.includes('existing pull request') || penalty.reason.includes('PR #'));
  const nextStep = owned
    ? 'Watch only; another contributor has signalled ownership.'
    : familiar
      ? 'Approve entry into a WIP lane, then run a local root-cause and regression feasibility audit before commenting.'
      : lowerLabels.includes('help wanted')
        ? 'Approve entry into a WIP lane and the repository-required claim comment, then reproduce locally.'
        : 'Run a local feasibility audit before any public interaction.';

  return {
    rank: null,
    score: total,
    repository: repoName,
    number: issue.number,
    title,
    url: issue.html_url,
    author: issue.user?.login || null,
    updatedAt: issue.updated_at,
    labels,
    language: repository.language,
    stars: repository.stargazers_count,
    effort: small ? 'small' : 'medium',
    familiarReason: familiar?.reason || null,
    signalHits,
    sources,
    breakdown: { strategicFit, issueReadiness, evidenceQuality, repoHealth, freshness, penalties },
    nextStep
  };
}

async function githubRequest(apiPath, query = {}) {
  const url = new URL(`https://api.github.com${apiPath}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MyAIPA-Contribution-Radar'
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub API ${response.status} for ${url.pathname}: ${detail.slice(0, 240)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchIssues(search, config) {
  const updated = `updated:>=${daysAgoIso(config.lookbackDays)}`;
  const query = search.query.includes('updated:') ? search.query : `${search.query} ${updated}`;
  try {
    const result = await githubRequest('/search/issues', {
      q: query,
      sort: 'updated',
      order: 'desc',
      per_page: config.maxResultsPerSearch
    });
    return { query, items: result.items };
  } catch (error) {
    if (!query.includes('-linked:pr') || !String(error.message).includes('422')) throw error;
    const fallbackQuery = query.replace('-linked:pr', '').replace(/\s+/g, ' ').trim();
    const result = await githubRequest('/search/issues', {
      q: fallbackQuery,
      sort: 'updated',
      order: 'desc',
      per_page: config.maxResultsPerSearch
    });
    return { query: fallbackQuery, items: result.items, warning: 'linked PR filter was not supported by the API and must be verified manually' };
  }
}

function toMarkdown(report, config) {
  const lines = [
    '# GitHub Contribution Radar',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '**Mode:** read-only. No issue was commented on, claimed, forked, pushed, or submitted.',
    '',
    '## Recommendation',
    '',
    report.recommendation,
    '',
    '## Ranked queue',
    '',
    '| Rank | Score | Opportunity | Effort | Why it survived |',
    '| ---: | ---: | --- | --- | --- |'
  ];
  for (const item of report.items) {
    const why = [item.familiarReason, item.signalHits.slice(0, 4).join(', ')].filter(Boolean).join('; ');
    lines.push(`| ${item.rank} | ${item.score} | [${item.repository}#${item.number}: ${item.title}](${item.url}) | ${item.effort} | ${why || 'Fresh, unassigned, and evidence-backed'} |`);
  }
  if (report.safeSkips.length) {
    lines.push('', '## Safe skips', '');
    for (const item of report.safeSkips) {
      lines.push(`- [${item.repository}#${item.number}: ${item.title}](${item.url}) — ${item.reasons.join('; ')}`);
    }
  }
  lines.push('', '## Approval gate', '');
  for (const action of config.approvalPolicy.requiresApproval) lines.push(`- ${action}`);
  lines.push('', '## Safe next action', '', report.safeNextAction, '', '## Search notes', '');
  for (const search of report.searches) {
    lines.push(`- **${search.id}:** \`${search.query}\`${search.warning ? ` (${search.warning})` : ''}`);
  }
  lines.push('', '## Exclusions', '', `- ${report.excludedCount} candidates scored below ${config.minimumScore} or were displaced by stronger evidence.`, '- Owner-authored issues receive a penalty.', '- Issues signalling another contributor is already implementing the change are watch-only.', '');
  return `${lines.join('\n')}\n`;
}

async function run() {
  const config = readJson(configPath);
  validateConfig(config);
  if (checkOnly) {
    console.log('Contribution Radar config is valid.');
    return;
  }
  const datedQueries = config.searches.map(search => ({
    ...search,
    effectiveQuery: search.query.includes('updated:') ? search.query : `${search.query} updated:>=${daysAgoIso(config.lookbackDays)}`
  }));
  if (dryRun) {
    console.log(JSON.stringify({ watchIssues: config.watchIssues, searches: datedQueries }, null, 2));
    return;
  }

  const candidates = new Map();
  const searches = [];
  for (const search of config.searches) {
    const result = await searchIssues(search, config);
    searches.push({ id: search.id, query: result.query, warning: result.warning || null, resultCount: result.items.length });
    for (const issue of result.items) {
      const key = issue.html_url;
      const existing = candidates.get(key) || { issue, sources: [] };
      existing.sources.push(search.id);
      candidates.set(key, existing);
    }
  }

  for (const issueUrl of config.watchIssues) {
    const parsed = parseIssueUrl(issueUrl);
    const issue = await githubRequest(`/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`);
    if (issue.pull_request || issue.state !== 'open') continue;
    issue.repository_url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const existing = candidates.get(issue.html_url) || { issue, sources: [] };
    existing.sources.push('watch-list');
    candidates.set(issue.html_url, existing);
  }

  const prequalified = [...candidates.values()]
    .filter(candidate => !candidate.issue.pull_request && candidate.issue.state === 'open')
    .sort((a, b) => issuePreScore(b.issue, config) - issuePreScore(a.issue, config))
    .slice(0, config.maxRepositoriesToQualify);
  const repositories = new Map();
  for (const candidate of prequalified) {
    const repoName = repositoryNameFromApiUrl(candidate.issue.repository_url);
    if (!repositories.has(repoName)) repositories.set(repoName, await githubRequest(`/repos/${repoName}`));
  }
  for (const candidate of prequalified) {
    if (!candidate.issue.comments) continue;
    const repoName = repositoryNameFromApiUrl(candidate.issue.repository_url);
    try {
      candidate.issue.radarComments = await githubRequest(
        `/repos/${repoName}/issues/${candidate.issue.number}/comments`,
        { per_page: 100 }
      );
    } catch (error) {
      searches.push({
        id: `discussion-${repoName}#${candidate.issue.number}`,
        query: 'Issue-comment collision check',
        warning: error.message,
        resultCount: 0
      });
    }
  }

  const scored = prequalified
    .map(candidate => scoreIssue(candidate.issue, repositories.get(repositoryNameFromApiUrl(candidate.issue.repository_url)), config, unique(candidate.sources)));
  const safeSkips = scored
    .filter(item => item.breakdown.penalties.some(penalty => penalty.reason.includes('existing pull request') || penalty.reason.includes('active implementation') || penalty.reason.includes('PR #')))
    .map(item => ({
      repository: item.repository,
      number: item.number,
      title: item.title,
      url: item.url,
      reasons: item.breakdown.penalties.map(penalty => penalty.reason)
    }));
  const ranked = scored
    .filter(item => item.score >= config.minimumScore)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, config.reportLimit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  if (!ranked.length) throw new Error('No candidates cleared the configured minimum score.');

  const strategic = ranked.find(item => item.repository.toLowerCase() === 'sashiko-dev/sashiko' && item.title.toLowerCase().includes('false positive')) || ranked[0];
  const fastest = ranked.find(item => item.effort === 'small' && item.labels.some(label => label.toLowerCase() === 'ready')) || ranked[0];
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    recommendation: `Strategic pick: ${strategic.repository}#${strategic.number} (${strategic.score}/100). Fastest bounded win: ${fastest.repository}#${fastest.number} (${fastest.score}/100). Keep both queued until Oliver chooses whether one should replace an active WIP item.`,
    safeNextAction: `If Oliver selects ${strategic.repository}#${strategic.number}, run a local feasibility audit first. Public claiming, comments, forks, pushes, and pull requests remain separately approval-gated.`,
    searches,
    candidateCount: candidates.size,
    qualifiedCount: prequalified.length,
    excludedCount: Math.max(0, prequalified.length - ranked.length),
    safeSkips,
    items: ranked
  };
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdownPath, toMarkdown(report, config));
  console.log(report.recommendation);
  console.log(`Wrote ${path.relative(projectRoot, outputMarkdownPath)} and ${path.relative(projectRoot, outputJsonPath)}.`);
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { containsSignal, parseIssueUrl, scoreIssue, validateConfig };
