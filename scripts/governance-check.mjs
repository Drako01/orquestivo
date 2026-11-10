#!/usr/bin/env node
// Repository governance check (read-only, needs the GitHub API through the `gh` CLI).
// Verifies that the controls the release documentation relies on are actually configured:
//   - every environment used by publish.yml exists, has required reviewers and a deployment branch policy;
//   - the "Protect main" ruleset is active and requires pull requests plus status checks.
// If the API cannot be read the result is BLOCKED, never PASS. Security-and-analysis settings are only
// visible to repository admins, so they are reported as evidence when visible and never fail the step.
// Usage: node scripts/governance-check.mjs [--repo owner/name]
import { readFileSync } from 'node:fs';
import { ROOT, STATUS, abs, finish, isMain, parseArgs, readJson, run } from './lib/common.mjs';

const MAIN_RULESET = 'Protect main';

/** Environment names referenced by `environment:` keys of a workflow file. */
export function environmentsUsedBy(workflowText) {
  return [...new Set([...workflowText.matchAll(/^\s*environment:\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/gm)].map((m) => m[1]))];
}

/** Pure evaluation of the API payloads. Returns the problems found; an empty list means PASS. */
export function evaluateGovernance({ expectedEnvironments, environments, rulesets }) {
  const problems = [];
  for (const name of expectedEnvironments) {
    const env = environments.find((e) => e.name === name);
    if (!env) { problems.push(`environment "${name}" does not exist`); continue; }
    const reviewers = (env.protection_rules ?? []).filter((r) => r.type === 'required_reviewers' && (r.reviewers?.length ?? 0) > 0);
    if (reviewers.length === 0) problems.push(`environment "${name}" has no required reviewers`);
    if (!env.deployment_branch_policy) problems.push(`environment "${name}" has no deployment branch policy`);
  }
  const main = rulesets.find((r) => r.name === MAIN_RULESET);
  if (!main) problems.push(`ruleset "${MAIN_RULESET}" does not exist`);
  else {
    if (main.enforcement !== 'active') problems.push(`ruleset "${MAIN_RULESET}" is ${main.enforcement}, not active`);
    const types = new Set((main.rules ?? []).map((r) => r.type));
    for (const type of ['pull_request', 'required_status_checks']) if (!types.has(type)) problems.push(`ruleset "${MAIN_RULESET}" lacks the ${type} rule`);
  }
  return problems;
}

function repoSlug(flagValue) {
  if (flagValue) return flagValue;
  const url = readJson(abs('package.json')).repository?.url ?? '';
  return /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)?.[1];
}

function api(path) {
  const result = run('gh', ['api', path], { timeoutMs: 60000 });
  if (result.code !== 0) throw new Error(`gh api ${path} failed: ${result.output.trim().slice(0, 200)}`);
  return JSON.parse(result.output);
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs(process.argv.slice(2), ['repo']);
  const repo = repoSlug(values.repo);
  if (!repo) {
    finish('governance', STATUS.BLOCKED, { summary: 'repository slug could not be determined' });
  } else {
    try {
      const expectedEnvironments = environmentsUsedBy(readFileSync(abs('.github', 'workflows', 'publish.yml'), 'utf8'));
      const environments = api(`repos/${repo}/environments`).environments ?? [];
      const rulesets = api(`repos/${repo}/rulesets`).map((summary) => api(`repos/${repo}/rulesets/${summary.id}`));
      const problems = evaluateGovernance({ expectedEnvironments, environments, rulesets });
      const security = api(`repos/${repo}`).security_and_analysis;
      finish('governance', problems.length ? STATUS.FAIL : STATUS.PASS, {
        summary: problems.length ? `${problems.length} governance problem(s)` : `environments ${expectedEnvironments.join(', ')} and ruleset verified`,
        repo, problems, securityAndAnalysis: security ?? 'not visible with this token',
      });
    } catch (error) {
      finish('governance', STATUS.BLOCKED, { summary: 'GitHub API unavailable or not authorised', detail: String(error.message ?? error).slice(0, 300), root: ROOT });
    }
  }
}
