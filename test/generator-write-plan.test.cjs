const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWritePlan, planWrite, createRollback, authorizeWrite, WriteRefusedError, DEFAULT_WORKFLOW_PATH,
} = require('../dist-test/core/generator.js');

test('new file: create, no confirmation, rollback deletes it', () => {
  const plan = createWritePlan(undefined, 'a\nb\n');
  assert.equal(plan.action, 'create');
  assert.equal(plan.path, DEFAULT_WORKFLOW_PATH);
  assert.equal(plan.requiresConfirmation, false);
  assert.ok(plan.unifiedDiff.startsWith('--- /dev/null\n+++ b/' + DEFAULT_WORKFLOW_PATH));
  assert.ok(plan.unifiedDiff.includes('@@ -0,0 +1,2 @@\n+a\n+b\n'));
  assert.deepEqual(createRollback(plan), { kind: 'delete-file', path: DEFAULT_WORKFLOW_PATH });
  assert.equal(planWrite, createWritePlan);
});

test('identical content (even CRLF) is unchanged and writes nothing', () => {
  const plan = createWritePlan('a\r\nb\r\n', 'a\nb\n');
  assert.equal(plan.action, 'unchanged');
  assert.equal(plan.unifiedDiff, '');
  const authorized = authorizeWrite(plan);
  assert.equal(authorized.write, undefined);
  assert.deepEqual(authorized.rollback, { kind: 'none' });
});

test('overwrite is refused unless explicitly confirmed', () => {
  const plan = createWritePlan('a\nold\nc\n', 'a\nnew\nc\n', 'ci.yml');
  assert.equal(plan.action, 'overwrite');
  assert.equal(plan.requiresConfirmation, true);
  assert.throws(() => authorizeWrite(plan), WriteRefusedError);
  assert.throws(() => authorizeWrite(plan, { confirmOverwrite: false }), WriteRefusedError);
  const ok = authorizeWrite(plan, { confirmOverwrite: true });
  assert.deepEqual(ok.write, { kind: 'write-file', path: 'ci.yml', content: 'a\nnew\nc\n' });
  assert.deepEqual(ok.rollback, { kind: 'restore-content', path: 'ci.yml', content: 'a\nold\nc\n' });
});

test('unified diff has correct hunk ranges and context', () => {
  const before = Array.from({ length: 12 }, (_, i) => 'l' + (i + 1)).join('\n') + '\n';
  const after = before.replace('l6\n', 'six\n');
  const plan = createWritePlan(before, after, 'f');
  assert.equal(plan.unifiedDiff, [
    '--- a/f', '+++ b/f', '@@ -3,7 +3,7 @@',
    ' l3', ' l4', ' l5', '-l6', '+six', ' l7', ' l8', ' l9', '',
  ].join('\n'));
  assert.deepEqual(plan.diff.filter((l) => l.kind !== 'context'), [
    { kind: 'remove', text: 'l6' }, { kind: 'add', text: 'six' },
  ]);
});

test('distant changes produce separate hunks', () => {
  const before = Array.from({ length: 30 }, (_, i) => 'l' + (i + 1)).join('\n') + '\n';
  const after = before.replace('l2\n', 'x\n').replace('l28\n', 'y\n');
  assert.equal((createWritePlan(before, after).unifiedDiff.match(/^@@/gm) ?? []).length, 2);
});
