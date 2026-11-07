const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeWorkflow } = require('../../dist-test/core/analyzer.js');
const { expectGolden } = require('./golden-helper.cjs');

const CORPUS = path.join(__dirname, '..', 'corpus');
// Representative mix: clean, each bad family and hostile inputs. Findings are stored as `line CODE` lists.
const SAMPLES = [
  'good-node-ci.yml', 'good-release-deploy.yml', 'good-python-matrix.yml', 'bad-permissions.yml', 'bad-injection.yml',
  'bad-needs.yml', 'bad-matrix.yml', 'bad-expressions.yml', 'bad-pr-target.yml', 'hostile-unclosed-flow.yml',
  'hostile-duplicate-keys.yml', 'bad-structure.yml',
];

for (const file of SAMPLES) {
  test(`golden findings: ${file}`, () => {
    const source = fs.readFileSync(path.join(CORPUS, file), 'utf8');
    const result = analyzeWorkflow(source);
    const lines = [`syntaxValid: ${result.syntaxValid}`, `executionVerified: ${result.executionVerified}`,
      ...result.findings.map((f) => `${String(f.line).padStart(4)} ${f.severity.padEnd(11)} ${f.code}`)];
    expectGolden(`findings-${file.replace(/\.yml$/, '')}.txt`, lines.join('\n') + '\n');
  });
}
