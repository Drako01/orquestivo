const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../scripts/governance-check.mjs');
const reviewers = { type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 1 } }] };
const protectedEnv = (name) => ({ name, protection_rules: [reviewers], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
const ruleset = (over = {}) => ({ name: 'Protect main', enforcement: 'active', rules: [{ type: 'pull_request' }, { type: 'required_status_checks' }], ...over });
const expectedEnvironments = ['marketplace', 'open-vsx', 'github-release'];

test('governance: fully protected environments and ruleset pass', async () => {
  const { evaluateGovernance } = await load();
  assert.deepEqual(evaluateGovernance({ expectedEnvironments, environments: expectedEnvironments.map(protectedEnv), rulesets: [ruleset()] }), []);
});

test('governance: the exact misconfiguration found by the audit is reported', async () => {
  const { evaluateGovernance } = await load();
  const open = (name) => ({ name, protection_rules: [], deployment_branch_policy: null });
  const problems = evaluateGovernance({ expectedEnvironments, environments: expectedEnvironments.map(open), rulesets: [ruleset()] });
  assert.equal(problems.length, 6);
  assert.ok(problems.some((p) => p.includes('"marketplace" has no required reviewers')));
  assert.ok(problems.some((p) => p.includes('"open-vsx" has no deployment branch policy')));
});

test('governance: missing environment, disabled or incomplete ruleset are reported', async () => {
  const { evaluateGovernance } = await load();
  const problems = evaluateGovernance({
    expectedEnvironments: ['marketplace'], environments: [],
    rulesets: [ruleset({ enforcement: 'disabled', rules: [{ type: 'deletion' }] })],
  });
  assert.equal(problems.length, 4);
  assert.ok(evaluateGovernance({ expectedEnvironments: [], environments: [], rulesets: [] }).some((p) => p.includes('does not exist')));
});

test('governance: environments are derived from publish.yml, never hard-coded', async () => {
  const { environmentsUsedBy } = await load();
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/publish.yml'), 'utf8');
  assert.deepEqual(environmentsUsedBy(workflow).sort(), ['github-release', 'marketplace', 'open-vsx']);
});
