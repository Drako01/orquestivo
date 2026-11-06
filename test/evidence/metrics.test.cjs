const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRuns, compareMetrics, percentile } = require('../../dist-test/core/evidence/metrics.js');
const { run, jobEv, stepEv } = require('./helpers.cjs');

test('percentile: nearest rank, empty, single, unsorted input', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
});

test('analyzeRuns: empty input yields nulls, not zeros', () => {
  const m = analyzeRuns([]);
  assert.equal(m.runCount, 0);
  assert.equal(m.failureRate, null);
  assert.equal(m.durationP50Ms, null);
  assert.deepEqual(m.redundantJobs, []);
});

test('analyzeRuns: failure rate ignores cancelled/skipped/in-progress; durations only for completed', () => {
  const runs = [
    run(1, { durationMs: 100 }),
    run(2, { conclusion: 'failure', durationMs: 300 }),
    run(3, { conclusion: 'cancelled', durationMs: 50 }),
    run(4, { status: 'in_progress', conclusion: null, durationMs: null }),
    run(5, { conclusion: 'timed_out', durationMs: 200 }),
  ];
  const m = analyzeRuns(runs);
  assert.equal(m.decidedCount, 3);
  assert.equal(m.failureRate, 2 / 3);
  assert.equal(m.durationP50Ms, 200);
  assert.equal(m.durationP95Ms, 300);
});

test('analyzeRuns: slowest jobs and steps ranked by average, matrix legs merged', () => {
  const mk = (id, buildMs, testMs) => run(id, {
    jobs: [
      jobEv(1, 'build (ubuntu)', { durationMs: buildMs, steps: [stepEv(1, 'Compile', buildMs)] }),
      jobEv(2, 'test', { durationMs: testMs, steps: [stepEv(1, 'Run', testMs), stepEv(2, 'Null', null)] }),
    ],
  });
  const m = analyzeRuns([mk(1, 100, 500), mk(2, 300, 700)], { topN: 1 });
  assert.equal(m.slowestJobs.length, 1);
  assert.deepEqual(m.slowestJobs[0], { name: 'test', samples: 2, avgMs: 600, maxMs: 700 });
  assert.equal(m.slowestSteps[0].name, 'test / Run');
  const all = analyzeRuns([mk(1, 100, 500)]);
  assert.ok(all.slowestJobs.some((j) => j.name === 'build'));
});

test('analyzeRuns: redundant jobs = identical step sets, but matrix legs are not redundant', () => {
  const steps = () => [stepEv(1, 'Checkout', 1), stepEv(2, 'Lint', 1)];
  const r = run(1, {
    jobs: [
      jobEv(1, 'lint-a', { steps: steps() }), jobEv(2, 'lint-b', { steps: steps() }),
      jobEv(3, 'unit (node 20)', { steps: [stepEv(1, 'T', 1)] }), jobEv(4, 'unit (node 22)', { steps: [stepEv(1, 'T', 1)] }),
      jobEv(5, 'empty-a'), jobEv(6, 'empty-b'),
    ],
  });
  const groups = analyzeRuns([r]).redundantJobs;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].jobs, ['lint-a', 'lint-b']);
});

test('analyzeRuns: redundancy uses the latest run only', () => {
  const dup = (id) => run(id, { jobs: [jobEv(1, 'a', { steps: [stepEv(1, 'X', 1)] }), jobEv(2, 'b', { steps: [stepEv(1, 'X', 1)] })] });
  const fixed = run(9, { jobs: [jobEv(1, 'a', { steps: [stepEv(1, 'X', 1)] }), jobEv(2, 'b', { steps: [stepEv(1, 'Y', 1)] })] });
  assert.equal(analyzeRuns([dup(1), fixed]).redundantJobs.length, 0);
});

test('analyzeRuns: cache heuristics flag slow installs, labeled as suspicion', () => {
  const withCache = run(1, { jobs: [jobEv(1, 'build', { steps: [stepEv(1, 'Restore cache', 2000), stepEv(2, 'npm ci install', 120_000)] })] });
  const noCache = run(2, { jobs: [jobEv(1, 'lint', { steps: [stepEv(1, 'Install dependencies', 90_000)] })] });
  const fast = run(3, { jobs: [jobEv(1, 'fast', { steps: [stepEv(1, 'Install', 5_000)] })] });
  const found = analyzeRuns([withCache, noCache, fast]).cacheMissSuspicions;
  assert.deepEqual(found.map((f) => [f.job, f.kind]), [
    ['build', 'slow-install-with-cache-step'], ['lint', 'slow-install-without-cache-step'],
  ]);
  assert.equal(analyzeRuns([noCache], { slowInstallMs: 100_000 }).cacheMissSuspicions.length, 0);
});

test('compareMetrics: deltas, direction, and null safety', () => {
  const base = analyzeRuns([run(1, { durationMs: 100 }), run(2, { durationMs: 200 })]);
  const slower = analyzeRuns([run(3, { durationMs: 400, conclusion: 'failure' }), run(4, { durationMs: 500 })]);
  const c = compareMetrics(base, slower);
  assert.equal(c.p50DeltaMs, 300);
  assert.equal(c.failureRateDelta, 0.5);
  assert.ok(c.slower && c.moreFailures);
  const better = compareMetrics(slower, base);
  assert.ok(!better.slower && !better.moreFailures);
  const nothing = compareMetrics(analyzeRuns([]), slower);
  assert.equal(nothing.p50DeltaMs, null);
  assert.equal(nothing.slower, false);
});
