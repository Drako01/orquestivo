const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseIntentContract, validateIntentContract, evaluateIntent, IntentContractError, INTENT_CONTRACT_PATH,
} = require('../../dist-test/core/evidence/intent.js');
const { aggregateResults } = require('../../dist-test/core/evidence/verdict.js');
const { job, model, run, jobEv } = require('./helpers.cjs');

const one = (criterion, m, remote) => evaluateIntent({ version: 1, criteria: [criterion] }, m, remote)[0];
const unavailable = { status: 'unavailable', reason: 'no network' };
const available = (runs) => ({ status: 'available', runs });

// ------------------------------------------------------------------ contract validation
test('contract path constant', () => assert.equal(INTENT_CONTRACT_PATH, '.orquestivo/intent.json'));

test('contract: accepts every criterion kind', () => {
  const contract = parseIntentContract(JSON.stringify({
    version: 1,
    criteria: [
      { kind: 'run-tests' }, { kind: 'block-merge-on-build-failure' }, { kind: 'produce-artifacts' },
      { kind: 'publish-only-from-branch', branch: 'main' }, { kind: 'deploy-requires-approval', environment: 'production' },
      { kind: 'min-coverage', percent: 80, description: 'cov' }, { kind: 'security-scan-present' },
      { kind: 'no-secret-exposure' }, { kind: 'deploy-confirmed', job: 'deploy', branch: 'main' },
    ],
  }));
  assert.equal(contract.criteria.length, 9);
});

const invalidCases = [
  ['not JSON', '{nope'],
  ['array root', '[]'],
  ['null root', 'null'],
  ['wrong version', '{"version":2,"criteria":[{"kind":"run-tests"}]}'],
  ['missing criteria', '{"version":1}'],
  ['empty criteria', '{"version":1,"criteria":[]}'],
  ['unknown root key', '{"version":1,"criteria":[{"kind":"run-tests"}],"x":1}'],
  ['unknown kind', '{"version":1,"criteria":[{"kind":"fly"}]}'],
  ['prototype kind', '{"version":1,"criteria":[{"kind":"constructor"}]}'],
  ['non-object criterion', '{"version":1,"criteria":["run-tests"]}'],
  ['unknown property', '{"version":1,"criteria":[{"kind":"run-tests","extra":1}]}'],
  ['missing required', '{"version":1,"criteria":[{"kind":"publish-only-from-branch"}]}'],
  ['empty string', '{"version":1,"criteria":[{"kind":"publish-only-from-branch","branch":" "}]}'],
  ['wrong type', '{"version":1,"criteria":[{"kind":"deploy-requires-approval","environment":5}]}'],
  ['percent 0', '{"version":1,"criteria":[{"kind":"min-coverage","percent":0}]}'],
  ['percent 101', '{"version":1,"criteria":[{"kind":"min-coverage","percent":101}]}'],
  ['percent NaN-like string', '{"version":1,"criteria":[{"kind":"min-coverage","percent":"80"}]}'],
  ['too long string', JSON.stringify({ version: 1, criteria: [{ kind: 'deploy-confirmed', job: 'x'.repeat(201) }] })],
  ['too many criteria', JSON.stringify({ version: 1, criteria: Array.from({ length: 101 }, () => ({ kind: 'run-tests' })) })],
];
for (const [name, text] of invalidCases) {
  test(`contract: rejects ${name} with typed error`, () => {
    assert.throws(() => parseIntentContract(text), (e) => e instanceof IntentContractError && e.issues.length > 0);
  });
}

test('contract: boundary percents 100 and 0.1 are valid; issues carry paths', () => {
  assert.doesNotThrow(() => validateIntentContract({ version: 1, criteria: [{ kind: 'min-coverage', percent: 100 }] }));
  assert.doesNotThrow(() => validateIntentContract({ version: 1, criteria: [{ kind: 'min-coverage', percent: 0.1 }] }));
  try {
    validateIntentContract({ version: 1, criteria: [{ kind: 'run-tests' }, { kind: 'min-coverage', percent: 500 }] });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.issues[0].path, '$.criteria[1].percent');
  }
});

// ------------------------------------------------------------------ run-tests
test('run-tests: PASS for unconditional test step, with step evidence', () => {
  const r = one({ kind: 'run-tests' }, model([job('t', [{ run: 'npm ci\nnpm test' }])]));
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.basis, 'static-inference');
  assert.equal(r.evidence.length, 1);
  assert.match(r.message, /not that tests ran/);
});
for (const cmd of ['pnpm test', 'yarn test:unit', 'npm run test', 'pytest -q', 'go test ./...', 'dotnet test', 'cargo test', 'mvn -B verify', 'node --test', 'npx vitest run']) {
  test(`run-tests: recognizes "${cmd}"`, () => {
    assert.equal(one({ kind: 'run-tests' }, model([job('t', [{ run: cmd }])])).verdict, 'PASS');
  });
}
test('run-tests: FAIL when absent, echo/comment-only, or disabled', () => {
  assert.equal(one({ kind: 'run-tests' }, model([job('b', [{ run: 'npm run build' }])])).verdict, 'FAIL');
  assert.equal(one({ kind: 'run-tests' }, model([job('b', [{ run: 'echo npm test\n# npm test' }])])).verdict, 'FAIL');
  assert.equal(one({ kind: 'run-tests' }, model([job('b', [{ run: 'npm test', condition: 'false' }])])).verdict, 'FAIL');
  assert.equal(one({ kind: 'run-tests' }, model([])).verdict, 'FAIL');
});
test('run-tests: WARN when only conditional; INCONCLUSIVE with reusable workflow', () => {
  assert.equal(one({ kind: 'run-tests' }, model([job('t', [{ run: 'npm test', condition: "github.event_name == 'push'" }])])).verdict, 'WARN');
  assert.equal(one({ kind: 'run-tests' }, model([job('t', [], { uses: './.github/workflows/x.yml' })])).verdict, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ block-merge-on-build-failure
test('block-merge: FAIL without pull_request trigger', () => {
  const m = model([job('b', [{ run: 'npm test' }])], { triggers: [{ event: 'push' }] });
  assert.equal(one({ kind: 'block-merge-on-build-failure' }, m).verdict, 'FAIL');
});
test('block-merge: never PASS statically; INCONCLUSIVE, or BLOCKED when connector down', () => {
  const m = model([job('b', [{ run: 'npm test' }])]);
  assert.equal(one({ kind: 'block-merge-on-build-failure' }, m).verdict, 'INCONCLUSIVE');
  assert.equal(one({ kind: 'block-merge-on-build-failure' }, m, unavailable).verdict, 'BLOCKED');
  assert.equal(one({ kind: 'block-merge-on-build-failure' }, m, available([run(1)])).verdict, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ produce-artifacts
test('produce-artifacts: PASS / WARN / FAIL', () => {
  const up = (extra = {}) => model([job('b', [{ uses: 'actions/upload-artifact@v4', ...extra }])]);
  assert.equal(one({ kind: 'produce-artifacts' }, up()).verdict, 'PASS');
  assert.equal(one({ kind: 'produce-artifacts' }, up({ condition: 'always()' })).verdict, 'WARN');
  assert.equal(one({ kind: 'produce-artifacts' }, up({ condition: 'false' })).verdict, 'FAIL');
  assert.equal(one({ kind: 'produce-artifacts' }, model([job('b', [{ run: 'x' }])])).verdict, 'FAIL');
  assert.equal(one({ kind: 'produce-artifacts' }, model([job('b', [{ uses: 'evil/upload-artifact@v1' }])])).verdict, 'FAIL');
});

// ------------------------------------------------------------------ publish-only-from-branch
const publishStep = { run: 'npm publish' };
test('publish-only: SKIP when nothing publishes', () => {
  assert.equal(one({ kind: 'publish-only-from-branch', branch: 'main' }, model([job('b', [{ run: 'npm test' }])])).verdict, 'SKIP');
});
test('publish-only: PASS when workflow triggers only on that branch', () => {
  const m = model([job('p', [publishStep])], { triggers: [{ event: 'push', branches: ['main'] }] });
  assert.equal(one({ kind: 'publish-only-from-branch', branch: 'main' }, m).verdict, 'PASS');
});
test('publish-only: FAIL when other branch/event/tags can trigger', () => {
  const c = { kind: 'publish-only-from-branch', branch: 'main' };
  const t = (triggers) => model([job('p', [publishStep])], { triggers });
  assert.equal(one(c, t([{ event: 'push', branches: ['main', 'dev'] }])).verdict, 'FAIL');
  assert.equal(one(c, t([{ event: 'push', branches: ['main'] }, { event: 'workflow_dispatch' }])).verdict, 'FAIL');
  assert.equal(one(c, t([{ event: 'push', branches: ['main'], tags: ['v*'] }])).verdict, 'FAIL');
  assert.equal(one(c, t([{ event: 'push' }])).verdict, 'FAIL');
});
test('publish-only: PASS via job/step condition, INCONCLUSIVE when ambiguous, FAIL for other branch', () => {
  const c = { kind: 'publish-only-from-branch', branch: 'main' };
  const wide = [{ event: 'push' }];
  const withCond = (condition, level = 'job') => model(
    [job('p', [level === 'step' ? { ...publishStep, condition } : publishStep], level === 'job' ? { condition } : {})],
    { triggers: wide },
  );
  assert.equal(one(c, withCond("github.ref == 'refs/heads/main'")).verdict, 'PASS');
  assert.equal(one(c, withCond("${{ github.ref_name == 'main' }}", 'step')).verdict, 'PASS');
  assert.equal(one(c, withCond("github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'")).verdict, 'INCONCLUSIVE');
  assert.equal(one(c, withCond("github.ref != 'refs/heads/main'")).verdict, 'FAIL');
  assert.equal(one(c, withCond("github.ref == 'refs/heads/develop'")).verdict, 'FAIL');
  assert.equal(one(c, withCond("github.ref == 'refs/heads/mainx'")).verdict, 'FAIL');
});
test('publish-only: branch with regex metacharacters is matched literally', () => {
  const m = model([job('p', [publishStep], { condition: "github.ref_name == 'release/1.x'" })], { triggers: [{ event: 'push' }] });
  assert.equal(one({ kind: 'publish-only-from-branch', branch: 'release/1.x' }, m).verdict, 'PASS');
  assert.equal(one({ kind: 'publish-only-from-branch', branch: 'release/1.y' }, m).verdict, 'FAIL');
});
test('publish-only: detects publishing actions and docker push', () => {
  const m = model([job('p', [{ uses: 'softprops/action-gh-release@v2' }, { run: 'docker push img' }])], { triggers: [{ event: 'push' }] });
  const r = one({ kind: 'publish-only-from-branch', branch: 'main' }, m);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.evidence.length, 2);
});

// ------------------------------------------------------------------ deploy-requires-approval
test('deploy-requires-approval: FAIL without environment; never PASS statically', () => {
  const c = { kind: 'deploy-requires-approval', environment: 'production' };
  assert.equal(one(c, model([job('d', [{ run: 'x' }])])).verdict, 'FAIL');
  assert.equal(one(c, model([job('d', [], { environment: 'staging' })])).verdict, 'FAIL');
  const m = model([job('d', [], { environment: 'production' })]);
  const r = one(c, m);
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.deepEqual(r.evidence, [{ kind: 'job', ref: 'd' }]);
  assert.equal(one(c, m, unavailable).verdict, 'BLOCKED');
  assert.equal(one(c, m, available([run(1)])).verdict, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ min-coverage
test('min-coverage: threshold boundaries', () => {
  const m = (cmd) => model([job('t', [{ run: cmd }])]);
  const c = { kind: 'min-coverage', percent: 80 };
  assert.equal(one(c, m('pytest --cov=app --cov-fail-under=80')).verdict, 'PASS');
  assert.equal(one(c, m('pytest --cov=app --cov-fail-under=79.9')).verdict, 'FAIL');
  assert.equal(one(c, m('pytest --cov=app --cov-fail-under=95')).verdict, 'PASS');
  assert.equal(one(c, m('coverage report --fail-under 85')).verdict, 'PASS');
  assert.equal(one(c, m('nyc --check-coverage --lines 90 npm test')).verdict, 'PASS');
  assert.equal(one(c, m('nyc --check-coverage --lines 50 npm test')).verdict, 'FAIL');
  assert.equal(one({ kind: 'min-coverage', percent: 100 }, m('pytest --cov-fail-under=100')).verdict, 'PASS');
});
test('min-coverage: WARN when measured without threshold; INCONCLUSIVE when invisible', () => {
  const c = { kind: 'min-coverage', percent: 80 };
  assert.equal(one(c, model([job('t', [{ run: 'npm test -- --coverage' }])])).verdict, 'WARN');
  assert.equal(one(c, model([job('t', [{ run: 'npm test' }])])).verdict, 'INCONCLUSIVE');
  assert.equal(one(c, model([job('t', [{ run: 'echo --cov-fail-under=99' }])])).verdict, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ security-scan-present
test('security-scan-present: PASS / WARN / FAIL', () => {
  const c = { kind: 'security-scan-present' };
  assert.equal(one(c, model([job('s', [{ uses: 'github/codeql-action/analyze@v3' }])])).verdict, 'PASS');
  assert.equal(one(c, model([job('s', [{ run: 'npm audit --audit-level=high' }])])).verdict, 'PASS');
  assert.equal(one(c, model([job('s', [{ run: 'trivy fs .', condition: 'always()' }])])).verdict, 'WARN');
  assert.equal(one(c, model([job('s', [{ uses: 'aquasecurity/trivy-action@0.20.0', condition: 'false' }])])).verdict, 'FAIL');
  assert.equal(one(c, model([job('s', [{ run: 'npm test' }])])).verdict, 'FAIL');
});

// ------------------------------------------------------------------ no-secret-exposure
test('no-secret-exposure: FAIL on interpolation or hard-coded secrets; never PASS otherwise', () => {
  const c = { kind: 'no-secret-exposure' };
  assert.equal(one(c, model([job('s', [{ run: 'curl -H "x: ${{ secrets.TOKEN }}" url' }])])).verdict, 'FAIL');
  assert.equal(one(c, model([job('s', [{ run: 'export T=ghp_' + 'a'.repeat(36) }])])).verdict, 'FAIL');
  const clean = one(c, model([job('s', [{ run: 'npm test' }])]));
  assert.equal(clean.verdict, 'INCONCLUSIVE');
  assert.match(clean.message, /cannot be proven/);
});

// ------------------------------------------------------------------ deploy-confirmed
const dc = { kind: 'deploy-confirmed', job: 'deploy' };
const runWithDeploy = (id, fields, jobFields = {}) => run(id, { jobs: [jobEv(id * 10, 'deploy', jobFields)], ...fields });
test('deploy-confirmed: INCONCLUSIVE without remote request, BLOCKED when unavailable', () => {
  const m = model([job('deploy', [{ run: 'x' }])]);
  const r = one(dc, m);
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.basis, 'static-inference');
  const b = one(dc, m, { status: 'unavailable', reason: `denied ghp_${'a'.repeat(36)}` });
  assert.equal(b.verdict, 'BLOCKED');
  assert.ok(!b.message.includes('ghp_a'));
});
test('deploy-confirmed: PASS only with observed successful job, basis remote-evidence', () => {
  const m = model([]);
  const r = one(dc, m, available([runWithDeploy(1, {})]));
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.basis, 'remote-evidence');
  assert.deepEqual(r.evidence, [{ kind: 'run', ref: '1' }, { kind: 'job', ref: '10' }]);
});
test('deploy-confirmed: matrix leg names, latest run wins, branch filter', () => {
  const m = model([]);
  const old = runWithDeploy(1, {});
  const failing = runWithDeploy(2, {}, { conclusion: 'failure' });
  assert.equal(one(dc, m, available([old, failing])).verdict, 'FAIL');
  assert.equal(one(dc, m, available([failing, old])).verdict, 'FAIL');
  assert.equal(one({ ...dc, branch: 'release' }, m, available([old, failing])).verdict, 'INCONCLUSIVE');
  const leg = run(3, { jobs: [jobEv(1, 'deploy (eu)')] });
  assert.equal(one(dc, m, available([leg])).verdict, 'PASS');
  const lookalike = run(4, { jobs: [jobEv(1, 'deploy-docs')] });
  assert.equal(one(dc, m, available([lookalike])).verdict, 'INCONCLUSIVE');
});
test('deploy-confirmed: non-success conclusions are never PASS', () => {
  const m = model([]);
  const verdict = (conclusion, status = 'completed') => one(dc, m, available([runWithDeploy(1, {}, { conclusion, status })])).verdict;
  assert.equal(verdict('skipped'), 'SKIP');
  assert.equal(verdict('cancelled'), 'FAIL');
  assert.equal(verdict('timed_out'), 'FAIL');
  assert.equal(verdict(null, 'in_progress'), 'INCONCLUSIVE');
  assert.equal(verdict('neutral'), 'INCONCLUSIVE');
  assert.equal(one(dc, m, available([])).verdict, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ whole evaluation
test('evaluateIntent: ids, ordering and aggregate cannot be PASS with an unprovable criterion', () => {
  const contract = { version: 1, criteria: [{ kind: 'run-tests' }, { kind: 'no-secret-exposure' }] };
  const results = evaluateIntent(contract, model([job('t', [{ run: 'npm test' }])]));
  assert.deepEqual(results.map((r) => r.id), ['0:run-tests', '1:no-secret-exposure']);
  assert.equal(aggregateResults(results), 'INCONCLUSIVE');
});
