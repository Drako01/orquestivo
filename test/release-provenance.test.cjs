const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = () => import('../scripts/release-provenance.mjs');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sha = (x) => x.repeat(40);
const pr = { number: 4, state: 'closed', merged_at: '2026-11-10T19:00:00Z',
  merge_commit_sha: sha('a'), head: { sha: sha('b') },
  base: { ref: 'main', repo: { full_name: 'Drako01/orquestivo' } } };
const run = { id: 123, status: 'completed', conclusion: 'success', event: 'pull_request',
  path: '.github/workflows/ci.yml', head_sha: sha('b'), head_repository: { full_name: 'Drako01/orquestivo' },
  pull_requests: [{ number: 4 }], created_at: '2026-11-10T18:00:00Z' };

test('release: only actual merged PR and successful pre-merge exact-head CI qualify', async () => {
  const { selectMergedPr, selectSuccessfulRun } = await load();
  assert.equal(selectMergedPr([pr], sha('a')).number, 4);
  assert.equal(selectSuccessfulRun([run], pr).id, 123);
  // Real GitHub Actions behavior after closing PR #4: pull_requests becomes [].
  // That does not invalidate the successful exact-head run (run #42871117473).
  assert.equal(selectSuccessfulRun([{ ...run, pull_requests: [] }], pr).id, 123);
  for (const change of [
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { event: 'push' },
    { head_sha: sha('c') }, { path: '.github/workflows/publish.yml' },
    { pull_requests: [{ number: 99 }] }, { pull_requests: undefined },
    { created_at: '2026-11-10T20:00:00Z' },
  ]) assert.throws(() => selectSuccessfulRun([{ ...run, ...change }], pr));
  assert.throws(() => selectMergedPr([{ ...pr, base: { ref: 'develop' } }], sha('a')));
  assert.throws(() => selectMergedPr([{ ...pr, merge_commit_sha: sha('c') }], sha('a')));
  assert.throws(() => selectSuccessfulRun([{ ...run, head_repository: { full_name: 'someone/else' } }], pr));
});

test('release: provenance fails closed on altered repository, SHA, tree, version or run', async () => {
  const { SCHEMA, validateManifest } = await load();
  const expected = { repository: 'Drako01/orquestivo', prNumber: 4, runId: 123,
    headSha: sha('b'), treeSha: sha('c'), version: '0.2.0', sha256: 'd'.repeat(64) };
  assert.equal(validateManifest({ schema: SCHEMA, ...expected }, expected), true);
  for (const key of Object.keys(expected))
    assert.throws(() => validateManifest({ schema: SCHEMA, ...expected, [key]: 'different' }, expected), key);
  assert.throws(() => validateManifest({ schema: 'invalid', ...expected }, expected));
});

test('release: CI only on PR; main publication reuses preview VSIX, never reruns tests', () => {
  const ci = read('.github/workflows/ci.yml'), publish = read('.github/workflows/publish.yml');
  assert.match(ci, /on:\s*\n\s+pull_request:\s*\n\s+branches: \[main\]/);
  assert.doesNotMatch(ci.split('permissions:')[0], /push:/);
  assert.match(ci, /node scripts\/release-provenance.mjs stamp/);
  assert.match(ci, /reports\/pr-preview-provenance.json/);
  assert.match(publish, /node scripts\/release-provenance.mjs resolve/);
  assert.match(publish, /node scripts\/release-provenance.mjs verify/);
  assert.match(publish, /name: orquestivo-preview-vsix/);
  assert.doesNotMatch(publish, /verify:release|verify:platform|verify:enterprise|vsce package|npm run build/);
  assert.doesNotMatch(publish, /^  verify-platforms:/m);
  assert.match(publish, /node scripts\/vsix-checksum.mjs check orquestivo.vsix/);
});
