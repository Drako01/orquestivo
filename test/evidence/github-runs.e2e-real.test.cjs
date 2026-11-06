// Real GitHub API check. BLOCKED in this environment: there is no network access and no
// credentials. It is skipped with an explicit reason and MUST NOT be reported as a pass.
// To run it: set ORQUESTIVO_E2E_GITHUB_TOKEN and ORQUESTIVO_E2E_GITHUB_REPO=owner/repo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubRunsClient } = require('../../dist-test/core/evidence/github-runs.js');

const token = process.env.ORQUESTIVO_E2E_GITHUB_TOKEN;
const slug = process.env.ORQUESTIVO_E2E_GITHUB_REPO;
const skip = token && slug ? false : 'BLOCKED: real GitHub e2e needs network and ORQUESTIVO_E2E_GITHUB_TOKEN/ORQUESTIVO_E2E_GITHUB_REPO (not available); result is NOT a pass';

test('e2e-real: lists workflow runs against api.github.com', { skip }, async () => {
  const [owner, repo] = slug.split('/');
  const client = new GitHubRunsClient({ fetch: (url, init) => fetch(url, init), tokens: { getToken: async () => token } });
  const out = await client.listWorkflowRuns({ owner, repo }, {}, { limit: 3 });
  assert.ok(Array.isArray(out.items));
});
