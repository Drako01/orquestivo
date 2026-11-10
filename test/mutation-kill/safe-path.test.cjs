const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveInside } = require('../../dist-test/security/safe-path.js');

const root = path.resolve('/proj/work');
const outside = path.resolve('/etc');
const missing = (code) => Object.assign(new Error(code), { code });
/** realpath over a map of symlinks; every other existing path resolves to itself. */
const fakeRealpath = (links = {}, existing = [root]) => (candidate) => {
  const target = links[candidate];
  if (target !== undefined) return target;
  if (existing.includes(candidate)) return candidate;
  throw missing('ENOENT');
};
const rejected = (reason) => ({ ok: false, reason });

test('every rejection returns ok:false with the precise reason', () => {
  const rp = fakeRealpath();
  assert.deepEqual(resolveInside('', 'a', rp), rejected('invalid'));
  assert.deepEqual(resolveInside(root, '', rp), rejected('invalid'));
  assert.deepEqual(resolveInside(root, 'a\0b', rp), rejected('null-byte'));
  assert.deepEqual(resolveInside('/pr\0oj', 'a', rp), rejected('null-byte'));
  assert.deepEqual(resolveInside(root, '//?/C:/Windows', rp), rejected('device-path'));
  assert.deepEqual(resolveInside(root, '../x', rp), rejected('outside-root'));
  assert.deepEqual(resolveInside(root, 'x', () => { throw missing('ENOENT'); }), rejected('root-unresolvable'));
  assert.deepEqual(resolveInside(root, 'a/b', fakeRealpath({}, [])), rejected('root-unresolvable'));
});

test('non-string arguments are invalid rather than thrown', () => {
  const rp = fakeRealpath();
  assert.deepEqual(resolveInside(undefined, 'a', rp), rejected('invalid'));
  assert.deepEqual(resolveInside(root, 5, rp), rejected('invalid'));
});

test('a symlink resolving outside the root is a symlink-escape, an inside one is accepted', () => {
  const link = path.join(root, 'link');
  assert.deepEqual(resolveInside(root, 'link/ci.yml', fakeRealpath({ [link]: outside })), rejected('symlink-escape'));
  const inside = path.join(root, 'real');
  const ok = resolveInside(root, 'link/ci.yml', fakeRealpath({ [link]: inside }, [root, inside]));
  assert.deepEqual(ok, { ok: true, path: path.join(inside, 'ci.yml') });
});

test('errors other than "missing" fail closed; ENOTDIR counts as missing', () => {
  const denied = (candidate) => { if (candidate === root) return root; throw missing('EACCES'); };
  assert.deepEqual(resolveInside(root, 'a/b', denied), rejected('unresolvable'));
  const notDir = (candidate) => { if (candidate === root) return root; throw missing('ENOTDIR'); };
  assert.deepEqual(resolveInside(root, 'a/b', notDir), { ok: true, path: path.join(root, 'a', 'b') });
});
