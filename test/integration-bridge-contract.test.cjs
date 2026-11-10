const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('integration prompts are registered only in the isolated E2E environment', () => {
  const source = read('src/vscode/e2e-prompts.ts');
  const entrypoint = read('src/extension.ts');
  assert.match(source, /ORQUESTIVO_E2E_MODE !== '1'/);
  assert.match(source, /orquestivo\.__e2e\.prompts\.begin/);
  assert.match(source, /orquestivo\.__e2e\.prompts\.snapshot/);
  assert.match(source, /orquestivo\.__e2e\.prompts\.end/);
  assert.match(entrypoint, /registerIntegrationPrompts\(context\)/);
});

test('integration suite has bounded deadlines and uses the extension-owned prompt bridge', () => {
  const runner = read('test/integration/run.mjs');
  const scenarios = read('test/integration/scenarios.cjs');
  assert.match(runner, /ORQUESTIVO_E2E_MODE = '1'/);
  assert.match(runner, /E2E_TIMEOUT/);
  assert.match(scenarios, /orquestivo\.__e2e\.prompts\.begin/);
  assert.match(scenarios, /START integration scenario/);
  assert.match(scenarios, /E2E_TIMEOUT/);
  assert.doesNotMatch(scenarios, /vscode\.window\[name\] = fn/);
});

test('CI retains the real VS Code packaged VSIX smoke before artifact approval', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /name: Package installable preview VSIX/);
  assert.match(ci, /needs: \[verify, verify-ubuntu\]/);
  assert.match(ci, /xvfb-run -a npm run test:integration/);
  assert.match(ci, /node scripts\/release-provenance.mjs stamp/);
});
