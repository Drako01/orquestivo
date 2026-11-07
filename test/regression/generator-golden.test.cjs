const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateCI, PRESETS } = require('../../dist-test/core/generator.js');
const { analyzeWorkflow } = require('../../dist-test/core/analyzer.js');
const { expectGolden } = require('./golden-helper.cjs');

for (const preset of PRESETS) {
  test(`golden: ${preset} preset with default options`, () => {
    const yaml = generateCI({ preset });
    expectGolden(`generator-${preset}.yml`, yaml);
    assert.equal(yaml, generateCI({ preset }), 'generation must be deterministic');
    assert.equal(analyzeWorkflow(yaml).syntaxValid, true);
  });
}
