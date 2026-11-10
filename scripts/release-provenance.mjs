#!/usr/bin/env node
// No-rebuild release handoff: pre-merge PR CI -> identical VSIX -> merge to main.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, ensureDir, readJson, isMain } from './lib/common.mjs';

export const SCHEMA = 'orquestivo.pr-preview/1';
const hex40 = /^[a-f0-9]{40}$/i;
const hex64 = /^[a-f0-9]{64}$/i;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const git = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
const numberId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

export function selectMergedPr(prs, sha) {
  const candidates = prs.filter((p) => p.state === 'closed' && p.merged_at &&
    p.merge_commit_sha === sha && p.base?.ref === 'main' &&
    numberId(p.number) && hex40.test(p.head?.sha ?? ''));
  assert(candidates.length === 1, 'no unique merged PR linked to this main commit');
  return candidates[0];
}

export function selectSuccessfulRun(runs, pr) {
  // GitHub can clear workflow_run.pull_requests after the PR is merged. An empty array
  // is NOT proof that a run was unrelated: the authoritative link is the merged PR's
  // exact head SHA, verified repository, workflow, event and pre-merge timestamp.
  // A non-empty association MUST still contain the expected PR number.
  const associated = (run) => Array.isArray(run.pull_requests) &&
    (run.pull_requests.length === 0 || run.pull_requests.some((p) => p.number === pr.number));
  const matches = runs.filter((r) => r.status === 'completed' && r.conclusion === 'success' &&
    r.event === 'pull_request' && r.path === '.github/workflows/ci.yml' &&
    r.head_sha === pr.head.sha && r.head_repository?.full_name === pr.base.repo.full_name &&
    associated(r) &&
    new Date(r.created_at).getTime() <= new Date(pr.merged_at).getTime() && numberId(r.id));
  matches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  assert(matches.length, 'no successful pre-merge PR CI for the exact head');
  return matches[0];
}

export function validateManifest(manifest, expected) {
  assert(manifest?.schema === SCHEMA, 'missing or incompatible VSIX provenance');
  for (const key of ['repository', 'prNumber', 'runId', 'headSha', 'treeSha', 'version'])
    assert(manifest[key] === expected[key], 'VSIX provenance mismatch: ' + key);
  assert(hex64.test(manifest.sha256 ?? '') && manifest.sha256 === expected.sha256,
    'VSIX SHA-256 does not match the pre-merge package');
  return true;
}

async function get(path) {
  assert(process.env.GH_TOKEN, 'GH_TOKEN is required');
  const res = await fetch('https://api.github.com/' + path, {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'orquestivo-release-provenance' },
    signal: AbortSignal.timeout(20000),
  });
  assert(res.ok, 'GitHub API request failed (' + res.status + '): ' + path.split('?')[0]);
  return res.json();
}

function context() {
  const repository = process.env.GITHUB_REPOSITORY, mainSha = process.env.GITHUB_SHA;
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''), 'invalid repository');
  assert(hex40.test(mainSha ?? '') && process.env.GITHUB_REF === 'refs/heads/main', 'main only');
  assert(git('HEAD') === mainSha, 'checkout is not the main release SHA');
  return { repository, mainSha, treeSha: git('HEAD^{tree}'),
    version: readJson(join(ROOT, 'package.json')).version };
}

async function mergedPr(ctx) {
  return selectMergedPr(await get('repos/' + ctx.repository + '/commits/' + ctx.mainSha + '/pulls'), ctx.mainSha);
}
async function successfulRun(ctx, pr) {
  const qs = new URLSearchParams({ event: 'pull_request', head_sha: pr.head.sha, per_page: '100' });
  const data = await get('repos/' + ctx.repository + '/actions/workflows/ci.yml/runs?' + qs);
  return selectSuccessfulRun(data.workflow_runs ?? [], pr);
}
const digest = () => createHash('sha256').update(readFileSync(join(ROOT, 'orquestivo.vsix'))).digest('hex');
const manifestFile = () => join(ROOT, 'reports', 'pr-preview-provenance.json');
function output(key, value) {
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n', { flag: 'a' });
  console.log(key + '=' + value);
}

async function main(mode) {
  if (mode === 'stamp') {
    assert(process.env.GITHUB_EVENT_NAME === 'pull_request', 'stamp allowed only on PR CI');
    const repository = process.env.GITHUB_REPOSITORY, prNumber = Number(process.env.PR_NUMBER);
    const headSha = process.env.PR_HEAD_SHA, runId = Number(process.env.GITHUB_RUN_ID);
    assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') &&
      numberId(prNumber) && numberId(runId) && hex40.test(headSha ?? ''), 'invalid PR identity');
    ensureDir(join(ROOT, 'reports'));
    const manifest = { schema: SCHEMA, repository, prNumber, runId, headSha,
      treeSha: git('HEAD^{tree}'), version: readJson(join(ROOT, 'package.json')).version, sha256: digest() };
    writeFileSync(manifestFile(), JSON.stringify(manifest, null, 2) + '\n');
    console.log('Stamped PR CI ' + runId + ' tree ' + manifest.treeSha);
  } else if (mode === 'resolve') {
    const ctx = context(), pr = await mergedPr(ctx), run = await successfulRun(ctx, pr);
    output('run_id', run.id);
    console.log('Successful CI run #' + run.id + ' for merged PR #' + pr.number);
  } else if (mode === 'verify') {
    const ctx = context(), manifest = readJson(manifestFile()), pr = await mergedPr(ctx);
    assert(pr.number === manifest.prNumber && numberId(manifest.runId), 'artifact PR/run mismatch');
    const run = await get('repos/' + ctx.repository + '/actions/runs/' + manifest.runId);
    assert(selectSuccessfulRun([run], pr).id === manifest.runId, 'artifact is not from the approved CI');
    validateManifest(manifest, { repository: ctx.repository, prNumber: pr.number, runId: run.id,
      headSha: pr.head.sha, treeSha: ctx.treeSha, version: ctx.version, sha256: digest() });
    console.log('Verified exact PR CI source tree, version and SHA-256 (run ' + run.id + ')');
  } else throw new Error('Usage: release-provenance.mjs stamp|resolve|verify');
}
if (isMain(import.meta.url)) main(process.argv[2]).catch((e) => {
  console.error('RELEASE_PROVENANCE_DENIED: ' + e.message);
  process.exitCode = 1;
});
