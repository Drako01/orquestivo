const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Kept outside the mutation test globs: these read repository sources that the isolated mutation copy lacks.
test('safe-path is wired into every workspace write path (guards against dead security code)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/vscode/generator.ts'), 'utf8');
  assert.match(source, /resolveInside\(/);
  assert.equal((source.match(/isInsideFolder\(/g) ?? []).length, 3, 'definition + generate + undo');
});
