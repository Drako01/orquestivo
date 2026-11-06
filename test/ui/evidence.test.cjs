const { test, assert, input, render, buildViewModel, renderControlCenter, scanFile, githubActionsProvider, WORKFLOW, NONCE } = require('./helpers.cjs');
const { tr } = require('../../dist-test/i18n.js');

const VERDICTS = ['PASS', 'FAIL', 'WARN', 'SKIP', 'INCONCLUSIVE', 'BLOCKED'];

function renderWithVerdicts() {
  const vm = buildViewModel(input({ intent: { status: 'ready', contract: { version: 1, criteria: [{ kind: 'run-tests' }] } } }));
  const results = VERDICTS.map((verdict, index) => ({
    id: `${index}:run-tests`, kind: 'run-tests', index, verdict, basis: verdict === 'PASS' ? 'remote-evidence' : 'static-inference',
    message: `message-${verdict}`, evidence: [{ kind: 'job', ref: 'build' }],
  }));
  const forged = { ...vm, intentGroups: [{ fileId: 0, path: 'ci.yml', overall: 'INCONCLUSIVE', results }] };
  return renderControlCenter(forged, { nonce: NONCE, cspSource: 'x', language: 'en', logoUri: 'x', t: (k, p) => tr(k, 'en', p) });
}

test('intent: each verdict has a distinct icon and text; only PASS is styled as success', () => {
  const html = renderWithVerdicts();
  const icons = new Set();
  for (const verdict of VERDICTS) {
    const m = new RegExp(`<tr><td><span class="verdict v-${verdict}"><span aria-hidden="true">([^<]+)</span> ${verdict}</span>`).exec(html);
    assert.ok(m, `row for ${verdict}`);
    icons.add(m[1]);
  }
  assert.equal(icons.size, VERDICTS.length, 'icons must be distinct');
  assert.equal((html.match(/class="verdict v-PASS"/g) ?? []).length, 1);
  assert.ok(html.includes('WARN, SKIP, INCONCLUSIVE and BLOCKED are never success'));
});

test('intent: basis separates static inference from observed remote evidence', () => {
  const html = renderWithVerdicts();
  assert.ok(html.includes('Static inference') && html.includes('Observed remote evidence'));
});

test('intent: real evaluation against a workflow model never reports unprovable criteria as PASS', () => {
  const html = render({ intent: { status: 'ready', contract: { version: 1, criteria: [{ kind: 'block-merge-on-build-failure' }, { kind: 'deploy-confirmed', job: 'deploy' }] } } });
  assert.ok(html.includes('INCONCLUSIVE'));
  assert.ok(!html.includes('class="verdict v-PASS"'));
});

test('intent: invalid contract is reported with its issues, absent contract explains how to create one', () => {
  assert.ok(render({ intent: { status: 'invalid', issues: [{ path: '$.version', message: 'must be the number 1' }] } }).includes('must be the number 1'));
  assert.ok(render().includes('.orquestivo/intent.json'));
});

test('remote: runs are labelled as observed evidence, URLs are validated, disabled state is explicit', () => {
  const run = { runId: 1, workflowName: 'CI', branch: 'main', event: 'push', status: 'completed', conclusion: 'success', headSha: 'abcdef1234567', createdAt: '2026-01-01T00:00:00Z', durationMs: 1, htmlUrl: 'javascript:alert(1)', logsUrl: 'https://api.github.com/x', jobs: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', durationMs: 1, htmlUrl: null, steps: [] }], artifacts: [] };
  const on = render({ level: 'advanced', remote: { enabled: true, connected: true, context: { status: 'available', runs: [run] } } });
  assert.ok(on.includes('Observed remote evidence: data read from GitHub'));
  assert.ok(on.includes('abcdef1') && on.includes('build: success'));
  assert.ok(!on.includes('javascript:'));
  assert.ok(on.includes('data-command="fetchRuns"') && on.includes('data-command="disconnectGitHub"'));
  assert.ok(render().includes('Remote evidence is disabled'));
  const blocked = render({ remote: { enabled: true, connected: true, context: { status: 'unavailable', reason: 'auth: token ghp_abcdefghijklmnopqrstuvwxyz0123456789' } } });
  assert.ok(blocked.includes('Remote evidence is unavailable') && !blocked.includes('ghp_abcdefghij'));
});

test('remote: workflow runs only feed criteria of the workflow they belong to', () => {
  const { remoteContextFor } = require('../../dist-test/ui/view-model.js');
  const model = githubActionsProvider.model(WORKFLOW);
  const runs = [{ workflowName: 'CI' }, { workflowName: 'Other' }];
  assert.deepEqual(remoteContextFor({ status: 'available', runs }, model, 'x.yml').runs, [{ workflowName: 'CI' }]);
  assert.equal(remoteContextFor(undefined, model, 'x.yml'), undefined);
  assert.equal(remoteContextFor({ status: 'unavailable', reason: 'r' }, model, 'x.yml').status, 'unavailable');
});

test('view model: AI button only when enabled', () => {
  const f = scanFile(0, 'ci.yml', [{ code: 'A', severity: 'error', category: 'security', message: 'm', line: 1, evidence: 'static', impact: 'i', recommendation: 'r', verification: 'static-only' }]);
  assert.ok(!render(input({ files: [f], aiEnabled: false })).includes('data-action="explain"'));
  assert.ok(render(input({ files: [f], aiEnabled: true })).includes('data-action="explain"'));
});
