const { test } = require('node:test');
const assert = require('node:assert/strict');
const { githubActionsProvider } = require('../dist-test/core/github/provider.js');
const { buildJobGraph, renderGraphText } = require('../dist-test/core/analysis/graph.js');

const pin = 'a'.repeat(40);
const source = [
  'name: Pipeline',
  'on:',
  '  push:',
  '    branches: [main]',
  '    tags: ["v*"]',
  '    paths: ["src/**"]',
  '  pull_request:',
  '    types: [opened, synchronize]',
  '  workflow_dispatch:',
  'permissions:',
  '  contents: read',
  'concurrency: ci',
  'jobs:',
  '  build:',
  '    name: Build it',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 15',
  '    strategy:',
  '      matrix:',
  '        node: [20, 22]',
  '        include:',
  '          - node: 24',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@' + pin,
  '      - run: npm test',
  '        if: success()',
  '  test:',
  '    needs: [build]',
  '    runs-on: { group: big, labels: [linux, x64] }',
  '    permissions: write-all',
  '    steps:',
  '      - run: echo hi',
  '  ship:',
  '    needs: [build, test]',
  '    uses: ./.github/workflows/ship.yml',
  "    if: github.ref == 'refs/heads/main'",
  '  deploy:',
  '    needs: ship',
  '    runs-on: ubuntu-latest',
  '    environment:',
  '      name: production',
  '    permissions:',
  '      contents: write',
  '    steps:',
  '      - run: ./deploy.sh',
  '',
].join('\n');

test('provider metadata and path matching', () => {
  assert.equal(githubActionsProvider.id, 'github-actions');
  assert.deepEqual(githubActionsProvider.filePatterns, ['.github/workflows/*.yml', '.github/workflows/*.yaml']);
  for (const ok of ['.github/workflows/ci.yml', 'pkg/.github/workflows/ci.yaml', '.GITHUB/workflows/x.YML']) {
    assert.equal(githubActionsProvider.matches(ok), true, ok);
  }
  for (const bad of ['.github/workflows/ci.json', '.github/workflows/sub/ci.yml', 'github/workflows/ci.yml', '.github/workflows/ci.yml.bak']) {
    assert.equal(githubActionsProvider.matches(bad), false, bad);
  }
});

test('provider analyze delegates to the analyzer', () => {
  assert.equal(githubActionsProvider.analyze('on: push').syntaxValid, true);
});

test('model maps triggers, jobs, steps and workflow settings', () => {
  const model = githubActionsProvider.model(source);
  assert.equal(model.provider, 'github-actions');
  assert.equal(model.name, 'Pipeline');
  assert.equal(model.hasConcurrency, true);
  assert.deepEqual(model.permissions, { contents: 'read' });
  assert.deepEqual(model.triggers[0], { event: 'push', branches: ['main'], tags: ['v*'], paths: ['src/**'] });
  assert.deepEqual(model.triggers[1], { event: 'pull_request', types: ['opened', 'synchronize'] });
  assert.deepEqual(model.triggers[2], { event: 'workflow_dispatch' });
  const [build, test, ship, deploy] = model.jobs;
  assert.deepEqual([build.id, build.name, build.line, build.timeoutMinutes], ['build', 'Build it', 14, 15]);
  assert.deepEqual(build.matrix, { node: [20, 22] });
  assert.deepEqual(build.steps.map((s) => [s.index, s.line, s.name, s.uses, s.run, s.condition]), [
    [0, 24, 'Checkout', 'actions/checkout@' + pin, undefined, undefined],
    [1, 26, undefined, undefined, 'npm test', 'success()'],
  ]);
  assert.deepEqual(test.runsOn, ['linux', 'x64']);
  assert.equal(test.permissions, 'write-all');
  assert.deepEqual(test.needs, ['build']);
  assert.equal(ship.uses, './.github/workflows/ship.yml');
  assert.equal(ship.condition, "github.ref == 'refs/heads/main'");
  assert.deepEqual(ship.runsOn, []);
  assert.equal(deploy.environment, 'production');
  assert.deepEqual(deploy.permissions, { contents: 'write' });
});

test('model is undefined for unparseable sources and tolerates minimal ones', () => {
  assert.equal(githubActionsProvider.model('jobs: ['), undefined);
  assert.equal(githubActionsProvider.model(''), undefined);
  const minimal = githubActionsProvider.model('on: push');
  assert.deepEqual(minimal.jobs, []);
  assert.equal(minimal.hasConcurrency, false);
  assert.equal(minimal.permissions, undefined);
});

test('job graph layers jobs topologically and keeps every edge', () => {
  const graph = buildJobGraph(githubActionsProvider.model(source));
  assert.deepEqual(graph.nodes.map((n) => [n.id, n.layer]), [['build', 0], ['test', 1], ['ship', 2], ['deploy', 3]]);
  assert.deepEqual(graph.edges.map((e) => e.from + '>' + e.to), ['build>test', 'build>ship', 'test>ship', 'ship>deploy']);
  assert.equal(graph.layerCount, 4);
  assert.equal(graph.nodes[0].name, 'Build it');
  assert.equal(graph.nodes[1].name, 'test');
});

test('graph handles parallel jobs, unknown needs, cycles and empty pipelines', () => {
  const parallel = githubActionsProvider.model('on: push\njobs:\n  a: {runs-on: x, steps: [{run: a}]}\n  b: {runs-on: x, steps: [{run: a}]}\n  c: {needs: [a, b, ghost], uses: ./.github/workflows/c.yml}\n');
  const g = buildJobGraph(parallel);
  assert.deepEqual(g.nodes.map((n) => n.layer), [0, 0, 1]);
  assert.equal(g.edges.length, 2);
  const cyclic = githubActionsProvider.model('on: push\njobs:\n  a: {needs: b, uses: ./.github/workflows/a.yml}\n  b: {needs: a, uses: ./.github/workflows/b.yml}\n  c: {uses: ./.github/workflows/c.yml}\n');
  const cg = buildJobGraph(cyclic);
  assert.deepEqual(cg.nodes.map((n) => n.cyclic), [true, true, false]);
  assert.equal(cg.nodes[0].layer, 1);
  assert.match(renderGraphText(cg), /circular dependency/);
  assert.equal(renderGraphText(buildJobGraph(githubActionsProvider.model('on: push'))), 'No jobs.');
});

test('text rendering is a readable accessible alternative', () => {
  const text = renderGraphText(buildJobGraph(githubActionsProvider.model(source)));
  assert.equal(text, [
    '4 job(s) in 4 stage(s).',
    '',
    'Stage 1:',
    '  - Build it (build), line 14, starts immediately',
    '',
    'Stage 2:',
    '  - test, line 28, runs after build',
    '',
    'Stage 3:',
    '  - ship, line 34, runs after build, test',
    '',
    'Stage 4:',
    '  - deploy, line 38, runs after ship',
  ].join('\n'));
});
