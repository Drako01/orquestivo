const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeWorkflow } = require('../dist-test/core/analyzer.js');
const { githubActionsProvider } = require('../dist-test/core/github/provider.js');
const { buildJobGraph } = require('../dist-test/core/analysis/graph.js');

const JOBS = 2000;
const BUDGET_MS = 5000;
const pin = 'a'.repeat(40);

function syntheticWorkflow(count) {
  const lines = ['name: Big', 'on: [push, pull_request]', 'permissions:', '  contents: read', 'jobs:'];
  for (let i = 0; i < count; i++) {
    lines.push('  job' + i + ':', '    runs-on: ubuntu-latest', '    timeout-minutes: 10');
    if (i > 0) lines.push('    needs: job' + (i - 1));
    lines.push('    steps:', '      - uses: actions/checkout@' + pin, '      - run: echo ' + i);
  }
  return lines.join('\n') + '\n';
}

test('a 2000-job workflow analyzes, models and graphs within budget', () => {
  const source = syntheticWorkflow(JOBS);
  const timed = (fn) => { const t = performance.now(); const value = fn(); return [value, Math.round(performance.now() - t)]; };
  const [analysis, analyzeMs] = timed(() => analyzeWorkflow(source));
  const [model, modelMs] = timed(() => githubActionsProvider.model(source));
  const [graph, graphMs] = timed(() => buildJobGraph(model));
  assert.equal(analysis.syntaxValid, true);
  assert.deepEqual(analysis.findings.filter((f) => f.code === 'ANALYZER_INTERNAL_ERROR'), []);
  assert.equal(model.jobs.length, JOBS);
  assert.equal(graph.layerCount, JOBS);
  assert.ok(analyzeMs < BUDGET_MS, 'analyze ' + analyzeMs + 'ms');
  assert.ok(modelMs + graphMs < BUDGET_MS, 'model+graph ' + (modelMs + graphMs) + 'ms');
  const reportDir = process.env.ORQUESTIVO_REPORT_DIR;
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'analyzer-perf.json'),
      JSON.stringify({ jobs: JOBS, sourceBytes: source.length, analyzeMs, modelMs, graphMs, budgetMs: BUDGET_MS }, null, 2) + '\n');
  }
  console.log('perf: analyze ' + analyzeMs + 'ms, model ' + modelMs + 'ms, graph ' + graphMs + 'ms for ' + JOBS + ' jobs');
});
