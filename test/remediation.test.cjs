const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planFix, fixableIndexes, hashText, parseImprovementRecord } = require('../dist-test/providers/remediation.js');
const { providerRegistry } = require('../dist-test/providers/registry.js');
const { render, scanFile, input } = require('./ui/helpers.cjs');
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

/** Plans and proves a fix for the first finding with `code` in `source` owned by provider `id`. */
function fixFor(id, source, code) {
  const provider = providerRegistry.getProvider(id);
  const finding = provider.analyze(source).findings.find((f) => f.code === code);
  assert.ok(finding, `${code} must be reported for the fixture`);
  return planFix(source, id, finding);
}

test('fix: GitLab default timeout and artifact expiry', () => {
  const gl = 'stages: [test]\n# keep\ntest:\n  stage: test\n  script:\n    - npm test\n  artifacts:\n    paths: [dist/]\n';
  const timeout = fixFor('gitlab-ci', gl, 'GITLAB_NO_TIMEOUT');
  assert.ok(timeout && timeout.after.includes('default:\n  timeout: 30 minutes\n') && timeout.after.includes('# keep'));
  const expiry = fixFor('gitlab-ci', gl, 'GITLAB_ARTIFACT_NO_EXPIRY');
  assert.ok(expiry && expiry.after.includes('  artifacts:\n    expire_in: 1 week\n    paths: [dist/]'));
  assert.equal(planFix(gl.replace('stages', 'default:\n  retry: 1\nstages'), 'gitlab-ci', { code: 'GITLAB_NO_TIMEOUT', line: 3, message: '' }), undefined);
});

test('fix: Azure timeouts reach every job without one', () => {
  const az = 'trigger: [main]\njobs:\n  - job: build\n    pool: {vmImage: ubuntu-22.04}\n    steps:\n      - script: echo a\n  - job: test\n    timeoutInMinutes: 10\n    pool: {vmImage: ubuntu-22.04}\n    steps:\n      - script: echo b\n  - job: lint\n    pool: {vmImage: ubuntu-22.04}\n    steps:\n      - script: echo c\n';
  const plan = fixFor('azure-pipelines', az, 'AZURE_NO_TIMEOUT');
  assert.ok(plan);
  assert.equal((plan.after.match(/timeoutInMinutes: 30/g) ?? []).length, 2);
  assert.equal((plan.after.match(/timeoutInMinutes: 10/g) ?? []).length, 1);
});

test('fix: Jenkins options block is created or extended', () => {
  const plain = "pipeline {\n  agent { label 'linux' }\n  stages {\n    stage('Build') { steps { sh 'make' } }\n  }\n}\n";
  const created = fixFor('jenkins', plain, 'JENKINS_NO_TIMEOUT');
  assert.ok(created && created.after.includes("  options {\n    timeout(time: 30, unit: 'MINUTES')\n  }\n"));
  const both = planFix(created.after, 'jenkins', providerRegistry.getProvider('jenkins').analyze(created.after).findings.find((f) => f.code === 'JENKINS_NO_BUILD_DISCARDER'));
  assert.ok(both && both.after.includes("  options {\n    buildDiscarder(logRotator(numToKeepStr: '20'))\n    timeout("));
  assert.equal(planFix(plain, 'github-actions', { code: 'JENKINS_NO_TIMEOUT', line: 1, message: '' }), undefined);
});

test('undo record: persisted state is validated and bounded', () => {
  assert.deepEqual(parseImprovementRecord({ uri: 'file:///a/ci.yml', before: 'a', after: 'b' }), { uri: 'file:///a/ci.yml', before: 'a', after: 'b' });
  assert.equal(parseImprovementRecord({ uri: '', before: 'a', after: 'b' }), undefined);
  assert.equal(parseImprovementRecord({ uri: 'file:///x', before: 1, after: 'b' }), undefined);
  assert.equal(parseImprovementRecord({ uri: 'file:///x', before: 'x'.repeat(300000), after: 'y'.repeat(300000) }), undefined);
  assert.equal(parseImprovementRecord(null), undefined);
  assert.equal(parseImprovementRecord([]), undefined);
});

test('render: tabs are an accessible tablist with one visible panel and every section present', () => {
  const html = render({ files: [scanFile(0, 'ci.yml', [])] });
  assert.equal((html.match(/role="tab"/g) ?? []).length, 6);
  assert.match(html, /id="tab-summary"[^>]*aria-selected="true"/);
  assert.match(html, /id="tab-findings"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.equal((html.match(/role="tabpanel"[^>]*hidden/g) ?? []).length, 5);
  assert.ok(html.includes('aria-controls="panel-pipeline"') && html.includes('id="app"'));
});

test('render: specific states for untrusted, cancelled and unreadable files', () => {
  const untrusted = render({ trusted: false });
  assert.ok(untrusted.includes('data-command="manageTrust"') && untrusted.includes('Restricted Mode'));
  const cancelled = render({ cancelled: true });
  assert.ok(cancelled.includes('The last analysis was cancelled'));
  const finding = { code: 'FILE_READ', severity: 'warning', category: 'configuration', message: 'm', line: 1, evidence: 'static', impact: 'i', recommendation: 'r', verification: 'static-only' };
  assert.ok(render({ files: [scanFile(0, 'ci.yml', [finding])] }).includes('1 file(s) could not be read'));
  assert.ok(!render().includes('The last analysis was cancelled'));
});

test('render: body is a fragment without document, script or style', () => {
  const { buildViewModel, renderControlCenterBody } = require('../dist-test/ui/render.js') && { ...require('../dist-test/ui/view-model.js'), ...require('../dist-test/ui/render.js') };
  const { tr } = require('../dist-test/i18n.js');
  const body = renderControlCenterBody(buildViewModel(input()), { nonce: 'n', cspSource: 'x', language: 'en', logoUri: 'x', t: (k, p) => tr(k, 'en', p) });
  assert.ok(!/<(html|head|body|script|style)\b/i.test(body) && body.includes('role="tablist"'));
});

test('webview: previewFix is strictly validated', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'previewFix', file: 1, index: 2 }), { type: 'previewFix', file: 1, index: 2 });
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: 1, index: 2, path: '/etc/x' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: '1', index: 2 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'previewFix', file: -1, index: 2 }), undefined);
});
