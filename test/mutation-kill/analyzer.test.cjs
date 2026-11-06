const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeWorkflow } = require('../../dist-test/core/analyzer.js');
const { GITHUB_RULES } = require('../../dist-test/core/github/rules/index.js');
const { meta } = require('../../dist-test/core/github/rule.js');
const { toFinding } = require('../../dist-test/core/github/rule.js');

test('syntax-invalid input never claims validity or execution proof', () => {
  for (const source of ['name: CI\njobs:\n  broken: [', '- a\n- b\n', '']) {
    const result = analyzeWorkflow(source);
    assert.equal(result.syntaxValid, false, JSON.stringify(source));
    assert.equal(result.executionVerified, false, JSON.stringify(source));
    assert.ok(result.findings.length > 0);
  }
});

test('syntax findings map reason to the right stable code', () => {
  assert.equal(analyzeWorkflow('a: [').findings[0].code, 'YAML_INVALID');
  assert.equal(analyzeWorkflow('- a\n').findings[0].code, 'WORKFLOW_ROOT_INVALID');
});

test('valid input is syntaxValid and never execution-verified', () => {
  const result = analyzeWorkflow('name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n');
  assert.equal(result.syntaxValid, true);
  assert.equal(result.executionVerified, false);
});

test('a throwing rule is reported as ANALYZER_INTERNAL_ERROR with id and reason, never thrown', () => {
  const bad = { id: 'boom-rule', metas: [], check() { throw new Error('kaput'); } };
  const bad2 = { id: 'boom-string', metas: [], check() { throw 'plain'; } };
  GITHUB_RULES.push(bad, bad2);
  try {
    const result = analyzeWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n');
    const errors = result.findings.filter((f) => f.code === 'ANALYZER_INTERNAL_ERROR');
    assert.equal(errors.length, 2);
    assert.ok(errors.some((f) => f.message === 'Rule "boom-rule" failed: kaput'), JSON.stringify(errors));
    assert.ok(errors.some((f) => f.message === 'Rule "boom-string" failed: plain'), JSON.stringify(errors));
    assert.ok(errors.every((f) => f.line === 1));
  } finally {
    GITHUB_RULES.length -= 2;
  }
});

test('findings are sorted by ascending line (stable for equal lines)', () => {
  const m = meta('ZZ_TEST', 'information', 'maintainability', 'i', 'r');
  const rule = {
    id: 'order', metas: [m],
    check(ctx) {
      ctx.report(m, 'c', ['jobs', 'a', 'steps', 0]); ctx.report(m, 'a', ['jobs', 'a']); ctx.report(m, 'b', ['jobs']); ctx.report(m, 'd', ['on']);
    },
  };
  GITHUB_RULES.push(rule);
  try {
    const lines = analyzeWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n').findings.map((f) => f.line);
    for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1] <= lines[i], lines.join(','));
    assert.ok(lines.length >= 4);
  } finally {
    GITHUB_RULES.length -= 1;
  }
});
