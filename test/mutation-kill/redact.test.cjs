const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets, redactWithCount, redactLog, safeErrorMessage, REDACTED } = require('../../dist-test/security/redact.js');

const TOKEN = 'ghp_' + 'a'.repeat(36);

test('count equals substitutions; clean text has count 0', () => {
  assert.deepEqual(redactWithCount('nothing here'), { text: 'nothing here', count: 0 });
  const r = redactWithCount(`a ${TOKEN} b ${TOKEN}`);
  assert.equal(r.count, 2);
  assert.equal(r.text, `a ${REDACTED} b ${REDACTED}`);
});

test('token length boundaries: 19 chars are kept, 20 are redacted', () => {
  assert.equal(redactSecrets('ghp_' + 'a'.repeat(19)), 'ghp_' + 'a'.repeat(19));
  assert.equal(redactSecrets('ghp_' + 'a'.repeat(20)), REDACTED);
  assert.equal(redactSecrets('github_pat_' + 'a'.repeat(19)), 'github_pat_' + 'a'.repeat(19));
  assert.equal(redactSecrets('github_pat_' + 'a'.repeat(20)), REDACTED);
});

test('aws key must be exactly 16 chars after prefix', () => {
  assert.equal(redactSecrets('AKIA' + 'A'.repeat(16)), REDACTED);
  assert.equal(redactSecrets('AKIA' + 'A'.repeat(15)), 'AKIA' + 'A'.repeat(15));
});

test('bearer/basic keep the scheme and whitespace; min 8 chars', () => {
  assert.equal(redactSecrets('Bearer abcdefgh'), `Bearer ${REDACTED}`);
  assert.equal(redactSecrets('bearer   abcdefgh'), `bearer   ${REDACTED}`);
  assert.equal(redactSecrets('Basic abcdefg'), 'Basic abcdefg');
});

test('url userinfo keeps user and host, hides only the password', () => {
  assert.equal(redactSecrets('https://bob:pw123456@host.io/x'), `https://bob:${REDACTED}@host.io/x`);
  assert.equal(redactSecrets('https://host.io/x'), 'https://host.io/x');
});

test('key=value keeps the key, hides value (min 4 chars), is idempotent', () => {
  assert.equal(redactSecrets('password=hunter22'), `password=${REDACTED}`);
  assert.equal(redactSecrets('token: abc'), 'token: abc');
  assert.equal(redactSecrets('{"api_key": "sk_live_1234"}'), `{"api_key": "${REDACTED}"}`);
  const once = redactSecrets('secret=abcdefgh');
  assert.equal(redactSecrets(once), once);
  assert.equal(redactWithCount(once).count, 0);
});

test('private key: terminated block keeps surroundings, unterminated eats the rest', () => {
  const out = redactSecrets('x\n-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\ny');
  assert.equal(out, `x\n${REDACTED}_PRIVATE_KEY\ny`);
  assert.equal(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nAAA\nBBB'), `${REDACTED}_PRIVATE_KEY`);
});

test('jwt is redacted entirely', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpM';
  assert.equal(redactSecrets(jwt), REDACTED);
});

test('redactLog truncates exactly past maxChars and marks it', () => {
  assert.equal(redactLog('abcde', 5), 'abcde');
  assert.equal(redactLog('abcdef', 5), 'abcde\n[TRUNCATED]');
  assert.equal(redactLog('x'.repeat(100_000)).length, 100_000);
  assert.ok(redactLog('x'.repeat(100_001)).endsWith('[TRUNCATED]'));
  assert.ok(!redactLog(TOKEN, 100).includes('ghp_'));
});

test('safeErrorMessage handles Error and non-Error values and redacts', () => {
  assert.equal(safeErrorMessage(new Error(`bad ${TOKEN}`)), `bad ${REDACTED}`);
  assert.equal(safeErrorMessage('plain'), 'plain');
  assert.equal(safeErrorMessage(42), '42');
});
