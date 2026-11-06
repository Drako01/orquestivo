const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LimitExceededError, assertMaxBytes, readStreamBounded, parseJsonBounded, truncateText,
} = require('../../dist-test/security/limits.js');

async function* chunks(count, size, onYield) {
  for (let i = 0; i < count; i++) {
    onYield?.(i);
    yield new Uint8Array(size).fill(97);
  }
}

test('assertMaxBytes counts UTF-8 bytes at the exact boundary', () => {
  assertMaxBytes('abcd', 4, 'x');
  assert.throws(() => assertMaxBytes('abcde', 4, 'x'), LimitExceededError);
  assert.throws(() => assertMaxBytes('ééé', 5, 'x'), (e) => e instanceof LimitExceededError && e.limit === 5 && e.what === 'x' && /5 bytes/.test(e.message));
  assertMaxBytes('éé', 4, 'x');
});

test('readStreamBounded stops pulling from an unbounded stream once the limit is crossed', async () => {
  let pulled = 0;
  await assert.rejects(readStreamBounded(chunks(1_000_000, 1024, () => { pulled++; }), 4096, 'logs'),
    (e) => e instanceof LimitExceededError && e.what === 'logs');
  assert.ok(pulled <= 6, `pulled ${pulled} chunks`);
});

test('readStreamBounded accepts exactly maxBytes and rejects one more', async () => {
  assert.equal((await readStreamBounded(chunks(2, 5), 10)).length, 10);
  await assert.rejects(readStreamBounded(chunks(2, 5), 9), LimitExceededError);
});

test('readStreamBounded propagates source errors (cancellation) instead of swallowing them', async () => {
  async function* failing() { yield new Uint8Array(1); throw new Error('aborted'); }
  await assert.rejects(readStreamBounded(failing(), 100), /aborted/);
  const controller = new AbortController();
  async function* abortable() { for (;;) { controller.signal.throwIfAborted(); yield new Uint8Array(1); controller.abort(new Error('cancelled')); } }
  await assert.rejects(readStreamBounded(abortable(), 1_000_000), /cancelled/);
});

test('parseJsonBounded checks size before parsing and returns parsed data', () => {
  assert.deepEqual(parseJsonBounded('{"a":1}', 7), { a: 1 });
  assert.throws(() => parseJsonBounded('{"a":1}', 6), LimitExceededError);
  assert.throws(() => parseJsonBounded('{bad', 100), SyntaxError);
});

test('truncateText is exact at the boundary', () => {
  assert.equal(truncateText('abc', 3), 'abc');
  assert.equal(truncateText('abcd', 3), 'abc');
});
