const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWritePlan } = require('../../dist-test/core/generation/write-plan.js');

const kinds = (before, after) => createWritePlan(before, after, 'x.yml').diff.map((l) => (l.kind === 'context' ? ' ' : l.kind === 'add' ? '+' : '-') + l.text);

test('diff keeps the longest common subsequence as context', () => {
  assert.deepEqual(kinds('a\nb\nc\nd\n', 'b\nd\na\n'), ['-a', ' b', '-c', ' d', '+a']);
  assert.deepEqual(kinds('a\nb\nc\n', 'a\nx\nc\n'), [' a', '-b', '+x', ' c']);
  assert.deepEqual(kinds('1\n2\n3\n4\n5\n', '2\n4\n'), ['-1', ' 2', '-3', ' 4', '-5']);
  assert.deepEqual(kinds('a\nb\n', 'b\na\n'), ['-a', ' b', '+a']);
});

test('diff handles empty sides and the unified header counts', () => {
  assert.deepEqual(kinds(undefined, 'a\nb\n'), ['+a', '+b']);
  assert.deepEqual(kinds('a\nb\n', ''), ['-a', '-b']);
  const plan = createWritePlan('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nd\nX\nf\ng\nh\n', 'x.yml');
  assert.match(plan.unifiedDiff, /@@ -2,7 \+2,7 @@/);
});
