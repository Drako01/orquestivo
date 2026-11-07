const { dist, test, assert } = require('./helpers.cjs');
const { providerRegistry, createProviderRegistry, detectProvider, getProvider } = dist('registry.js');

test('registry: exposes all four providers by id', () => {
  assert.deepEqual(providerRegistry.allProviders.map((p) => p.id), ['github-actions', 'gitlab-ci', 'azure-pipelines', 'jenkins']);
  assert.equal(getProvider('jenkins').displayName, 'Jenkins');
  assert.equal(getProvider('nope'), undefined);
});

test('registry: detects the provider owning a path', () => {
  const cases = {
    '.github/workflows/ci.yml': 'github-actions',
    '.gitlab-ci.yml': 'gitlab-ci',
    'azure-pipelines.yml': 'azure-pipelines',
    'apps/api/Jenkinsfile': 'jenkins',
    'ci/release.jenkinsfile': 'jenkins',
  };
  for (const [path, id] of Object.entries(cases)) assert.equal(detectProvider(path)?.id, id, path);
  for (const path of ['README.md', 'package.json', '.github/dependabot.yml', '']) assert.equal(detectProvider(path), undefined, path);
});

test('registry: file patterns are the de-duplicated union of provider patterns', () => {
  const union = providerRegistry.allProviders.flatMap((p) => p.filePatterns);
  assert.deepEqual(providerRegistry.filePatterns, [...new Set(union)]);
  assert.ok(providerRegistry.filePatterns.includes('**/Jenkinsfile'));
});

test('registry: accepts injected providers and rejects duplicate ids', () => {
  const stub = { id: 's', displayName: 'S', filePatterns: ['s.yml'], matches: (p) => p === 's.yml', analyze: () => ({ findings: [], syntaxValid: true, executionVerified: false }), model: () => undefined };
  const registry = createProviderRegistry([stub]);
  assert.equal(registry.detectProvider('s.yml'), stub);
  assert.throws(() => createProviderRegistry([stub, stub]), /Duplicate/);
});
