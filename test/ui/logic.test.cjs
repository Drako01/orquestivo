const { test, assert } = require('./helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { parseWebviewMessage } = require('../../dist-test/ui/messages.js');
const { clampInt, toLine, parseExperienceLevel, ANALYSIS_LIMITS } = require('../../dist-test/ui/settings.js');
const { escapeHtml, safeHttpUrl } = require('../../dist-test/ui/escape.js');
const { lineBounds, planFixInsertion } = require('../../dist-test/ui/diagnostics.js');
const { parseGitHubRemote, parseRepoSlug, isPlausibleToken } = require('../../dist-test/ui/remote.js');
const { parseUndoRecord } = require('../../dist-test/ui/undo.js');
const wizard = require('../../dist-test/ui/wizard.js');
const { detectStack, generateCI, GeneratorOptionsError } = require('../../dist-test/core/generator.js');
const { githubActionsProvider } = require('../../dist-test/core/github/provider.js');

test('messages: accepts only well-formed messages', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'openLocation', file: 2, line: 10 }), { type: 'openLocation', file: 2, line: 10 });
  assert.deepEqual(parseWebviewMessage({ type: 'setLevel', level: 'expert' }), { type: 'setLevel', level: 'expert' });
  assert.deepEqual(parseWebviewMessage({ type: 'toggleFilter', dimension: 'category', value: 'security' }), { type: 'toggleFilter', dimension: 'category', value: 'security' });
  assert.deepEqual(parseWebviewMessage({ type: 'command', command: 'fetchRuns' }), { type: 'command', command: 'fetchRuns' });
});

test('messages: rejects hostile or malformed input', () => {
  const bad = [
    null, 'x', 5, [], {}, { type: 1 }, { type: 'nope' }, { type: 'openLocation', file: -1, line: 1 }, { type: 'openLocation', file: 1.5, line: 1 },
    { type: 'openLocation', file: 1, line: 0 }, { type: 'openLocation', file: 1, line: 1, extra: true }, { type: 'openLocation', file: '1', line: 1 },
    { type: 'openLocation', file: 1, line: 1e12 }, { type: 'setLevel', level: 'root' }, { type: 'command', command: 'rm -rf' },
    { type: 'toggleFilter', dimension: 'severity', value: 'security' }, { type: 'toggleFilter', dimension: 'x', value: 'error' },
    { type: 'explainFinding', file: 1 }, { type: 'clearFilters', x: 1 },
  ];
  for (const message of bad) assert.equal(parseWebviewMessage(message), undefined, JSON.stringify(message));
});

test('settings: numbers are clamped and levels validated', () => {
  assert.equal(clampInt(5000, ANALYSIS_LIMITS.maxFiles), 1000);
  assert.equal(clampInt(-3, ANALYSIS_LIMITS.maxFiles), 1);
  assert.equal(clampInt('x', ANALYSIS_LIMITS.maxFiles), 150);
  assert.equal(clampInt(NaN, ANALYSIS_LIMITS.maxFileBytes), 1048576);
  assert.equal(clampInt(12.9, ANALYSIS_LIMITS.maxFiles), 12);
  assert.equal(parseExperienceLevel('expert'), 'expert');
  assert.equal(parseExperienceLevel('god'), 'beginner');
  assert.equal(toLine(7), 7);
  for (const bad of [0, -1, 1.5, NaN, '3', undefined]) assert.equal(toLine(bad), 1);
});

test('settings: constants mirror package.json configuration schema', () => {
  const properties = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).contributes.configuration.properties;
  for (const [key, limits] of [['orquestivo.analysis.maxFiles', ANALYSIS_LIMITS.maxFiles], ['orquestivo.analysis.maxFileBytes', ANALYSIS_LIMITS.maxFileBytes]]) {
    assert.deepEqual([properties[key].minimum, properties[key].maximum, properties[key].default], [limits.min, limits.max, limits.fallback], key);
  }
  assert.equal(properties['orquestivo.remote.enabled'].default, false);
  assert.equal(properties['orquestivo.ai.enabled'].default, false);
  assert.deepEqual(properties['orquestivo.ui.experienceLevel'].enum, ['beginner', 'advanced', 'expert']);
});

test('escape: neutralises markup and rejects non-http URLs', () => {
  assert.equal(escapeHtml('<a href="x" onclick=\'y\'>&`'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;');
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined);
  assert.equal(safeHttpUrl('data:text/html,x'), undefined);
  assert.equal(safeHttpUrl('not a url'), undefined);
  assert.equal(safeHttpUrl('https://docs.github.com/x'), 'https://docs.github.com/x');
});

test('diagnostics: bounds clamp to the document and fixes keep indentation', () => {
  const src = 'a: 1\n  uses: x\n';
  assert.deepEqual(lineBounds(src, 2, 3), { line: 1, start: 2, end: 9 });
  assert.deepEqual(lineBounds(src, 999), { line: 2, start: 0, end: 0 });
  assert.deepEqual(planFixInsertion(src, 2, 'with:\n  k: v'), { line: 1, character: 9, text: '\n  with:\n    k: v' });
  assert.equal(planFixInsertion('a\r\nb', 1, 'x').text, '\r\nx');
});

test('remote: repo detection and token plausibility', () => {
  const config = '[core]\n\turl = nope\n[remote "upstream"]\n\turl = git@github.com:up/stream.git\n[remote "origin"]\n\turl = https://github.com/Drako01/orquestivo.git\n';
  assert.deepEqual(parseGitHubRemote(config), { owner: 'Drako01', repo: 'orquestivo' });
  assert.deepEqual(parseGitHubRemote('[remote "o"]\nurl = git@github.com:a/b.git'), { owner: 'a', repo: 'b' });
  assert.equal(parseGitHubRemote('[remote "o"]\nurl = https://gitlab.com/a/b.git'), undefined);
  assert.deepEqual(parseRepoSlug(' a/b.c '), { owner: 'a', repo: 'b.c' });
  for (const bad of ['a', 'a/b/c', '../x', 'a/..', 'a b/c', '']) assert.equal(parseRepoSlug(bad), undefined, bad);
  assert.equal(isPlausibleToken('ghp_abcdefghijklmnop'), true);
  for (const bad of ['short', 'has space in it', 'new\nline12345', 'x'.repeat(300)]) assert.equal(isPlausibleToken(bad), false);
});

test('undo: persisted records are validated', () => {
  const ok = { folderUri: 'file:///w', written: 'x', rollback: { kind: 'delete-file', path: '.github/workflows/orquestivo-ci.yml' } };
  assert.deepEqual(parseUndoRecord(ok), ok);
  assert.ok(parseUndoRecord({ ...ok, rollback: { kind: 'restore-content', path: '.github/workflows/a.yml', content: 'old' } }));
  for (const bad of [undefined, 1, {}, { ...ok, rollback: { kind: 'delete-file', path: '../../etc/passwd' } }, { ...ok, rollback: { kind: 'delete-file', path: '.github/workflows/../../x.yml' } },
    { ...ok, rollback: { kind: 'delete-file', path: 'src/extension.ts' } }, { ...ok, rollback: { kind: 'restore-content', path: '.github/workflows/a.yml' } }, { ...ok, written: 1 }]) {
    assert.equal(parseUndoRecord(bad), undefined, JSON.stringify(bad));
  }
});

test('wizard: file name validation and path building', () => {
  assert.equal(wizard.validateWorkflowFileName('orquestivo-ci.yml'), undefined);
  for (const bad of ['', 'a/b.yml', '..\\x.yml', '../x.yml', 'x.txt', '.hidden.yml', 'a b.yml']) assert.equal(wizard.validateWorkflowFileName(bad), 'wizardFileNameInvalid', bad);
  assert.equal(wizard.workflowRelativePath('x.yml'), '.github/workflows/x.yml');
  assert.equal(wizard.DEFAULT_WORKFLOW_FILE, 'orquestivo-ci.yml');
});

test('wizard: detection drives preset order and the built options generate a valid workflow', () => {
  const detection = detectStack(['package.json', 'package-lock.json', 'tsconfig.json'], { scripts: { test: 'x', build: 'y' }, devDependencies: { typescript: '5' } });
  const presets = wizard.orderedPresets(detection);
  assert.equal(presets[0].preset, 'typescript');
  assert.ok(presets[0].reasons.length > 0 && presets.length > 5);
  const detected = detection.primary;
  const options = wizard.buildGeneratorOptions({ preset: 'typescript', triggers: ['push', 'pullRequest'], operatingSystems: ['ubuntu'], steps: wizard.stepDefaults('typescript', detected), securityScan: 'audit', deployEnvironment: 'staging' }, detected);
  const yaml = generateCI(options);
  const analysis = githubActionsProvider.analyze(yaml);
  assert.equal(analysis.syntaxValid, true);
  assert.deepEqual(analysis.findings.filter((f) => f.severity === 'error'), []);
  assert.ok(yaml.includes('staging'));
});

test('wizard: unsupported options surface as GeneratorOptionsError, not silent output', () => {
  const options = wizard.buildGeneratorOptions({ preset: 'go', triggers: [], operatingSystems: ['ubuntu'], steps: ['test'], securityScan: 'none' }, undefined);
  assert.throws(() => generateCI(options), GeneratorOptionsError);
  assert.equal(wizard.supportsAudit('go'), false);
});
