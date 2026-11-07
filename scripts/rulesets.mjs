#!/usr/bin/env node
/**
 * Orquestivo GitHub ruleset governance.
 * --check: offline checks only (default).
 * --status: read-only authenticated check against live GitHub. The ruleset API redacts bypass actors without write access.
 * --apply --confirm=Drako01/orquestivo: explicit maintainer action, requires GH_TOKEN with Administration: write.
 * Never writes tokens to disk or logs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repo = 'Drako01/orquestivo';
const base = 'https://api.github.com/repos/' + repo + '/rulesets';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const paths = [
  '.github/rulesets/protect-main.json',
  '.github/rulesets/protect-release-tags.json',
];
const requiredContexts = [
  'Verify (ubuntu-latest)',
  'Verify (windows-latest)',
  'Verify (macos-latest)',
];

const definitions = paths.map((path) => JSON.parse(readFileSync(resolve(root, path), 'utf8')));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validate() {
  if (definitions.length !== 2) throw new Error('Expected exactly two rulesets.');
  const [main, tags] = definitions;
  if (main.name !== 'Protect main' || main.target !== 'branch' || main.enforcement !== 'active' ||
      !equal(main.conditions?.ref_name?.include, ['~DEFAULT_BRANCH'])) {
    throw new Error('Protect main does not match the intended default-branch policy.');
  }
  if (tags.name !== 'Protect release tags' || tags.target !== 'tag' || tags.enforcement !== 'active' ||
      !equal(tags.conditions?.ref_name?.include, ['refs/tags/v*'])) {
    throw new Error('Protect release tags does not match the intended tag policy.');
  }
  if (!equal(main.bypass_actors, [{actor_id:5, actor_type:'RepositoryRole', bypass_mode:'pull_request'}]) ||
      !equal(tags.bypass_actors, [{actor_id:5, actor_type:'RepositoryRole', bypass_mode:'always'}])) {
    throw new Error('Admin bypass differs from the approved source rulesets.');
  }
  const mainTypes = main.rules.map((rule) => rule.type);
  const tagTypes = tags.rules.map((rule) => rule.type);
  if (!equal(mainTypes, ['deletion','non_fast_forward','required_linear_history','pull_request','required_status_checks']) ||
      !equal(tagTypes, ['update','deletion','non_fast_forward'])) {
    throw new Error('Rules are missing or have drifted from the approved reference.');
  }
  const review = main.rules.find((rule) => rule.type === 'pull_request')?.parameters;
  if (!review || review.required_approving_review_count !== 1 ||
      review.dismiss_stale_reviews_on_push !== true ||
      review.require_code_owner_review !== true ||
      review.require_last_push_approval !== true ||
      review.required_review_thread_resolution !== true ||
      review.require_extra_approval_for_unattributed_changes !== true ||
      !equal(review.allowed_merge_methods, ['squash'])) {
    throw new Error('PR review policy drifted.');
  }
  const status = main.rules.find((rule) => rule.type === 'required_status_checks')?.parameters;
  if (!status || status.strict_required_status_checks_policy !== false ||
      !equal(status.required_status_checks.map((c) => c.context).sort(), [...requiredContexts].sort()) ||
      status.required_status_checks.some((c) => c.integration_id !== 15368)) {
    throw new Error('CI requirements drifted from verified GitHub Actions checks.');
  }
}

function normalized(value) {
  if (Array.isArray(value)) {
    return value.map(normalized).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  }
  return value;
}
function comparable(ruleSet) {
  return {
    name:ruleSet.name,
    target:ruleSet.target,
    enforcement:ruleSet.enforcement,
    conditions:ruleSet.conditions,
    bypass_actors:ruleSet.bypass_actors ?? [],
    rules:ruleSet.rules.map((rule) => ({
      type:rule.type,
      ...(rule.parameters === undefined ? {} : {parameters:rule.parameters}),
    })),
  };
}
function equivalent(actual, desired) {
  return JSON.stringify(normalized(comparable(actual))) ===
    JSON.stringify(normalized(comparable(desired)));
}

async function api(url, method='GET', body, token) {
  const headers = {
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'Orquestivo-Ruleset-Governance',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method, headers, ...(body ? {body:JSON.stringify(body)} : {}),
    signal:AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const safe = token ? raw.replaceAll(token, '[REDACTED]') : raw;
    throw new Error('GitHub API ' + response.status + ': ' + safe.slice(0,1000));
  }
  return raw ? JSON.parse(raw) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--check';
  if (!['--check','--status','--apply'].includes(mode)) {
    throw new Error('Usage: node scripts/rulesets.mjs --check | --status | --apply --confirm=Drako01/orquestivo');
  }
  validate();
  if (mode === '--check') {
    if (args.length > 1) throw new Error('Unknown arguments.');
    console.log('Ruleset definitions validated: Protect main and Protect release tags.');
    return;
  }
  // GitHub omits bypass_actors from anonymous/low-permission responses, yielding false DRIFT.
  const token = mode === '--check' ? undefined : process.env.GH_TOKEN;
  if (mode === '--status' && !token) {
    throw new Error('Cannot fully verify rulesets without GH_TOKEN: GitHub hides bypass_actors from anonymous reads. Run with a token that can administer repository rulesets.');
  }
  if (mode === '--apply' &&
      (args.length !== 2 || args[1] !== '--confirm=Drako01/orquestivo' || !token)) {
    throw new Error('Applying changes requires --confirm=Drako01/orquestivo and a GH_TOKEN with Administration: write.');
  }
  if (mode === '--status' && args.length > 1) throw new Error('Unknown arguments.');
  const list = await api(base,'GET',undefined,token);
  let drift = false;
  for (const desired of definitions) {
    const ref = list.find((item) => item.name === desired.name && item.target === desired.target);
    const actual = ref ? await api(base+'/'+ref.id,'GET',undefined,token) : null;
    if (actual && equivalent(actual,desired)) {
      console.log('OK: '+desired.name);
      continue;
    }
    drift = true;
    if (mode === '--status') {
      console.log('DRIFT: '+desired.name+(ref ? ' differs from versioned definition' : ' is not installed'));
    } else if (ref) {
      await api(base+'/'+ref.id,'PUT',desired,token);
      console.log('UPDATED: '+desired.name);
    } else {
      await api(base,'POST',desired,token);
      console.log('CREATED: '+desired.name);
    }
  }
  if (mode === '--status' && drift) process.exitCode = 1;
  if (mode === '--apply') console.log('Check GitHub Settings > Rules > Rulesets, then rerun --status.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode=1;
});
