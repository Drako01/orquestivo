const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, aggregateResults } = require('../../dist-test/core/evidence/verdict.js');

test('aggregate: unknown verdict values fall back to INCONCLUSIVE, never PASS', () => {
  assert.equal(aggregate(['BOGUS']), 'INCONCLUSIVE');
  assert.equal(aggregate(['nonsense', 'other']), 'INCONCLUSIVE');
});

test('aggregate: every verdict wins against every strictly better one (pairwise)', () => {
  const order = ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'WARN', 'SKIP', 'PASS'];
  for (let i = 0; i < order.length; i++) {
    for (let j = i; j < order.length; j++) {
      assert.equal(aggregate([order[j], order[i]]), order[i]);
      assert.equal(aggregate([order[i], order[j]]), order[i]);
    }
  }
});

test('aggregate: single verdicts are returned as-is and duplicates do not change the result', () => {
  for (const v of ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'WARN', 'SKIP', 'PASS']) {
    assert.equal(aggregate([v]), v);
    assert.equal(aggregate([v, v, v]), v);
  }
});

test('aggregateResults uses each result verdict and empty is INCONCLUSIVE', () => {
  const r = (verdict) => ({ id: verdict, verdict, basis: 'static-inference', message: '', evidence: [] });
  assert.equal(aggregateResults([]), 'INCONCLUSIVE');
  assert.equal(aggregateResults([r('PASS'), r('WARN')]), 'WARN');
  assert.equal(aggregateResults([r('PASS'), r('PASS')]), 'PASS');
});
