const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWebviewMessage } = require('../../dist-test/ui/messages.js');

// Boundary and shape cases that pin every comparison in parseWebviewMessage.
const MAX_INDEX = 100_000;
const MAX_LINE = 10_000_000;

test('openLocation: index and line bounds are inclusive', () => {
  assert.ok(parseWebviewMessage({ type: 'openLocation', file: 0, line: 1 }));
  assert.ok(parseWebviewMessage({ type: 'openLocation', file: MAX_INDEX, line: MAX_LINE }));
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: -1, line: 1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: MAX_INDEX + 1, line: 1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: 0, line: 0 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: 0, line: MAX_LINE + 1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: 1.5, line: 1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'openLocation', file: '1', line: 1 }), undefined);
});

test('explainFinding: bounds are inclusive and both fields are required', () => {
  assert.ok(parseWebviewMessage({ type: 'explainFinding', file: 0, index: 0 }));
  assert.ok(parseWebviewMessage({ type: 'explainFinding', file: MAX_INDEX, index: MAX_INDEX }));
  assert.equal(parseWebviewMessage({ type: 'explainFinding', file: 0, index: MAX_INDEX + 1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'explainFinding', file: 0, index: -1 }), undefined);
  assert.equal(parseWebviewMessage({ type: 'explainFinding', file: 0 }), undefined);
});

test('extra, missing and inherited keys are rejected for every message type', () => {
  const valid = [
    { type: 'openLocation', file: 1, line: 1 }, { type: 'clearFilters' }, { type: 'setLevel', level: 'expert' },
    { type: 'command', command: 'analyze' }, { type: 'toggleFilter', dimension: 'severity', value: 'error' },
  ];
  for (const message of valid) {
    assert.ok(parseWebviewMessage(message), message.type);
    assert.equal(parseWebviewMessage({ ...message, extra: 1 }), undefined, message.type + ' with an extra key');
  }
  assert.equal(parseWebviewMessage({ type: 'command' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'command', command: 'rm -rf' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'toggleFilter', dimension: 'severity', value: 'category' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'toggleFilter', dimension: 'other', value: 'error' }), undefined);
  assert.equal(parseWebviewMessage(null), undefined);
  assert.equal(parseWebviewMessage([]), undefined);
  assert.equal(parseWebviewMessage({ type: 42 }), undefined);
  assert.equal(parseWebviewMessage({ type: '__proto__' }), undefined);
});

test('toggleFilter: the value must belong to the declared dimension', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'toggleFilter', dimension: 'category', value: 'security' }),
    { type: 'toggleFilter', dimension: 'category', value: 'security' });
  assert.equal(parseWebviewMessage({ type: 'toggleFilter', dimension: 'category', value: 'error' }), undefined);
  assert.equal(parseWebviewMessage({ type: 'toggleFilter', dimension: 'category', value: 7 }), undefined);
});
