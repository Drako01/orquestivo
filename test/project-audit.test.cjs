const { test } = require('node:test');
const assert = require('node:assert/strict');
const project = require('../dist-test/core/project.js');
const { planRecommendations, summarizeAudit, priorityOf } = require('../dist-test/core/recommendations.js');

const finding = (over = {}) => ({
  code: 'X', severity: 'warning', category: 'reliability', message: 'm', line: 1, evidence: 'static',
  impact: 'i', recommendation: 'r', verification: 'static-only', ...over,
});
const file = (id, path, findings, syntaxValid = true) => ({ id, result: { path, findings, syntaxValid } });

test('isWithin respects path boundaries', () => {
  assert.equal(project.isWithin('file:///a/b', 'file:///a/b/c.yml'), true);
  assert.equal(project.isWithin('file:///a/b/', 'file:///a/b'), true);
  assert.equal(project.isWithin('file:///a/b', 'file:///a/bc/c.yml'), false);
});

test('scopeContains isolates projects A and B', () => {
  const root = (n) => ({ id: `file:///${n}`, name: n, uri: `file:///${n}`, workspaceFolderUri: `file:///${n}`, relativeRoot: '' });
  const scopeB = { kind: 'project', root: root('b') };
  assert.equal(project.scopeContains(scopeB, 'file:///b/.github/workflows/ci.yml'), true);
  assert.equal(project.scopeContains(scopeB, 'file:///a/.github/workflows/ci.yml'), false);
  assert.equal(project.scopeContains(undefined, 'file:///b/x'), false);
  assert.notEqual(project.scopeKey(scopeB), project.scopeKey({ kind: 'project', root: root('a') }));
});

test('detectSubProjects finds monorepo project folders only', () => {
  const dirs = project.detectSubProjects([
    '.github/workflows/ci.yml', 'apps/web/.github/workflows/ci.yml', 'services/api/.gitlab-ci.yml', 'services/api/Jenkinsfile', 'Jenkinsfile',
  ]);
  assert.deepEqual([...dirs], ['apps/web', 'services/api']);
});

test('planner orders by priority, security first, and de-duplicates', () => {
  const plan = planRecommendations([
    file(0, 'b.yml', [finding({ code: 'INFO', severity: 'information' }), finding({ code: 'SEC', category: 'security', line: 5 })]),
    file(1, 'a.yml', [finding({ code: 'ERR', severity: 'error', category: 'syntax' }), finding({ code: 'ERR', severity: 'error', category: 'syntax' })]),
  ]);
  assert.deepEqual(plan.map((p) => p.code), ['ERR', 'SEC', 'INFO']);
  assert.ok(plan.every((p) => p.automation === 'manual-only'));
  assert.equal(priorityOf({ severity: 'warning', category: 'security' }), 'P0');
});

test('audit summary never reports perfection and flags incomplete scans', () => {
  const base = { trusted: true, scanned: true, truncated: false };
  assert.equal(summarizeAudit({ ...base, trusted: false, files: [] }).status, 'not-evaluated');
  assert.equal(summarizeAudit({ ...base, scanned: false, files: [] }).status, 'not-evaluated');
  assert.equal(summarizeAudit({ ...base, files: [] }).status, 'no-ci');
  assert.equal(summarizeAudit({ ...base, files: [file(0, 'a', [])] }).status, 'no-findings');
  assert.equal(summarizeAudit({ ...base, truncated: true, files: [file(0, 'a', [])] }).status, 'partial');
  assert.equal(summarizeAudit({ ...base, files: [file(0, 'a', [finding({ code: 'FILE_READ' })])] }).status, 'attention');
  assert.equal(summarizeAudit({ ...base, files: [file(0, 'a', [finding({ severity: 'information' })])] }).status, 'no-findings');
  assert.equal(summarizeAudit({ ...base, files: [file(0, 'a', [], false)] }).status, 'attention');
});

const { render, scanFile, hostileFinding } = require('./ui/helpers.cjs');
const { parseWebviewMessage } = require('../dist-test/ui/messages.js');

test('render: project selector, primary CTA and honest status', () => {
  const html = render({ project: { kind: 'project', label: 'my-app' }, files: [scanFile(0, 'ci.yml', [])] });
  assert.ok(html.includes('my-app') && html.includes('data-command="selectProject"'));
  assert.ok(html.includes('Analyze existing CI/CD') && html.includes('Create new CI'));
  assert.ok(html.includes('No problems detected by the available rules') && !/perfect/i.test(html));
  assert.ok(html.includes('No pipeline is run'));
});

test('render: no folder offers Open project and no analyze button', () => {
  const html = render({ project: { kind: 'none', label: '' }, files: [], scanned: false });
  assert.ok(html.includes('data-command="openFolder"') && !html.includes('id="cmd-analyze"'));
});

test('render: no CI offers Create new CI; hostile plan text is escaped', () => {
  assert.ok(render({ files: [], scanned: true }).includes('id="cmd-create-ci"'));
  const html = render({ files: [scanFile(0, 'ci.yml', [hostileFinding()])] });
  assert.ok(html.includes('Needs attention') && !html.includes('<img src=x'));
});

test('webview: new commands are accepted, unknown ones are not', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'command', command: 'selectProject' }), { type: 'command', command: 'selectProject' });
  assert.equal(parseWebviewMessage({ type: 'command', command: 'applyFix' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'selectProject', uri: 'file:///x' }), undefined);
});
