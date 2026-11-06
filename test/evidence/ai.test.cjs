const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AI_DISABLED, grantConsent, hasConsent, buildDisclosure, disclosureToRequest } = require('../../dist-test/ai/consent.js');
const { claimsExecutionSuccess, guardAiText, hasSuccessEvidence } = require('../../dist-test/ai/guard.js');
const { requestSuggestions, parseAiSuggestion } = require('../../dist-test/ai/suggest.js');
const { run } = require('./helpers.cjs');

const SECRET = 'ghp_' + 'q'.repeat(36);
const consent = grantConsent('fake', new Date('2026-01-01T00:00:00Z'));
const okValidator = () => ({ ok: true });
const providerReturning = (value) => {
  const seen = [];
  return { id: 'fake', seen, suggest: async (req) => { seen.push(req); return typeof value === 'function' ? value() : value; } };
};

// ------------------------------------------------------------------ consent & disclosure
test('consent: disabled by default, per-provider, explicit', () => {
  assert.equal(AI_DISABLED.enabled, false);
  assert.equal(hasConsent(AI_DISABLED, 'fake'), false);
  assert.equal(hasConsent(consent, 'fake'), true);
  assert.equal(hasConsent(consent, 'other'), false);
  assert.equal(consent.grantedAt, '2026-01-01T00:00:00.000Z');
  assert.throws(() => grantConsent(' ', new Date()));
});

test('disclosure: lists exactly what is sent, post-redaction, and the request equals it', () => {
  const d = buildDisclosure({ purpose: 'explain', items: [{ label: 'workflow', text: `run: curl -H "Authorization: Bearer abcdefgh1234" ${SECRET}` }, { label: 'note', text: 'plain' }] });
  assert.equal(d.redactionCount, 2);
  assert.ok(!JSON.stringify(d).includes(SECRET));
  assert.ok(!JSON.stringify(d).includes('abcdefgh1234'));
  assert.equal(d.items[1].bytes, 5);
  assert.equal(d.totalBytes, d.items[0].bytes + 5);
  const req = disclosureToRequest(d);
  assert.deepEqual(req.items, d.items.map((i) => ({ label: i.label, text: i.text })));
});

// ------------------------------------------------------------------ guard
const claims = [
  'The pipeline will pass now.', 'This should work.', 'All tests pass.', 'The build succeeds.', 'It is fixed.',
  'Verified to be correct.', 'Everything is green.', 'Runs successfully.', 'No errors remain.',
  'Esto funciona.', 'El pipeline pasará.', 'Quedó verificado.', 'Sin errores.',
];
for (const sentence of claims) {
  test(`guard: flags success claim "${sentence}"`, () => assert.equal(claimsExecutionSuccess(sentence), true));
}
for (const sentence of ['Pin the action to a commit SHA.', 'Set the working directory to src.', 'Consider adding a timeout to the job.']) {
  test(`guard: leaves neutral advice "${sentence}"`, () => assert.equal(claimsExecutionSuccess(sentence), false));
}

test('guard: strips only claim sentences without remote evidence', () => {
  const g = guardAiText('Pin the action to a SHA. This will pass in CI. Add a timeout.');
  assert.equal(g.blocked, true);
  assert.equal(g.text, 'Pin the action to a SHA. Add a timeout.');
  assert.deepEqual(g.removed, ['This will pass in CI.']);
});

test('guard: failed, in-progress, or absent runs do not unlock claims; a successful completed run does', () => {
  const text = 'This works.';
  for (const evidence of [[], [run(1, { conclusion: 'failure' })], [run(2, { status: 'in_progress', conclusion: null })], [run(3, { status: 'queued', conclusion: 'success' })]]) {
    assert.equal(guardAiText(text, evidence).blocked, true);
    assert.equal(hasSuccessEvidence(evidence), false);
  }
  assert.equal(guardAiText(text, [run(4)]).blocked, false);
});

// ------------------------------------------------------------------ parsing
test('parseAiSuggestion: strict - rejects verdict/status keys, wrong types, oversize', () => {
  assert.deepEqual(parseAiSuggestion({ title: 'a', explanation: 'b' }), { title: 'a', explanation: 'b' });
  assert.ok(parseAiSuggestion({ title: 'a', explanation: 'b', verdict: 'PASS' }).reason);
  assert.ok(parseAiSuggestion({ title: 'a', explanation: 'b', status: 'success' }).reason);
  assert.ok(parseAiSuggestion({ title: '', explanation: 'b' }).reason);
  assert.ok(parseAiSuggestion({ title: 'a', explanation: 5 }).reason);
  assert.ok(parseAiSuggestion('text').reason);
  assert.ok(parseAiSuggestion(null).reason);
  assert.ok(parseAiSuggestion({ title: 'a', explanation: 'x'.repeat(4001) }).reason);
  assert.ok(parseAiSuggestion({ title: 'a', explanation: 'b', proposedChange: 3 }).reason);
});

// ------------------------------------------------------------------ orchestration
const payload = { purpose: 'explain', items: [{ label: 'wf', text: `token=${SECRET}` }] };

test('requestSuggestions: no consent -> provider is never called', async () => {
  const provider = providerReturning([]);
  for (const c of [AI_DISABLED, grantConsent('someone-else', new Date())]) {
    const out = await requestSuggestions({ provider, consent: c, payload, validator: okValidator });
    assert.deepEqual(out, { status: 'consent-required' });
  }
  assert.equal(provider.seen.length, 0);
});

test('requestSuggestions: provider only sees redacted data', async () => {
  const provider = providerReturning([]);
  await requestSuggestions({ provider, consent, payload, validator: okValidator });
  assert.ok(!JSON.stringify(provider.seen).includes(SECRET));
});

test('requestSuggestions: offered suggestions are validated, INCONCLUSIVE, and never PASS', async () => {
  const provider = providerReturning([
    { title: 'Pin actions', explanation: 'Use a SHA.', proposedChange: 'uses: a/b@abc' },
    { title: 'Bad change', explanation: 'Edit it.', proposedChange: 'invalid: [' },
    { title: 'Claims', explanation: 'This will pass.' },
    { title: 'Smuggled verdict', explanation: 'ok', verdict: 'PASS' },
    'garbage',
  ]);
  const validator = (s) => (s.proposedChange === 'invalid: [' ? { ok: false, reason: 'yaml' } : { ok: true });
  const out = await requestSuggestions({ provider, consent, payload, validator });
  assert.equal(out.status, 'completed');
  assert.equal(out.offered.length, 1);
  assert.equal(out.offered[0].verdict, 'INCONCLUSIVE');
  assert.equal(out.offered[0].validated, true);
  assert.equal(out.rejected.length, 4);
  assert.ok(out.offered.every((s) => !('status' in s)));
});

test('requestSuggestions: success wording in an otherwise valid suggestion is stripped', async () => {
  const provider = providerReturning([{ title: 'Add cache', explanation: 'Add actions/cache. The build will pass after this.' }]);
  const out = await requestSuggestions({ provider, consent, payload, validator: okValidator });
  assert.equal(out.offered[0].explanation, 'Add actions/cache.');
  const withEvidence = await requestSuggestions({ provider, consent, payload, validator: okValidator, evidence: [run(1)] });
  assert.match(withEvidence.offered[0].explanation, /will pass/);
});

test('requestSuggestions: validator is mandatory gate (async rejection honored)', async () => {
  const provider = providerReturning([{ title: 'a', explanation: 'b' }]);
  const out = await requestSuggestions({ provider, consent, payload, validator: async () => ({ ok: false, reason: 'nope' }) });
  assert.equal(out.offered.length, 0);
  assert.match(out.rejected[0].reason, /nope/);
});

test('requestSuggestions: provider errors are reported redacted; non-array output rejected; count capped', async () => {
  const failing = providerReturning(() => { throw new Error(`down ${SECRET}`); });
  const err = await requestSuggestions({ provider: failing, consent, payload, validator: okValidator });
  assert.equal(err.status, 'provider-error');
  assert.ok(!err.message.includes(SECRET));
  const notArray = await requestSuggestions({ provider: providerReturning({ a: 1 }), consent, payload, validator: okValidator });
  assert.equal(notArray.offered.length, 0);
  assert.equal(notArray.rejected.length, 1);
  const many = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, explanation: 'advice' }));
  const capped = await requestSuggestions({ provider: providerReturning(many), consent, payload, validator: okValidator });
  assert.equal(capped.offered.length, 10);
});
