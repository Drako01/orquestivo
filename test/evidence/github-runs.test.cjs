const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubRunsClient, GitHubRunsError, loadRemoteContext } = require('../../dist-test/core/evidence/github-runs.js');

const TOKEN = 'ghp_' + 'z'.repeat(36);
const repo = { owner: 'o', repo: 'r' };
const tokens = (value = TOKEN) => ({ getToken: async () => value });

const res = (status, body, headers = {}) => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const runJson = (id, extra = {}) => ({
  id, name: 'CI', head_branch: 'main', head_sha: 'abc', event: 'push', status: 'completed', conclusion: 'success',
  created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-01-01T00:00:10Z', updated_at: '2026-01-01T00:01:10Z',
  html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra,
});

/** Scripted fetch: each call shifts the next response (function or value); records requests. */
function scripted(...script) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = script.length > 1 ? script.shift() : script[0];
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { fetch, calls };
}
const make = (fetch, extra = {}) => {
  const sleeps = [];
  const client = new GitHubRunsClient({
    fetch, tokens: tokens(), sleep: async (ms) => { sleeps.push(ms); }, backoffBaseMs: 10, ...extra,
  });
  return { client, sleeps };
};

test('lists runs, normalizes fields, sends auth header, never downloads logs', async () => {
  const { fetch, calls } = scripted(res(200, { total_count: 1, workflow_runs: [runJson(7)] }));
  const { client } = make(fetch);
  const out = await client.listWorkflowRuns(repo, { branch: 'main', status: 'completed' });
  assert.equal(out.items.length, 1);
  const r = out.items[0];
  assert.equal(r.runId, 7);
  assert.equal(r.durationMs, 60_000);
  assert.equal(r.logsUrl, 'https://api.github.com/repos/o/r/actions/runs/7/logs');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(calls[0].url, /\/repos\/o\/r\/actions\/runs\?branch=main&status=completed&per_page=30&page=1$/);
  assert.ok(!calls.some((c) => c.url.endsWith('/logs')));
});

test('run evidence: aggregates run, jobs with steps and artifacts', async () => {
  const jobs = { jobs: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:30Z', html_url: 'u', steps: [{ number: 1, name: 'Install', status: 'completed', conclusion: 'success', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:05Z' }] }] };
  const artifacts = { artifacts: [{ id: 9, name: 'dist', size_in_bytes: 10, expired: false }] };
  const { fetch } = scripted((url) => res(200, url.includes('/jobs') ? jobs : url.includes('/artifacts') ? artifacts : runJson(7)));
  const ev = await make(fetch).client.getRunEvidence(repo, 7);
  assert.equal(ev.jobs[0].durationMs, 30_000);
  assert.equal(ev.jobs[0].steps[0].durationMs, 5_000);
  assert.deepEqual(ev.artifacts, [{ id: 9, name: 'dist', sizeBytes: 10, expired: false }]);
});

test('input validation: path injection in owner/repo/workflow/filters is rejected', async () => {
  const { fetch, calls } = scripted(res(200, {}));
  const { client } = make(fetch);
  await assert.rejects(client.listWorkflowRuns({ owner: '../x', repo: 'r' }), { code: 'invalid-input' });
  await assert.rejects(client.listWorkflowRuns({ owner: 'o', repo: 'r/evil' }), { code: 'invalid-input' });
  await assert.rejects(client.listWorkflowRuns(repo, { workflowFile: '../../x' }), { code: 'invalid-input' });
  await assert.rejects(client.listWorkflowRuns(repo, { status: 'a&b=c' }), { code: 'invalid-input' });
  await assert.rejects(client.getRunJobs(repo, -1), { code: 'invalid-input' });
  await assert.rejects(client.getRunJobs(repo, 1.5), { code: 'invalid-input' });
  assert.equal(calls.length, 0);
  assert.throws(() => new GitHubRunsClient({ fetch, tokens: tokens(), baseUrl: 'http://api.github.com' }), { code: 'invalid-input' });
});

test('missing token fails with auth without calling the network', async () => {
  const { fetch, calls } = scripted(res(200, {}));
  const client = new GitHubRunsClient({ fetch, tokens: { getToken: async () => undefined } });
  await assert.rejects(client.listWorkflowRuns(repo), { code: 'auth' });
  assert.equal(calls.length, 0);
});

test('maps HTTP errors and never leaks the token', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [404, 'not-found'], [418, 'http']]) {
    const { fetch } = scripted(res(status, `LEAKBODY ${TOKEN}`));
    const err = await make(fetch).client.listWorkflowRuns(repo).catch((e) => e);
    assert.ok(err instanceof GitHubRunsError);
    assert.equal(err.code, code);
    assert.ok(!err.message.includes(TOKEN) && !err.message.includes('LEAKBODY'));
  }
});

test('network errors: message sanitized, retries bounded', async () => {
  const { fetch, calls } = scripted(async () => { throw new Error(`socket hang up ${TOKEN}`); });
  const { client, sleeps } = make(fetch, { maxRetries: 2 });
  const err = await client.listWorkflowRuns(repo).catch((e) => e);
  assert.equal(err.code, 'network');
  assert.ok(!err.message.includes(TOKEN));
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test('retries 5xx with exponential backoff then succeeds', async () => {
  const { fetch, calls } = scripted(res(503, ''), res(502, ''), res(200, { workflow_runs: [] }));
  const { client, sleeps } = make(fetch);
  const out = await client.listWorkflowRuns(repo);
  assert.equal(out.items.length, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test('5xx beyond the retry bound fails with http', async () => {
  const { fetch, calls } = scripted(res(500, ''));
  const err = await make(fetch, { maxRetries: 1 }).client.listWorkflowRuns(repo).catch((e) => e);
  assert.equal(err.code, 'http');
  assert.equal(calls.length, 2);
});

test('rate limit: honors retry-after (seconds)', async () => {
  const { fetch, calls } = scripted(res(429, '', { 'retry-after': '2' }), res(200, { workflow_runs: [] }));
  const { client, sleeps } = make(fetch);
  await client.listWorkflowRuns(repo);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.length, 2);
});

test('rate limit: honors x-ratelimit-reset on 403 with remaining 0', async () => {
  const now = 1_000_000_000_000;
  const reset = String(now / 1000 + 5);
  const { fetch } = scripted(res(403, '', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), res(200, { workflow_runs: [] }));
  const { client, sleeps } = make(fetch, { now: () => now });
  await client.listWorkflowRuns(repo);
  assert.deepEqual(sleeps, [5000]);
});

test('rate limit: wait beyond the cap fails fast as rate-limited (no sleep)', async () => {
  const { fetch } = scripted(res(429, '', { 'retry-after': '3600' }));
  const { client, sleeps } = make(fetch);
  await assert.rejects(client.listWorkflowRuns(repo), { code: 'rate-limited' });
  assert.deepEqual(sleeps, []);
});

test('rate limit: repeated limiting is bounded by maxRetries', async () => {
  const { fetch, calls } = scripted(res(429, '', { 'retry-after': '1' }));
  await assert.rejects(make(fetch, { maxRetries: 2 }).client.listWorkflowRuns(repo), { code: 'rate-limited' });
  assert.equal(calls.length, 3);
});

test('rate limit: a plain 403 without limit headers is auth, not rate-limited', async () => {
  const { fetch } = scripted(res(403, ''));
  await assert.rejects(make(fetch).client.listWorkflowRuns(repo), { code: 'auth' });
});

test('rate limit: remaining=0 on success makes the next call wait until reset', async () => {
  const now = 2_000_000_000_000;
  const reset = String(now / 1000 + 3);
  const { fetch } = scripted(res(200, { workflow_runs: [] }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }));
  const { client, sleeps } = make(fetch, { now: () => now });
  await client.listWorkflowRuns(repo);
  await client.listWorkflowRuns(repo);
  assert.deepEqual(sleeps, [3000]);
});

test('timeout: aborts a hanging fetch and reports timeout', async () => {
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const { fetch } = scripted(hang);
  const err = await make(fetch, { timeoutMs: 20, maxRetries: 0 }).client.listWorkflowRuns(repo).catch((e) => e);
  assert.equal(err.code, 'timeout');
});

test('cancellation: caller abort wins and is reported as aborted', async () => {
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const { fetch, calls } = scripted(hang);
  const controller = new AbortController();
  const pending = make(fetch).client.listWorkflowRuns(repo, {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal(calls.length, 1);
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(make(fetch).client.listWorkflowRuns(repo, {}, { signal: pre.signal }), { code: 'aborted' });
});

test('response validation: malformed shapes fail as invalid-response', async () => {
  const bad = [
    'not json',
    JSON.stringify([]),
    JSON.stringify({ workflow_runs: 'x' }),
    JSON.stringify({ workflow_runs: [null] }),
    JSON.stringify({ workflow_runs: [{ ...runJson(1), id: '1' }] }),
    JSON.stringify({ workflow_runs: [{ ...runJson(1), id: -4 }] }),
    JSON.stringify({ workflow_runs: [{ ...runJson(1), html_url: 7 }] }),
  ];
  for (const body of bad) {
    const { fetch } = scripted(res(200, body));
    await assert.rejects(make(fetch).client.listWorkflowRuns(repo), { code: 'invalid-response' }, body);
  }
});

test('response validation: unknown extra fields are ignored; bad dates yield null durations', async () => {
  const { fetch } = scripted(res(200, { workflow_runs: [{ ...runJson(1, { updated_at: 'garbage' }), extra: { evil: true }, __proto__x: 1 }] }));
  const out = await make(fetch).client.listWorkflowRuns(repo);
  assert.equal(out.items[0].durationMs, null);
});

test('response size is bounded', async () => {
  const { fetch } = scripted(res(200, JSON.stringify({ workflow_runs: [], pad: 'x'.repeat(5000) })));
  await assert.rejects(make(fetch, { maxResponseBytes: 1000 }).client.listWorkflowRuns(repo), { code: 'too-large' });
});

test('streamed bodies are bounded while reading', async () => {
  async function* body() { yield Buffer.from('{"workflow_runs":['); yield Buffer.from('x'.repeat(5000)); }
  const streamed = { status: 200, headers: { get: () => null }, text: async () => { throw new Error('should stream'); }, body: body() };
  const { fetch } = scripted(streamed);
  await assert.rejects(make(fetch, { maxResponseBytes: 1000 }).client.listWorkflowRuns(repo), { code: 'too-large' });
});

test('pagination: follows pages up to the bound and reports truncation', async () => {
  const page = (n) => Array.from({ length: 2 }, (_, i) => runJson(n * 10 + i));
  const { fetch, calls } = scripted(
    res(200, { workflow_runs: page(1) }), res(200, { workflow_runs: page(2) }), res(200, { workflow_runs: page(3) }),
  );
  const out = await make(fetch, { perPage: 2, maxPages: 2 }).client.listWorkflowRuns(repo, {}, { limit: 100 });
  assert.equal(calls.length, 2);
  assert.equal(out.items.length, 4);
  assert.equal(out.truncated, true);
});

test('pagination: stops on a short page and honors limit', async () => {
  const { fetch, calls } = scripted(res(200, { workflow_runs: [runJson(1), runJson(2)] }), res(200, { workflow_runs: [runJson(3)] }));
  const full = await make(fetch, { perPage: 2 }).client.listWorkflowRuns(repo, {}, { limit: 100 });
  assert.equal(full.items.length, 3);
  assert.equal(full.truncated, false);
  assert.equal(calls.length, 2);
  const s2 = scripted(res(200, { workflow_runs: [runJson(1), runJson(2)] }));
  const limited = await make(s2.fetch, { perPage: 2 }).client.listWorkflowRuns(repo, {}, { limit: 1 });
  assert.equal(limited.items.length, 1);
  assert.equal(limited.truncated, true);
});

test('collectRunEvidence respects limit', async () => {
  const { fetch } = scripted((url) => res(200, url.includes('/jobs') ? { jobs: [] } : url.includes('/artifacts') ? { artifacts: [] } : { workflow_runs: [runJson(1), runJson(2), runJson(3)] }));
  const out = await make(fetch).client.collectRunEvidence(repo, {}, { limit: 2 });
  assert.deepEqual(out.items.map((r) => r.runId), [1, 2]);
});

test('loadRemoteContext: connector failure becomes unavailable (redacted), programming errors propagate', async () => {
  const { fetch } = scripted(res(401, ''));
  const { client } = make(fetch);
  const ctx = await loadRemoteContext(async () => (await client.collectRunEvidence(repo)).items);
  assert.equal(ctx.status, 'unavailable');
  assert.match(ctx.reason, /^auth:/);
  const ok = await loadRemoteContext(async () => []);
  assert.deepEqual(ok, { status: 'available', runs: [] });
  await assert.rejects(loadRemoteContext(async () => { throw new TypeError('bug'); }), TypeError);
});
