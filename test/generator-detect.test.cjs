const test = require('node:test');
const assert = require('node:assert/strict');
const { detectStack, generateCI } = require('../dist-test/core/generator.js');

test('empty workspace has no recommendation', () => {
  const result = detectStack([]);
  assert.equal(result.primary, undefined);
  assert.deepEqual(result.recommendations, []);
});

test('plain node with npm lockfile', () => {
  const r = detectStack(['package.json', 'package-lock.json'], { scripts: { test: 'x' } });
  assert.equal(r.primary.preset, 'node');
  assert.deepEqual(r.primary.options, { test: true, build: false, lint: false });
  assert.deepEqual(r.warnings, []);
});

test('pnpm via lockfile, typescript via tsconfig', () => {
  const r = detectStack(['package.json', 'pnpm-lock.yaml', 'tsconfig.json']);
  assert.equal(r.primary.preset, 'typescript');
  assert.equal(r.primary.options.packageManager, 'pnpm');
});

test('packageManager field wins and multiple lockfiles warn', () => {
  const r = detectStack(['package.json', 'yarn.lock', 'package-lock.json'], { packageManager: 'npm@10.0.0' });
  assert.equal(r.primary.options.packageManager, undefined);
  assert.equal(r.warnings.length, 1);
  const y = detectStack(['package.json', 'yarn.lock']);
  assert.equal(y.primary.options.packageManager, 'yarn');
});

test('next and react are detected from config or dependencies', () => {
  assert.equal(detectStack(['package.json', 'next.config.mjs', 'package-lock.json']).primary.preset, 'next');
  assert.equal(detectStack(['package.json', 'package-lock.json'], { dependencies: { next: '15' } }).primary.preset, 'next');
  assert.equal(detectStack(['package.json', 'package-lock.json'], { devDependencies: { react: '19' } }).primary.preset, 'react');
});

test('missing lockfile warns', () => {
  assert.equal(detectStack(['package.json']).warnings.length, 1);
});

test('other stacks and docker together', () => {
  const r = detectStack(['go.mod', 'Dockerfile', 'pom.xml', 'composer.json', 'pyproject.toml']);
  assert.deepEqual(r.recommendations.map((x) => x.preset), ['go', 'python', 'java-maven', 'php', 'docker']);
  assert.equal(detectStack(['build.gradle.kts', 'gradlew']).primary.preset, 'java-gradle');
  assert.equal(detectStack(['build.gradle']).primary, undefined);
  assert.equal(detectStack(['build.gradle']).warnings.length, 1);
});

test('only root-level files count; Windows separators are normalized', () => {
  assert.equal(detectStack(['sub/go.mod', 'docs\\Dockerfile']).primary, undefined);
});

test('recommended options feed straight into the generator', () => {
  const r = detectStack(['package.json', 'pnpm-lock.yaml'], { scripts: { test: 'x', lint: 'y' } });
  const yaml = generateCI({ preset: r.primary.preset, ...r.primary.options });
  assert.ok(yaml.includes('pnpm run lint') && yaml.includes('pnpm test'));
});
