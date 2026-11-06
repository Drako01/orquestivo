const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, aggregateResults } = require('../../dist-test/core/evidence/verdict.js');

test('aggregate: empty is INCONCLUSIVE, never PASS', () => {
  assert.equal(aggregate([]), 'INCONCLUSIVE');
});

test('aggregate: PASS only when every verdict is PASS', () => {
  assert.equal(aggregate(['PASS', 'PASS']), 'PASS');
  for (const other of ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'WARN', 'SKIP']) {
    assert.notEqual(aggregate(['PASS', 'PASS', other]), 'PASS', other);
    assert.equal(aggregate(['PASS', other]), other);
  }
});

test('aggregate: precedence FAIL > BLOCKED > INCONCLUSIVE > WARN > SKIP > PASS in any order', () => {
  const order = ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'WARN', 'SKIP', 'PASS'];
  for (let i = 0; i < order.length; i += 1) {
    const rest = order.slice(i);
    assert.equal(aggregate([...rest].reverse()), order[i]);
    assert.equal(aggregate(rest), order[i]);
  }
});

test('aggregate: all SKIP stays SKIP (not success)', () => {
  assert.equal(aggregate(['SKIP', 'SKIP']), 'SKIP');
});

test('aggregateResults maps over check results', () => {
  const r = (verdict) => ({ id: 'x', verdict, basis: 'static-inference', message: '', evidence: [] });
  assert.equal(aggregateResults([r('PASS'), r('WARN')]), 'WARN');
});
