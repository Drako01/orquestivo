// Activation-independent performance budgets for the pure analysis core. Budgets are generous (>= 3x observed medians).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeWorkflow } = require('../../dist-test/core/analyzer.js');
const { githubActionsProvider } = require('../../dist-test/core/github/provider.js');
const { buildJobGraph } = require('../../dist-test/core/analysis/graph.js');
const { layerNodes } = require('../../dist-test/core/analysis/topology.js');
const h = require('./perf-helper.cjs');

const noInternalErrors = (analysis) => assert.deepEqual(analysis.findings.filter((f) => f.code === 'ANALYZER_INTERNAL_ERROR'), []);

test('perf: 2000-job workflow analysis', () => {
  const source = h.chainedWorkflow(2000);
  const { value, medianMs, samples } = h.timed(() => analyzeWorkflow(source));
  noInternalErrors(value);
  const budgetMs = 8000;
  h.emitReport('analyze-2000-jobs', { jobs: 2000, bytes: source.length, medianMs, samples, budgetMs });
  assert.ok(medianMs < budgetMs, `median ${medianMs}ms`);
});

test('perf: 500 small workflows in a batch', () => {
  const sources = Array.from({ length: 500 }, (_, i) => h.smallWorkflow(i));
  const { value, medianMs, samples } = h.timed(() => sources.map(analyzeWorkflow));
  assert.equal(value.length, 500);
  assert.ok(value.every((a) => a.syntaxValid));
  const budgetMs = 8000;
  h.emitReport('batch-500-small', { workflows: 500, medianMs, samples, budgetMs });
  assert.ok(medianMs < budgetMs, `median ${medianMs}ms`);
});

test('perf: deep matrix and long expression workflow', () => {
  const source = h.matrixExpressionWorkflow(6, 6);
  const { value, medianMs, samples } = h.timed(() => analyzeWorkflow(source), 5);
  assert.equal(value.syntaxValid, true);
  noInternalErrors(value);
  const budgetMs = 3000;
  h.emitReport('deep-matrix-expressions', { bytes: source.length, medianMs, samples, budgetMs });
  assert.ok(medianMs < budgetMs, `median ${medianMs}ms`);
});

test('perf: 50 concurrent analyses via Promise.all are consistent and bounded', async () => {
  const sources = Array.from({ length: 50 }, (_, i) => (i % 2 ? h.chainedWorkflow(60, `C${i}`) : h.smallWorkflow(i)));
  const expected = sources.map((s) => JSON.stringify(analyzeWorkflow(s)));
  const { value, medianMs, samples } = await h.timedAsync(() => Promise.all(sources.map(async (s) => analyzeWorkflow(s))));
  assert.deepEqual(value.map((a) => JSON.stringify(a)), expected, 'concurrent results must equal sequential results');
  const budgetMs = 8000;
  h.emitReport('concurrent-50', { workflows: 50, medianMs, samples, budgetMs });
  assert.ok(medianMs < budgetMs, `median ${medianMs}ms`);
});

test('perf: graph build for 2000 nodes (chain) and layering of 20000', () => {
  const model = githubActionsProvider.model(h.chainedWorkflow(2000));
  const graph = h.timed(() => buildJobGraph(model));
  assert.equal(graph.value.nodes.length, 2000);
  assert.equal(graph.value.edges.length, 1999);
  assert.equal(graph.value.layerCount, 2000);
  const deps = new Map();
  for (let i = 0; i < 20000; i++) deps.set('n' + i, i ? ['n' + (i - 1)] : []);
  const layering = h.timed(() => layerNodes(deps));
  assert.equal(layering.value.layers.get('n19999'), 19999);
  h.emitReport('graph-2000', { graphMedianMs: graph.medianMs, layerNodes20000MedianMs: layering.medianMs });
  assert.ok(graph.medianMs < 3000, `graph ${graph.medianMs}ms`);
  assert.ok(layering.medianMs < 3000, `layering ${layering.medianMs}ms`);
});

test('perf: repeated analyses do not leak (bounded heap growth)', () => {
  const source = h.chainedWorkflow(100);
  const heap = () => { if (global.gc) global.gc(); return process.memoryUsage().heapUsed; };
  for (let i = 0; i < 20; i++) analyzeWorkflow(source); // warm up
  const before = heap();
  for (let i = 0; i < 200; i++) analyzeWorkflow(source);
  const growthMb = Math.round(((heap() - before) / 1024 / 1024) * 10) / 10;
  const limitMb = global.gc ? 30 : 300; // without forced GC, uncollected garbage is not a leak: keep the bound loose
  h.emitReport('memory-growth', { iterations: 200, growthMb, limitMb, gcExposed: Boolean(global.gc) });
  assert.ok(growthMb < limitMb, `heap grew ${growthMb}MB`);
});
