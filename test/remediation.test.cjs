const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planFix, fixableIndexes, hashText } = require('../dist-test/core/remediation.js');
const { githubActionsProvider: gh } = require('../dist-test/core/github/provider.js');
const { planRecommendations } = require('../dist-test/core/recommendations.js');
const { parseWebviewMessage } = require('../dist-test/ui/messages.js');

const SRC = [
  '# CI pipeline', 'name: CI', 'on: [push]', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    # keep me',
  '    steps:', '      - run: npm test', '',
].join('\n');

const find = (source, code) => gh.analyze(source).findings.find((f) => f.code === code);

test('fix: permissions block is inserted minimally and verified', () => {
  const plan = planFix(SRC, 'github-actions', find(SRC, 'PERMISSIONS_UNDECLARED'));
  assert.ok(plan);
  assert.equal(plan.after, SRC.replace('jobs:\n', 'permissions:\n  contents: read\n\njobs:\n'));
  assert.equal(plan.sourceHash, hashText(SRC));
  assert.ok(plan.after.includes('# keep me') && plan.after.includes('# CI pipeline'));
  assert.equal(find(plan.after, 'PERMISSIONS_UNDECLARED'), undefined);
});

test('fix: job timeout goes first inside the job and keeps CRLF', () => {
  const crlf = SRC.replace(/\n/g, '\r\n');
  const plan = planFix(crlf, 'github-actions', find(crlf, 'TIMEOUT_UNSET'));
  assert.ok(plan);
  assert.ok(plan.after.includes('  build:\r\n    timeout-minutes: 30\r\n    runs-on'));
  assert.equal(find(plan.after, 'TIMEOUT_UNSET'), undefined);
});

test('fix: refuses unsupported providers, codes and unsafe shapes', () => {
  const f = find(SRC, 'TIMEOUT_UNSET');
  assert.equal(planFix(SRC, 'gitlab-ci', f), undefined);
  assert.equal(planFix(SRC, 'github-actions', { ...f, code: 'EXPRESSION_IN_SCRIPT' }), undefined);
  assert.equal(planFix(SRC, 'github-actions', { ...f, line: 1 }), undefined);
  const flow = 'on: [push]\njobs: {a: {runs-on: x, steps: [{run: y}]}}\n';
  assert.equal(planFix(flow, 'github-actions', { code: 'PERMISSIONS_UNDECLARED', line: 2, message: '' }), undefined);
  const declared = SRC.replace('jobs:', 'permissions:\n  contents: read\njobs:');
  assert.equal(planFix(declared, 'github-actions', { code: 'PERMISSIONS_UNDECLARED', line: 5, message: '' }), undefined);
});

test('planner marks only verified fixes as preview-required', () => {
  const findings = gh.analyze(SRC).findings;
  const fixable = fixableIndexes(SRC, 'github-actions', findings);
  assert.ok(fixable.length >= 2);
  const plan = planRecommendations([{ id: 3, result: { path: 'ci.yml', findings }, fixable }]);
  for (const p of plan) assert.equal(p.automation === 'preview-required', fixable.includes(p.index));
  assert.ok(plan.some((p) => p.automation === 'manual-only') || plan.every((p) => p.automation === 'preview-required'));
  assert.deepEqual(fixableIndexes(SRC, 'jenkins', findings), []);
});

test('webview: previewFix is strictly validated', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'previewFix', file: 1, index: 2 }), { type: 'previewFix', file: 1, index: 2 });
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: 1, index: 2, path: '/etc/x' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: '1', index: 2 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: -1, index: 2 }), undefined);
});
