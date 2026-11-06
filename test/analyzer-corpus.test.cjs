const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeWorkflow } = require('../dist-test/core/analyzer.js');
const { GITHUB_RULE_CATALOG } = require('../dist-test/core/github/rules/index.js');

const dir = path.join(__dirname, 'corpus');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const categoryOf = new Map(GITHUB_RULE_CATALOG.map((m) => [m.code, m.category]));
const FLOOR = 0.9;
const HOSTILE_BUDGET_MS = 2000;

const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const detected = (source) => new Set(analyzeWorkflow(source).findings.map((f) => f.code));
const ratio = (num, den) => (den === 0 ? 1 : num / den);

test('corpus has 20+ realistic workflows plus hostile inputs', () => {
  assert.ok(manifest.filter((e) => e.kind !== 'hostile').length >= 20);
  assert.ok(manifest.filter((e) => e.kind === 'hostile').length >= 5);
  for (const entry of manifest) assert.ok(fs.existsSync(path.join(dir, entry.file)), entry.file);
});

test('every manifest code is a known rule', () => {
  for (const entry of manifest) for (const code of entry.expected ?? []) assert.ok(categoryOf.has(code), code);
});

test('hostile and malformed inputs never throw and finish fast', () => {
  const letters = 'bcdefghijklmnopqrst'.split('');
  const generated = {
    'alias bomb': 'a: &a [1,2,3,4,5,6,7,8,9]\n' + letters.map((c, i) =>
      c + ': &' + c + ' [' + Array(9).fill('*' + (i === 0 ? 'a' : letters[i - 1])).join(',') + ']').join('\n'),
    'deep sequence': '['.repeat(200000),
    'deep mapping': Array.from({ length: 3000 }, (_, i) => ' '.repeat(i) + 'k' + i + ':').join('\n'),
    'oversized': 'a: ' + 'x'.repeat(3_000_000),
    'NUL bytes': 'on: push\n\u0000\u0000jobs:\n',
    'many documents': '---\non: push\n'.repeat(2000),
    'one huge line': 'on: [' + Array(50000).fill('push').join(',') + ']',
  };
  const inputs = [...manifest.filter((e) => e.kind === 'hostile').map((e) => [e.file, read(e.file)]), ...Object.entries(generated)];
  for (const [name, source] of inputs) {
    const started = performance.now();
    const result = analyzeWorkflow(source);
    const elapsed = performance.now() - started;
    assert.ok(Array.isArray(result.findings), name);
    assert.equal(result.executionVerified, false);
    assert.ok(elapsed < HOSTILE_BUDGET_MS, name + ' took ' + Math.round(elapsed) + 'ms');
  }
});

test('alias bomb is rejected with a finding instead of expanding', () => {
  const result = analyzeWorkflow(read('hostile-alias-bomb.yml'));
  assert.equal(result.syntaxValid, false);
  assert.ok(result.findings.some((f) => f.code === 'YAML_INVALID'));
});

test('corpus precision and recall meet the floors per category', () => {
  const stats = new Map();
  const bucket = (category) => {
    if (!stats.has(category)) stats.set(category, { tp: 0, fp: 0, fn: 0 });
    return stats.get(category);
  };
  const mismatches = [];
  for (const entry of manifest.filter((e) => e.expected !== null)) {
    const got = detected(read(entry.file));
    const expected = new Set(entry.expected);
    for (const code of got) {
      if (expected.has(code)) bucket(categoryOf.get(code)).tp++;
      else { bucket(categoryOf.get(code)).fp++; mismatches.push(entry.file + ' unexpected ' + code); }
    }
    for (const code of expected) {
      if (!got.has(code)) { bucket(categoryOf.get(code)).fn++; mismatches.push(entry.file + ' missing ' + code); }
    }
  }
  const perCategory = {};
  let total = { tp: 0, fp: 0, fn: 0 };
  for (const [category, s] of [...stats].sort()) {
    perCategory[category] = { ...s, precision: ratio(s.tp, s.tp + s.fp), recall: ratio(s.tp, s.tp + s.fn) };
    total = { tp: total.tp + s.tp, fp: total.fp + s.fp, fn: total.fn + s.fn };
  }
  const overall = { ...total, precision: ratio(total.tp, total.tp + total.fp), recall: ratio(total.tp, total.tp + total.fn) };
  const reportDir = process.env.ORQUESTIVO_REPORT_DIR;
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    const report = {
      generatedAt: new Date().toISOString(),
      files: manifest.length,
      ruleCount: GITHUB_RULE_CATALOG.length,
      floor: FLOOR,
      overall,
      perCategory,
      mismatches,
    };
    fs.writeFileSync(path.join(reportDir, 'analyzer-metrics.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert.ok(Object.keys(perCategory).length >= 4, 'corpus must cover several categories');
  for (const [category, s] of Object.entries(perCategory)) {
    assert.ok(s.precision >= FLOOR, category + ' precision ' + s.precision + ' ' + mismatches.join('; '));
    assert.ok(s.recall >= FLOOR, category + ' recall ' + s.recall + ' ' + mismatches.join('; '));
  }
});
