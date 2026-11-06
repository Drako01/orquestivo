const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeWorkflow } = require('../dist-test/core/analyzer.js');
const { GITHUB_RULE_CATALOG } = require('../dist-test/core/github/rules/index.js');
const { isValidCron } = require('../dist-test/core/github/rules/triggers.js');

const PIN = 'a'.repeat(40);
const X = (expr) => '${{ ' + expr + ' }}';
const indent = (text, pad) => text.split('\n').map((l) => pad + l).join('\n');

/** Builds one job block. `steps`/`extra` entries may span several lines. */
function J(o = {}) {
  const lines = ['  ' + (o.id ?? 'build') + ':'];
  if (o.runsOn !== null) lines.push('    runs-on: ' + (o.runsOn ?? 'ubuntu-latest'));
  if (o.timeout !== null) lines.push('    timeout-minutes: ' + (o.timeout ?? 10));
  for (const e of o.extra ?? []) lines.push(indent(e, '    '));
  if (o.steps !== null) {
    lines.push('    steps:');
    for (const s of o.steps ?? ['- run: echo hi']) lines.push(indent(s, '      '));
  }
  return lines.join('\n') + '\n';
}
const W = (jobs, o = {}) =>
  'name: CI\n' + (o.on ?? 'on: push') + '\n' + (o.perm ?? 'permissions:\n  contents: read\n') + (o.top ?? '') + 'jobs:\n' + jobs;
const codesOf = (yaml) => analyzeWorkflow(yaml).findings.map((f) => f.code);
const run = (script) => W(J({ steps: ['- run: |\n' + indent(script, '    ')] }));
const withStep = (step, o) => W(J({ steps: [step] }), o);
const mkSteps = (...steps) => W(J({ steps }));
const upload = '- uses: actions/upload-artifact@' + PIN + '\n  with:\n    name: out\n    retention-days: 3\n    path: dist';
const checkout = '- uses: actions/checkout@' + PIN;

/** code -> { pos: [yaml], neg: [yaml] }; boundary inputs live inside both lists. */
const CASES = {
  YAML_INVALID: { pos: ['name: CI\njobs:\n  broken: ['], neg: [W(J())] },
  WORKFLOW_ROOT_INVALID: { pos: ['- a\n- b\n', '', 'just text'], neg: [W(J())] },
  YAML_TOO_LARGE: { pos: ['#' + 'x'.repeat(2_000_001)], neg: ['#' + 'x'.repeat(1000) + '\n' + W(J())] },
  EVENT_MISSING: { pos: ['name: CI\njobs: {}', W(J(), { on: 'on: []' }), W(J(), { on: 'on: {}' })], neg: [W(J())] },
  JOBS_MISSING: { pos: ['on: push\npermissions: {}', 'on: push\njobs: {}'], neg: [W(J())] },
  JOB_INVALID: { pos: [W('  build: nope\n')], neg: [W(J())] },
  RUNNER_MISSING: { pos: [W(J({ runsOn: null }))], neg: [W(J())] },
  STEPS_MISSING: { pos: [W(J({ steps: null })), W(J({ steps: [] }))], neg: [W(J())] },
  STEP_INVALID: { pos: [mkSteps('- just a string')], neg: [W(J())] },
  STEP_ACTION_MISSING: { pos: [mkSteps('- name: empty')], neg: [W(J()), mkSteps('- run: echo ok')] },
  STEP_RUN_AND_USES: { pos: [mkSteps('- uses: ./local\n  run: echo')], neg: [mkSteps('- uses: ./local')] },
  REUSABLE_JOB_CONFLICT: {
    pos: [W('  call:\n    uses: ./.github/workflows/a.yml\n    runs-on: ubuntu-latest\n')],
    neg: [W('  call:\n    uses: ./.github/workflows/a.yml\n')],
  },
  EVENT_UNKNOWN: {
    pos: [W(J(), { on: 'on: pushh' }), W(J(), { on: 'on: [push, pul_request]' }), W(J(), { on: 'on:\n  workflow_dispatch:\n  frobnicate:' })],
    neg: [W(J()), W(J(), { on: 'on: [push, pull_request, workflow_dispatch, workflow_call, merge_group]' })],
  },
  BRANCHES_CONFLICT: {
    pos: [W(J(), { on: 'on:\n  push:\n    branches: [main]\n    branches-ignore: [dev]' })],
    neg: [W(J(), { on: 'on:\n  push:\n    branches: [main]' }),
      W(J(), { on: 'on:\n  push:\n    branches: [main]\n  pull_request:\n    branches-ignore: [dev]' })],
  },
  TAGS_CONFLICT: {
    pos: [W(J(), { on: 'on:\n  push:\n    tags: [v*]\n    tags-ignore: [x*]' })],
    neg: [W(J(), { on: 'on:\n  push:\n    tags: [v*]' })],
  },
  PATHS_CONFLICT: {
    pos: [W(J(), { on: 'on:\n  pull_request:\n    paths: [src/**]\n    paths-ignore: [docs/**]' })],
    neg: [W(J(), { on: 'on:\n  pull_request:\n    paths: [src/**, "!src/gen/**"]' })],
  },
  CRON_INVALID: {
    pos: [
      W(J(), { on: 'on:\n  schedule:\n    - cron: "61 * * * *"' }),
      W(J(), { on: 'on:\n  schedule:\n    - cron: "0 24 * * *"' }),
      W(J(), { on: 'on:\n  schedule:\n    - cron: "0 0 * *"' }),
      W(J(), { on: 'on:\n  schedule:\n    - name: nocron' }),
      W(J(), { on: 'on:\n  schedule:' }),
    ],
    neg: [W(J(), { on: 'on:\n  schedule:\n    - cron: "0 3 * * 1-5"' }), W(J(), { on: 'on:\n  schedule:\n    - cron: "59 23 31 12 6"' })],
  },
  PR_TARGET_REVIEW: { pos: [W(J(), { on: 'on:\n  pull_request_target:' })], neg: [W(J())] },
  PR_TARGET_CHECKOUT_REVIEW: {
    pos: [W(J({ steps: ['- uses: actions/checkout@' + PIN + '\n  with:\n    ref: ' + X('github.event.pull_request.head.sha')] }), { on: 'on: pull_request_target' })],
    neg: [W(J({ steps: [checkout] }), { on: 'on: pull_request_target' }),
      W(J({ steps: ['- uses: actions/checkout@' + PIN + '\n  with:\n    ref: main'] }))],
  },
  SELF_HOSTED_PR_TARGET: {
    pos: [W(J({ runsOn: '[self-hosted, linux]' }), { on: 'on: pull_request_target' })],
    neg: [W(J({ runsOn: '[self-hosted, linux]' })), W(J(), { on: 'on: pull_request_target' })],
  },
  NEEDS_INVALID: { pos: [W(J({ extra: ['needs: []'] }))], neg: [W(J()), W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: a'] }))] },
  NEEDS_SELF: { pos: [W(J({ extra: ['needs: build'] }))], neg: [W(J())] },
  NEEDS_UNKNOWN: { pos: [W(J({ extra: ['needs: [ghost]'] }))], neg: [W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: [a]'] }))] },
  NEEDS_CYCLE: {
    pos: [W(J({ id: 'a', extra: ['needs: b'] }) + J({ id: 'b', extra: ['needs: a'] }))],
    neg: [W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: a'] }) + J({ id: 'c', extra: ['needs: [a, b]'] }))],
  },
  NEEDS_CONTEXT_UNDECLARED: {
    pos: [
      W(J({ id: 'a' }) + J({ id: 'b', steps: ['- run: echo ' + X('needs.a.outputs.x')] })),
      W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: a'] }) + J({ id: 'c', extra: ['needs: b'], steps: ['- run: echo ' + X('needs.a.result')] })),
    ],
    neg: [W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: [a]'], steps: ['- run: echo ' + X('needs.a.outputs.x')] }))],
  },
  PERMISSIONS_UNDECLARED: {
    pos: [W(J(), { perm: '' })],
    neg: [W(J()), W(J({ extra: ['permissions:\n  contents: read'] }), { perm: '' })],
  },
  PERMISSIONS_WRITE_ALL: {
    pos: [W(J(), { perm: 'permissions: write-all\n' }), W(J({ extra: ['permissions: write-all'] }))],
    neg: [W(J()), W(J(), { perm: 'permissions: read-all\n' })],
  },
  PERMISSIONS_WRITE_REVIEW: {
    pos: [W(J(), { perm: 'permissions:\n  contents: write\n' }), W(J({ extra: ['permissions:\n  issues: write'] }))],
    neg: [W(J())],
  },
  PERMISSIONS_UNKNOWN_SCOPE: {
    pos: [W(J(), { perm: 'permissions:\n  contnts: read\n' }), W(J({ extra: ['permissions:\n  secrets: read'] }))],
    neg: [W(J(), { perm: 'permissions:\n  contents: read\n  pull-requests: write\n  id-token: none\n' })],
  },
  PERMISSIONS_INVALID_VALUE: {
    pos: [
      W(J(), { perm: 'permissions:\n  contents: wirte\n' }),
      W(J(), { perm: 'permissions: read-everything\n' }),
      W(J(), { perm: 'permissions:\n  id-token: read\n' }),
      W(J({ extra: ['permissions:\n  contents: 1'] })),
    ],
    neg: [W(J(), { perm: 'permissions:\n  contents: none\n' }), W(J(), { perm: 'permissions: {}\n' }), W(J(), { perm: 'permissions: read-all\n' })],
  },
  ID_TOKEN_WITHOUT_NEED: {
    pos: [W(J(), { perm: 'permissions:\n  id-token: write\n' }), W(J({ extra: ['permissions:\n  id-token: write'] }))],
    neg: [
      W(J({ steps: ['- uses: aws-actions/configure-aws-credentials@' + PIN] }), { perm: 'permissions:\n  id-token: write\n' }),
      W(J({ extra: ['permissions:\n  id-token: write'], steps: ['- uses: azure/login@' + PIN] })),
      W(J({ steps: ['- run: cosign sign image'] }), { perm: 'permissions:\n  id-token: write\n' }),
    ],
  },
  EXPR_UNBALANCED: {
    pos: [run('echo "${{ github.ref "'), run('echo ' + '${{ contains(github.ref, \'x\' }}'), run("echo ${{ github.ref == 'x }}")],
    neg: [run('echo ' + X("contains(github.ref, 'x')")), run('echo ' + X("github.ref == 'it''s'"))],
  },
  EXPR_UNKNOWN_CONTEXT: {
    pos: [run('echo ' + X('gitub.ref')), run('echo ' + X("secret.TOKEN != ''"))],
    neg: [run('echo ' + X('github.ref')), run('echo ' + X('vars.X') + X('inputs.y')), run('echo ' + X("contains('a.b', github.ref)"))],
  },
  EXPR_UNKNOWN_FUNCTION: {
    pos: [run('echo ' + X("containz(github.ref, 'x')"))],
    neg: [run('echo ' + X("format('{0}', github.sha)")), run('echo ' + X("STARTSWITH(github.ref, 'x')")), run('echo ' + X("hashFiles('**/go.sum')"))],
  },
  EXPR_SECRETS_IN_IF: {
    pos: [withStep('- run: echo\n  if: secrets.TOKEN != \'\''), withStep('- run: echo\n  if: ' + X('secrets.X')), W(J({ extra: ['if: ' + X('secrets.X == 1')] }))],
    neg: [withStep('- run: echo\n  env:\n    T: ' + X('secrets.TOKEN') + '\n  if: env.T != \'\'')],
  },
  EXPR_CONTEXT_UNAVAILABLE: {
    pos: [W(J({ extra: ["if: env.FOO == 'x'"] })), W(J({ runsOn: X('env.RUNNER') })), W(J({ runsOn: X('secrets.R') }))],
    neg: [withStep("- run: echo\n  if: env.FOO == 'x'"), W(J({ extra: ["if: github.ref == 'x'"] })),
      W(J({ id: 'a' }) + J({ id: 'b', extra: ['needs: a', 'if: needs.a.result == \'success\''] }))],
  },
  EXPR_MATRIX_UNDEFINED: {
    pos: [mkSteps('- run: echo ' + X('matrix.os'))],
    neg: [W(J({ extra: ['strategy:\n  matrix:\n    os: [a, b]'], steps: ['- run: echo ' + X('matrix.os')] }))],
  },
  MATRIX_EMPTY: {
    pos: [W(J({ extra: ['strategy:\n  matrix:\n    os: []'] })), W(J({ extra: ['strategy:\n  matrix: {}'] })), W(J({ extra: ['strategy:\n  matrix:'] }))],
    neg: [W(J({ extra: ['strategy:\n  matrix:\n    os: [a]'] })), W(J({ extra: ['strategy:\n  matrix:\n    include:\n      - os: a'] })),
      W(J({ extra: ['strategy:\n  matrix: ' + X('fromJSON(needs.x.outputs.m)')] }))],
  },
  MATRIX_INVALID: {
    pos: [W(J({ extra: ['strategy:\n  matrix:\n    os: ubuntu'] })), W(J({ extra: ['strategy:\n  matrix:\n    os: [a]\n    include:\n      os: b'] }))],
    neg: [W(J({ extra: ['strategy:\n  matrix:\n    os: [a]\n    include:\n      - os: b'] }))],
  },
  MATRIX_UNKNOWN_KEY: {
    pos: [W(J({ extra: ['strategy:\n  matrix:\n    os: [a]\n    exclude:\n      - node: 1'] }))],
    neg: [W(J({ extra: ['strategy:\n  matrix:\n    os: [a]\n    exclude:\n      - os: a'] })),
      W(J({ extra: ['strategy:\n  matrix:\n    os: [a]\n    include:\n      - extra: yes'] }))],
  },
  MATRIX_STRATEGY_INVALID: {
    pos: [
      W(J({ extra: ['strategy:\n  fail-fast: "yes"\n  matrix:\n    os: [a]'] })),
      W(J({ extra: ['strategy:\n  max-parallel: 0\n  matrix:\n    os: [a]'] })),
      W(J({ extra: ['strategy:\n  max-parallel: 1.5\n  matrix:\n    os: [a]'] })),
    ],
    neg: [
      W(J({ extra: ['strategy:\n  fail-fast: false\n  max-parallel: 1\n  matrix:\n    os: [a]'] })),
      W(J({ extra: ['strategy:\n  fail-fast: ' + X('github.ref == \'x\'') + '\n  matrix:\n    os: [a]'] })),
    ],
  },
  REUSABLE_WORKFLOW_UNPINNED: {
    pos: [W('  call:\n    uses: org/repo/.github/workflows/ci.yml@main\n')],
    neg: [W('  call:\n    uses: org/repo/.github/workflows/ci.yml@' + PIN + '\n'), W('  call:\n    uses: ./.github/workflows/ci.yml\n')],
  },
  SECRETS_INHERIT_REVIEW: {
    pos: [W('  call:\n    uses: ./.github/workflows/ci.yml\n    secrets: inherit\n')],
    neg: [W('  call:\n    uses: ./.github/workflows/ci.yml\n')],
  },
  REUSABLE_USES_FORMAT: {
    pos: [W('  call:\n    uses: org/repo@v1\n'), W('  call:\n    uses: foo\n'), W('  call:\n    uses: org/repo/.github/workflows/ci.yml\n')],
    neg: [W('  call:\n    uses: org/repo/.github/workflows/ci.yaml@v1\n'), W('  call:\n    uses: ./.github/workflows/ci.yml\n')],
  },
  DEPLOY_ENVIRONMENT_MISSING: {
    pos: [W(J({ id: 'deploy-prod' }), { top: 'concurrency: x\n' }), W(J({ id: 'ship', extra: ['name: Release to production'] }), { top: 'concurrency: x\n' })],
    neg: [W(J({ id: 'deploy', extra: ['environment: production'] }), { top: 'concurrency: x\n' }), W(J({ id: 'deployer' })), W(J({ id: 'build' }))],
  },
  DEPLOY_CONCURRENCY_MISSING: {
    pos: [W(J({ id: 'deploy', extra: ['environment: production'] }))],
    neg: [W(J({ id: 'deploy', extra: ['environment: production'] }), { top: 'concurrency: deploy\n' }),
      W(J({ id: 'deploy', extra: ['environment: production', 'concurrency: deploy'] })), W(J({ id: 'build' }))],
  },
  ARTIFACT_RETENTION_UNSET: {
    pos: [mkSteps('- uses: actions/upload-artifact@' + PIN + '\n  with:\n    name: x')],
    neg: [mkSteps(upload), mkSteps('- uses: actions/cache@' + PIN + '\n  with:\n    key: ' + X("hashFiles('a')"))],
  },
  ARTIFACT_NAME_UNSET: {
    pos: [mkSteps('- uses: actions/upload-artifact@' + PIN + '\n  with:\n    retention-days: 1')],
    neg: [mkSteps(upload)],
  },
  ARTIFACT_DOWNLOAD_ORPHAN: {
    pos: [
      mkSteps('- uses: actions/download-artifact@' + PIN),
      W(J({ id: 'a', steps: [upload] }) + J({ id: 'b', steps: ['- uses: actions/download-artifact@' + PIN] })),
    ],
    neg: [
      W(J({ id: 'a', steps: [upload] }) + J({ id: 'b', extra: ['needs: a'], steps: ['- uses: actions/download-artifact@' + PIN] })),
      W(J({ id: 'a', steps: [upload] }) + J({ id: 'b', extra: ['needs: a'] }) +
        J({ id: 'c', extra: ['needs: b'], steps: ['- uses: actions/download-artifact@' + PIN] })),
      mkSteps('- uses: actions/download-artifact@' + PIN + '\n  with:\n    run-id: 123\n    github-token: t'),
    ],
  },
  SETUP_CACHE_MISSING: {
    pos: [mkSteps('- uses: actions/setup-node@' + PIN), mkSteps('- uses: actions/setup-java@' + PIN + '\n  with:\n    distribution: temurin')],
    neg: [mkSteps('- uses: actions/setup-node@' + PIN + '\n  with:\n    cache: npm'), mkSteps('- uses: actions/setup-go@' + PIN)],
  },
  CACHE_KEY_NO_HASHFILES: {
    pos: [mkSteps('- uses: actions/cache@' + PIN + '\n  with:\n    path: ~/.npm\n    key: npm-cache'),
      mkSteps('- uses: actions/cache/save@' + PIN + '\n  with:\n    path: p\n    key: ' + X('runner.os') + '-x')],
    neg: [mkSteps('- uses: actions/cache@' + PIN + '\n  with:\n    path: p\n    key: npm-' + X("hashFiles('**/package-lock.json')"))],
  },
  TIMEOUT_UNSET: { pos: [W(J({ timeout: null }))], neg: [W(J()), W('  call:\n    uses: ./.github/workflows/ci.yml\n')] },
  TIMEOUT_INVALID: {
    pos: [W(J({ timeout: -1 })), W(J({ timeout: 0 })), W(J({ timeout: '"10"' })), W(J({ timeout: 1.5 })), mkSteps('- run: echo\n  timeout-minutes: 0')],
    neg: [W(J({ timeout: 1 })), W(J({ timeout: X('inputs.t') })), mkSteps('- run: echo\n  timeout-minutes: 5')],
  },
  TIMEOUT_EXCESSIVE: { pos: [W(J({ timeout: 361 }))], neg: [W(J({ timeout: 360 }))] },
  EXPRESSION_IN_SCRIPT: {
    pos: [run('echo ' + X('github.event.pull_request.title')), run('echo ' + X('github.event.head_commit.message'))],
    neg: [run('echo ' + X('github.sha')), run('echo "$TITLE"')],
  },
  SECRET_ECHO: {
    pos: [run('echo ' + X('secrets.TOKEN')), run('printf "%s" ' + X('secrets.TOKEN'))],
    neg: [run('echo "$TOKEN"'), run('echo ' + X('secrets.P') + ' | docker login --password-stdin'), run('echo "' + X('secrets.K') + '" > key.pem')],
  },
  CURL_PIPE_SHELL: {
    pos: [run('curl -fsSL https://example.com/install.sh | sh'), run('wget -qO- https://example.com/i | sudo bash')],
    neg: [run('curl -fsSLo i.sh https://example.com/i.sh && sha256sum -c i.sum && sh i.sh'), run('curl -s https://api.example.com | jq .')],
  },
  DEPRECATED_SET_OUTPUT: {
    pos: [run('echo "::set-output name=a::b"'), run('echo "::save-state name=a::b"')],
    neg: [run('echo "a=b" >> "$GITHUB_OUTPUT"')],
  },
  DEPRECATED_SET_ENV: {
    pos: [run('echo "::set-env name=A::b"'), run('echo "::add-path::/x"')],
    neg: [run('echo "A=b" >> "$GITHUB_ENV"')],
  },
  ACTION_NOT_PINNED: {
    pos: [mkSteps('- uses: actions/checkout@v4'), mkSteps('- uses: docker://alpine:3'), mkSteps('- uses: actions/checkout@' + 'a'.repeat(39))],
    neg: [mkSteps(checkout), mkSteps('- uses: ./local-action'), mkSteps('- uses: docker://alpine@sha256:' + 'b'.repeat(64))],
  },
  CHECKOUT_PERSIST_CREDENTIALS: {
    pos: [mkSteps(checkout, upload)],
    neg: [mkSteps(checkout), mkSteps('- uses: actions/checkout@' + PIN + '\n  with:\n    persist-credentials: false', upload),
      W(J({ id: 'a', steps: [checkout] }) + J({ id: 'b', steps: [upload] }))],
  },
  CONTAINER_MUTABLE_TAG: {
    pos: [W(J({ extra: ['container: node:20'] })), W(J({ extra: ['container:\n  image: node:20'] })),
      W(J({ extra: ['services:\n  db:\n    image: postgres:16'] }))],
    neg: [W(J({ extra: ['container: node@sha256:' + 'c'.repeat(64)] })), W(J())],
  },
  CONTAINER_INVALID: {
    pos: [W(J({ extra: ['container:\n  options: --cpus 1'] })), W(J({ extra: ['container: 5'] }))],
    neg: [W(J({ extra: ['container: node@sha256:' + 'c'.repeat(64)] }))],
  },
  SERVICES_INVALID: {
    pos: [W(J({ extra: ['services:\n  - redis'] })), W(J({ extra: ['services:\n  db:\n    env:\n      A: b'] })),
      W(J({ extra: ['services:\n  db:\n    image: postgres@sha256:' + 'd'.repeat(64) + '\n    ports: 5432:5432'] }))],
    neg: [W(J({ extra: ['services:\n  db:\n    image: postgres@sha256:' + 'd'.repeat(64) + '\n    ports:\n      - 5432:5432'] }))],
  },
  CONTINUE_ON_ERROR_REVIEW: { pos: [mkSteps('- run: echo\n  continue-on-error: true')], neg: [mkSteps('- run: echo\n  continue-on-error: false')] },
  CONTINUE_ON_ERROR_GATE: {
    pos: [W(J({ id: 'test', extra: ['continue-on-error: true'] })),
      W(J({ id: 'x', extra: ['continue-on-error: true'] }) + J({ id: 'y', extra: ['needs: x'] }))],
    neg: [W(J({ id: 'experimental', extra: ['continue-on-error: true'] })), W(J({ id: 'test', extra: ['continue-on-error: false'] }))],
  },
  ALWAYS_OVERUSE: {
    pos: [mkSteps(...[1, 2, 3].map((n) => '- run: echo ' + n + '\n  if: always()')), W(J({ extra: ['if: ' + X('always()')] }))],
    neg: [mkSteps(...[1, 2].map((n) => '- run: echo ' + n + '\n  if: always()')), mkSteps('- run: echo\n  if: ' + X('!cancelled()'))],
  },
};
// Rule that cannot be triggered from valid input (guards a rule crash, never a user mistake).
const UNREACHABLE = new Set(['ANALYZER_INTERNAL_ERROR']);

test('catalog has 35+ unique, fully documented rule codes', () => {
  const codes = GITHUB_RULE_CATALOG.map((m) => m.code);
  assert.ok(codes.length >= 35, 'rule count ' + codes.length);
  assert.equal(new Set(codes).size, codes.length);
  for (const m of GITHUB_RULE_CATALOG) {
    assert.match(m.code, /^[A-Z][A-Z0-9_]+$/);
    assert.ok(m.impact.length > 10 && m.recommendation.length > 10, m.code);
    if (m.docs) assert.match(m.docs, /^https:\/\/docs\.github\.com\/actions/, m.code);
  }
});

test('every catalog rule has positive and negative cases', () => {
  for (const { code } of GITHUB_RULE_CATALOG) {
    if (UNREACHABLE.has(code)) continue;
    assert.ok(CASES[code]?.pos.length > 0 && CASES[code]?.neg.length > 0, 'missing cases for ' + code);
  }
  for (const code of Object.keys(CASES)) assert.ok(GITHUB_RULE_CATALOG.some((m) => m.code === code), 'unknown case ' + code);
});

for (const [code, { pos, neg }] of Object.entries(CASES)) {
  pos.forEach((yaml, i) => test(code + ' flags positive #' + (i + 1), () => {
    assert.ok(codesOf(yaml).includes(code), code + ' expected, got ' + JSON.stringify(codesOf(yaml)) + '\n' + yaml.slice(0, 300));
  }));
  neg.forEach((yaml, i) => test(code + ' ignores negative #' + (i + 1), () => {
    assert.ok(!codesOf(yaml).includes(code), code + ' unexpected\n' + yaml.slice(0, 300));
  }));
}

test('findings carry the full rich shape with docs and static evidence', () => {
  const finding = analyzeWorkflow(mkSteps('- uses: actions/checkout@v4')).findings.find((f) => f.code === 'ACTION_NOT_PINNED');
  assert.ok(finding);
  assert.equal(finding.category, 'security');
  assert.equal(finding.evidence, 'static');
  assert.equal(finding.verification, 'static-only');
  assert.equal(finding.snippet, 'actions/checkout@v4');
  assert.ok(finding.impact && finding.recommendation);
  assert.match(finding.docs, /^https:\/\/docs\.github\.com\/actions/);
});

test('step-level findings report the exact line', () => {
  const yaml = W(J({ steps: ['- run: echo ok', '- run: curl https://x.sh | sh'] }));
  const hit = analyzeWorkflow(yaml).findings.find((f) => f.code === 'CURL_PIPE_SHELL');
  assert.equal(hit.line, yaml.split('\n').findIndex((l) => l.includes('curl')) + 1);
});

test('isValidCron accepts valid and rejects boundary violations', () => {
  for (const ok of ['* * * * *', '0 0 * * 0', '59 23 31 12 6', '*/15 0-6 1,15 JAN-MAR MON-FRI', '5/10 * * * *', '0 0 1 jan sun']) {
    assert.equal(isValidCron(ok), true, ok);
  }
  for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 13 *', '* * * * 7',
    '5-1 * * * *', '*/0 * * * *', '*/x * * * *', '1-2-3 * * * *', '1//2 * * * *', '@daily']) {
    assert.equal(isValidCron(bad), false, bad);
  }
});
