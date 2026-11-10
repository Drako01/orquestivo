const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { redactSecrets, redactWithCount, redactLog, safeErrorMessage } = require('../../dist-test/security/redact.js');
const { resolveInside } = require('../../dist-test/security/safe-path.js');
const { readStreamBounded, parseJsonBounded, assertMaxBytes, LimitExceededError } = require('../../dist-test/security/limits.js');

// ------------------------------------------------------------------ redaction
const GH = 'ghp_' + 'a'.repeat(36);
const cases = [
  ['ghp token', `token ${GH} end`, GH],
  ['gho token', 'x gho_' + 'B'.repeat(36), 'gho_'],
  ['fine-grained pat', 'github_pat_' + '1'.repeat(30) + '_abcdef', 'github_pat_'],
  ['aws access key', 'key AKIAIOSFODNN7EXAMPLE here', 'AKIAIOSFODNN7EXAMPLE'],
  ['bearer', 'Authorization: Bearer abcdef123456.token-value', 'abcdef123456'],
  ['basic', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
  ['key=value', 'password=hunter2hunter2', 'hunter2'],
  ['json secret', '{"api_key": "sk_live_12345678"}', 'sk_live_12345678'],
  ['aws secret', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
  ['url userinfo', 'git clone https://user:s3cr3tpass@github.com/o/r', 's3cr3tpass'],
  ['jwt', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpM', 'eyJhbGci'],
];
for (const [name, input, leaked] of cases) {
  test(`redact: ${name}`, () => {
    const out = redactSecrets(input);
    assert.ok(!out.includes(leaked), out);
    assert.ok(out.includes('[REDACTED]'), out);
  });
}

test('redact: private key block, terminated and truncated', () => {
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC';
  const full = `a\n-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\nb`;
  assert.ok(!redactSecrets(full).includes(body));
  assert.ok(redactSecrets(full).endsWith('\nb'));
  const cut = `-----BEGIN PRIVATE KEY-----\n${body}`;
  assert.ok(!redactSecrets(cut).includes(body));
});

test('redact: benign text unchanged and idempotent', () => {
  const text = 'Run npm test on push to main; token count is high';
  assert.equal(redactSecrets(text), text);
  const once = redactSecrets(`password=${'x'.repeat(10)}`);
  assert.equal(redactSecrets(once), once);
  assert.equal(redactWithCount(text).count, 0);
});

test('redact: counts substitutions and tolerates adversarial long input', () => {
  assert.equal(redactWithCount(`${GH} password=abcdefgh`).count, 2);
  const start = Date.now();
  redactSecrets('a'.repeat(200_000) + '=' + 'secret'.repeat(1000));
  redactSecrets('-----BEGIN PRIVATE KEY-----' + 'A'.repeat(200_000));
  assert.ok(Date.now() - start < 2000, 'possible ReDoS');
});

test('redact: log truncation and safe error message', () => {
  assert.ok(redactLog('x'.repeat(50), 10).endsWith('[TRUNCATED]'));
  assert.ok(!safeErrorMessage(new Error(`boom ${GH}`)).includes(GH));
  assert.ok(!safeErrorMessage(`plain ${GH}`).includes(GH));
});

// ------------------------------------------------------------------ safe path
const root = path.resolve('/proj/work');
const outside = path.resolve('/etc');
// Fake filesystem: existing real paths plus symlink map.
const makeRealpath = (links = {}, existing = []) => {
  const known = new Set([root, ...existing.map((p) => path.resolve(p))]);
  const map = new Map(Object.entries(links).map(([k, v]) => [path.resolve(k), path.resolve(v)]));
  return (p) => {
    const resolved = path.resolve(p);
    for (const [from, to] of map) {
      if (resolved === from || resolved.startsWith(from + path.sep)) return to + resolved.slice(from.length);
    }
    if (known.has(resolved)) return resolved;
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
};

test('safe-path: accepts nested existing and not-yet-existing paths', () => {
  const rp = makeRealpath({}, [path.join(root, 'src')]);
  assert.deepEqual(resolveInside(root, 'src', rp), { ok: true, path: path.join(root, 'src') });
  assert.deepEqual(resolveInside(root, 'src/new/file.yml', rp), { ok: true, path: path.join(root, 'src', 'new', 'file.yml') });
  assert.equal(resolveInside(root, '.', rp).ok, true);
});

test('safe-path: rejects traversal and absolute escapes', () => {
  const rp = makeRealpath();
  for (const bad of ['../x', 'a/../../x', '..', outside, path.join(outside, 'passwd')]) {
    assert.deepEqual(resolveInside(root, bad, rp), { ok: false, reason: 'outside-root' }, bad);
  }
  assert.equal(resolveInside(root, path.resolve('/proj/work-evil/a'), rp).ok, false, 'prefix sibling');
});

test('safe-path: rejects null bytes, empty and device paths', () => {
  const rp = makeRealpath();
  assert.equal(resolveInside(root, 'a\0b', rp).reason, 'null-byte');
  assert.equal(resolveInside(root, '', rp).reason, 'invalid');
  assert.equal(resolveInside('', 'a', rp).reason, 'invalid');
  assert.equal(resolveInside(root, '\\\\?\\C:\\x', rp).reason, 'device-path');
  assert.equal(resolveInside(root, '//./pipe/x', rp).reason, 'device-path');
});

test('safe-path: rejects symlinks escaping the root, even for new children', () => {
  const rp = makeRealpath({ [path.join(root, 'link')]: outside }, [outside]);
  assert.deepEqual(resolveInside(root, 'link', rp), { ok: false, reason: 'symlink-escape' });
  assert.deepEqual(resolveInside(root, 'link/new.txt', rp), { ok: false, reason: 'symlink-escape' });
});

test('safe-path: allows symlinks that stay inside the root', () => {
  const target = path.join(root, 'real');
  const rp = makeRealpath({ [path.join(root, 'alias')]: target }, [target]);
  assert.deepEqual(resolveInside(root, 'alias', rp), { ok: true, path: target });
});

test('safe-path: fails closed on non-ENOENT errors and unresolvable root', () => {
  const denied = (p) => {
    if (path.resolve(p) === root) return root;
    const err = new Error('EACCES');
    err.code = 'EACCES';
    throw err;
  };
  assert.equal(resolveInside(root, 'a', denied).reason, 'unresolvable');
  const broken = () => { throw new Error('nope'); };
  assert.equal(resolveInside(root, 'a', broken).reason, 'root-unresolvable');
});

// ------------------------------------------------------------------ limits
async function* chunks(...parts) { for (const p of parts) yield Buffer.from(p); }

test('limits: reads within bound and rejects oversize streams early', async () => {
  assert.equal(await readStreamBounded(chunks('ab', 'cd'), 4), 'abcd');
  await assert.rejects(readStreamBounded(chunks('abc', 'de'), 4), LimitExceededError);
});

test('limits: json bound and byte-length (not char-length) accounting', () => {
  assert.deepEqual(parseJsonBounded('{"a":1}', 100), { a: 1 });
  assert.throws(() => parseJsonBounded('{"a":"' + 'x'.repeat(100) + '"}', 10), LimitExceededError);
  assert.throws(() => assertMaxBytes('ñññ', 5, 'text'), LimitExceededError);
  assert.throws(() => parseJsonBounded('{bad', 100), SyntaxError);
});

// ------------------------------------------------------------------ safe-path on a real file system
test('safe-path: a real symlink or junction pointing outside the root is rejected', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orquestivo-safe-path-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, 'project');
  const elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(path.join(project, '.github'), { recursive: true });
  fs.mkdirSync(elsewhere);
  try {
    fs.symlinkSync(elsewhere, path.join(project, '.github', 'workflows'), 'junction');
  } catch (error) {
    t.skip('cannot create links here: ' + error.code);
    return;
  }
  const escaped = resolveInside(project, '.github/workflows/ci.yml', fs.realpathSync);
  assert.deepEqual(escaped, { ok: false, reason: 'symlink-escape' });
  fs.mkdirSync(path.join(project, 'plain'));
  assert.equal(resolveInside(project, 'plain/ci.yml', fs.realpathSync).ok, true);
});
