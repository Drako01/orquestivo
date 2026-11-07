const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const dist = (rel) => require('../../dist-test/providers/' + rel);
const codesOf = (provider, source) => provider.analyze(source).findings.map((f) => f.code);

/** Every finding must be fully documented and anchored to a line. */
function assertWellFormed(findings) {
  for (const f of findings) {
    assert.ok(f.line >= 1, f.code + ' line');
    assert.ok(f.impact && f.recommendation && f.category, f.code + ' docs');
    assert.equal(f.evidence, 'static');
    assert.equal(f.verification, 'static-only');
  }
}

/** rows: [code, positiveSource, negativeSource] -- positive must raise the code, negative must not. */
function ruleTable(provider, rows) {
  for (const [code, positive, negative] of rows) {
    test(provider.id + ': ' + code + ' fires/does not fire', () => {
      const hit = provider.analyze(positive);
      assert.ok(hit.findings.some((f) => f.code === code), code + ' expected in ' + JSON.stringify(hit.findings.map((f) => f.code)));
      assertWellFormed(hit.findings);
      assert.ok(!codesOf(provider, negative).includes(code), code + ' unexpected for negative case');
    });
  }
}

function hostileTests(provider, extra = []) {
  const deep = (open, close, n) => open.repeat(n) + close.repeat(n);
  const inputs = [
    '', ' ', '\n\n', '\u0000\u0001￾', 'null', '[]', '- a\n- b', '"str"', '{', '}', '}{', ':::', '- - - -',
    deep('[', ']', 5000), deep('{', '}', 5000), deep('(', ')', 5000), 'a: &a [x]\nb: [*a,*a,*a]',
    "'unterminated", '"""unterminated', '/* unterminated', 'a: !!binary |\n  ZZ', 'x'.repeat(50_000),
    '﻿' + 'pipeline {', 'stages:\n  - 1\n  - null\n  - [x]\n', 'jobs: 5', 'steps: {a: b}', 'pipeline { stages { stage } }',
    ...extra,
  ];
  test(provider.id + ': hostile inputs never throw', () => {
    for (const input of inputs) {
      const result = provider.analyze(input);
      assert.ok(Array.isArray(result.findings));
      assert.equal(result.executionVerified, false);
      assertWellFormed(result.findings);
      const model = provider.model(input);
      assert.ok(model === undefined || model.provider === provider.id);
    }
  });
  test(provider.id + ': oversized input is rejected without parsing', () => {
    const result = provider.analyze('#'.repeat(1_000_001));
    assert.deepEqual(result.findings.map((f) => f.code), ['SOURCE_TOO_LARGE']);
    assert.equal(result.syntaxValid, false);
    assert.equal(provider.model('#'.repeat(1_000_001)), undefined);
  });
}

/** Realistic fixtures must analyze without error findings and produce a model with jobs. */
function fixtureTests(provider, files) {
  for (const file of files) {
    test(provider.id + ': fixture ' + file + ' has zero errors', () => {
      const source = readFileSync(join(__dirname, 'fixtures', file), 'utf8');
      const analysis = provider.analyze(source);
      const errors = analysis.findings.filter((f) => f.severity === 'error');
      assert.deepEqual(errors, []);
      assert.equal(analysis.syntaxValid, true);
      assertWellFormed(analysis.findings);
      const model = provider.model(source);
      assert.ok(model && model.jobs.length > 0, 'model has jobs');
    });
  }
}

module.exports = { dist, codesOf, ruleTable, hostileTests, fixtureTests, assertWellFormed, test, assert, readdirSync };
