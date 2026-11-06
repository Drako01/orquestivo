// Shared golden-file helper: compare to test/regression/golden/<name>, or rewrite with UPDATE_GOLDEN=1.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const GOLDEN_DIR = path.join(__dirname, 'golden');

function expectGolden(name, actual) {
  const file = path.join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual);
    return;
  }
  assert.ok(fs.existsSync(file), `missing golden ${name}; run with UPDATE_GOLDEN=1`);
  assert.equal(actual, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `golden mismatch: ${name} (UPDATE_GOLDEN=1 to refresh)`);
}

module.exports = { expectGolden, GOLDEN_DIR };
