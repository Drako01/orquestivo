const { test } = require('node:test');
const assert = require('node:assert/strict');
const { githubActionsProvider } = require('../../dist-test/core/github/provider.js');
const { buildViewModel, NO_FILTERS } = require('../../dist-test/ui/view-model.js');
const { renderControlCenter } = require('../../dist-test/ui/render.js');
const { tr } = require('../../dist-test/i18n.js');

const NONCE = 'dGVzdG5vbmNlMTIzNDU2Nw==';

const WORKFLOW = [
  'name: CI',
  'on: [push]',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - run: npm test',
  '  test:',
  '    needs: build',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: npm test',
  '  deploy:',
  '    needs: [build, test]',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo deploy',
  '',
].join('\n');

const HOSTILE = '<img src=x onerror=alert(1)>"\'`<script>alert(1)</script>';

function hostileFinding(overrides = {}) {
  return {
    code: HOSTILE, severity: 'error', category: 'security', message: HOSTILE, line: 3, evidence: 'static',
    snippet: HOSTILE, impact: HOSTILE, recommendation: HOSTILE, fix: HOSTILE, verification: 'static-only',
    docs: 'javascript:alert(1)', ...overrides,
  };
}

function scanFile(id, path, findings, model) {
  return {
    id, providerName: 'GitHub Actions', model,
    result: { path, uri: 'file:///' + path, provider: 'github-actions', findings, syntaxValid: true, executionVerified: false },
  };
}

function input(overrides = {}) {
  const analysis = githubActionsProvider.analyze(WORKFLOW);
  const model = githubActionsProvider.model(WORKFLOW);
  return {
    files: [scanFile(0, '.github/workflows/ci.yml', analysis.findings, model)],
    scanned: true, trusted: true, level: 'beginner', filters: NO_FILTERS,
    intent: { status: 'absent' }, remote: { enabled: false, connected: false },
    aiEnabled: false, policy: { maxFiles: 150, maxFileBytes: 1048576 }, ...overrides,
  };
}

function render(overrides = {}, language = 'en') {
  const vm = buildViewModel(input(overrides));
  return renderControlCenter(vm, {
    nonce: NONCE, cspSource: 'https://file.vscode-resource.test', language, logoUri: 'https://file.vscode-resource.test/media/icon-128.png',
    t: (key, params) => tr(key, language, params),
  });
}

const decode = (html) => html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

module.exports = { test, assert, NONCE, WORKFLOW, HOSTILE, hostileFinding, scanFile, input, render, decode, buildViewModel, renderControlCenter, githubActionsProvider };
