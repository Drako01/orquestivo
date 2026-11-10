const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GITHUB_RULE_CATALOG } = require('../dist-test/core/github/rules/index.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const analysis = read('docs/ANALYSIS.md');
const documented = [...analysis.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
const catalogCodes = GITHUB_RULE_CATALOG.map((m) => m.code);

test('docs/ANALYSIS.md lists exactly the rule codes of the catalog', () => {
  assert.deepEqual([...documented].sort(), [...catalogCodes].sort());
});

test('rule counts quoted in the docs match the catalog', () => {
  const count = String(catalogCodes.length);
  assert.ok(analysis.includes('## Rule catalog (' + count + ' codes)'));
  for (const file of ['README.md', 'ARCHITECTURE.md', 'ROADMAP.md']) {
    const quoted = [...read(file).matchAll(/(\d+) (?:rule )?codes/g)].map((m) => m[1]);
    assert.ok(quoted.length > 0, file + ' no longer quotes the rule count');
    for (const n of quoted) assert.equal(n, count, file + ' quotes ' + n + ' rule codes');
  }
});
