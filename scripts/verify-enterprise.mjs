#!/usr/bin/env node
// Orquestivo verification harness. Every step yields PASS / PASS_REUSED / FAIL / WARN / SKIP /
// INCONCLUSIVE / BLOCKED with evidence; the overall status is derived only from those results.
//
//   node scripts/verify-enterprise.mjs [--profile fast|platform|enterprise] [--only a,b] [--skip a,b]
//        [--changed [--base <ref>]] [--no-cache] [--strict] [--list]
//
// Exit code: 1 on any FAIL (with --strict: on anything other than PASS).
// Reports: reports/verify-enterprise.json, reports/verify-enterprise.md, reports/logs/<step>.log.
// Cache: PASS results are reused (as PASS_REUSED) only while the hash of the step's declared inputs,
// the Node version and the platform are unchanged. Release-artifact and network steps are never cached.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPORTS, ROOT, STATUS, STEP_DIR, ensureDir, isPass, listFiles, parseArgs, readJson, run, sha256, writeJson } from './lib/common.mjs';

const CACHE_DIR = join(REPORTS, '.cache');
const PROFILES = {
  fast: ['typecheck', 'lint', 'unit'],
  platform: ['typecheck', 'lint', 'unit', 'rulesets', 'build-prod'], // OS-sensitive subset for the Windows/macOS CI legs
  enterprise: null,
  'enterprise-ci': null, // exact enterprise gate minus separately sharded, fail-closed mutation gate
};
const TOOLCHAIN = ['package.json', 'package-lock.json', 'tsconfig.json'];

const hasPerfTests = () => listFiles('test/perf').some((f) => f.endsWith('.test.cjs'));
const script = (name, ...args) => ['node', [join('scripts', name), ...args]];

/** Step catalog. `inputs` drive cache keys and --changed selection (single source of truth). */
const STEPS = [
  { id: 'typecheck', title: 'TypeScript typecheck', cmd: ['npm', ['run', 'typecheck']], inputs: ['src', ...TOOLCHAIN] },
  { id: 'lint', title: 'ESLint (zero warnings)', cmd: ['npm', ['run', 'lint']], inputs: ['src', 'eslint.config.mjs', ...TOOLCHAIN] },
  { id: 'unit', title: 'Unit and contract tests', cmd: ['npm', ['test']], inputs: ['src', 'test', '.github', 'scripts/build-tests.mjs', 'scripts/rulesets.mjs', ...TOOLCHAIN] },
  { id: 'rulesets', title: 'Repository rulesets (offline check)', cmd: ['npm', ['run', 'rulesets:check']], inputs: ['.github', 'scripts/rulesets.mjs', 'package.json'] },
  { id: 'coverage', title: 'Coverage on original TypeScript vs thresholds', cmd: script('coverage.mjs'), inputs: ['src', 'test', 'scripts/coverage.mjs', 'scripts/coverage-thresholds.json', 'scripts/build-tests.mjs', ...TOOLCHAIN] },
  { id: 'mutation', title: 'Mutation testing of critical modules', cmd: script('mutation/run.mjs'), inputs: ['src', 'test', 'scripts/mutation', 'scripts/build-tests.mjs', ...TOOLCHAIN], timeoutMs: 25 * 60 * 1000 },
  { id: 'perf', title: 'Performance budgets (test/perf)', cmd: ['node', ['--test', 'test/perf/*.test.cjs']], inputs: ['src', 'test/perf', 'scripts/build-tests.mjs', ...TOOLCHAIN], required: false,
    prepare: () => (hasPerfTests() ? undefined : { status: STATUS.SKIP, summary: 'no test/perf/*.test.cjs yet' }), pre: script('build-tests.mjs') },
  { id: 'build-prod', title: 'Production bundle', cmd: ['npm', ['run', 'build:prod']], inputs: ['src', ...TOOLCHAIN], cache: false },
  { id: 'package', title: 'VSIX package', cmd: ['npx', ['--no-install', 'vsce', 'package', '--no-dependencies', '--out', 'orquestivo.vsix']], inputs: ['src', 'media', 'docs', '.vscodeignore', 'package.nls.json', 'package.nls.es.json', 'LICENSE', 'README.md', ...TOOLCHAIN], cache: false, needs: ['build-prod'] },
  { id: 'vsix-audit', title: 'VSIX content audit', cmd: script('vsix-audit.mjs'), inputs: ['scripts/vsix-audit.mjs', 'scripts/vsix-policy.json', 'orquestivo.vsix'], cache: false, needs: ['package'], report: 'vsix-audit' },
  { id: 'sha256', title: 'VSIX SHA-256 (write and verify)', cmd: script('vsix-checksum.mjs', 'write', 'orquestivo.vsix'), then: script('vsix-checksum.mjs', 'check', 'orquestivo.vsix'), inputs: ['orquestivo.vsix'], cache: false, needs: ['package'], report: 'sha256' },
  { id: 'sbom', title: 'SBOM (CycloneDX, offline)', cmd: script('sbom.mjs'), inputs: ['package-lock.json', 'package.json', 'scripts/sbom.mjs'], report: 'sbom' },
  { id: 'licenses', title: 'Production license audit', cmd: script('license-audit.mjs'), inputs: ['package-lock.json', 'scripts/license-policy.json', 'scripts/license-audit.mjs'], report: 'licenses' },
  { id: 'governance', title: 'Release governance (environments and ruleset, needs GitHub API)', cmd: script('governance-check.mjs'), inputs: ['.github', 'scripts/governance-check.mjs'], cache: false, report: 'governance' },
  { id: 'audit', title: 'npm audit (production, needs network)', cmd: script('audit-deps.mjs'), inputs: ['package-lock.json'], cache: false, report: 'audit' },
];

const { flags, values } = parseArgs(process.argv.slice(2), ['profile', 'only', 'skip', 'base']);
const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);
const profile = values.profile ?? 'enterprise';
if (!(profile in PROFILES)) throw new Error(`Unknown profile "${profile}" (fast | platform | enterprise | enterprise-ci)`);
for (const id of [...list(values.only), ...list(values.skip)]) if (!STEPS.some((s) => s.id === id)) throw new Error(`Unknown step "${id}". Known: ${STEPS.map((s) => s.id).join(', ')}`);
if (flags.has('list')) { for (const s of STEPS) console.log(`${s.id}\t${s.title}`); process.exit(0); }

const inProfile = (step) => (profile !== 'enterprise-ci' || step.id !== 'mutation') &&
  (!PROFILES[profile] || PROFILES[profile].includes(step.id));
const required = (step) => step.required !== false;

function changedFiles() {
  const base = values.base ?? ['origin/main', 'main'].find((ref) => run('git', ['rev-parse', '--verify', '--quiet', ref]).code === 0) ?? 'HEAD';
  const names = new Set();
  for (const args of [['diff', '--name-only', `${base}...HEAD`], ['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
    const result = run('git', args);
    if (result.code === 0) result.output.split(/\r?\n/).filter(Boolean).forEach((n) => names.add(n));
  }
  return { base, files: [...names] };
}
const impacted = (step, files) => files.some((f) => step.inputs.some((input) => f === input || f.startsWith(input.endsWith('/') ? input : input + '/')));

function inputsHash(step) {
  const parts = [step.id, process.version, process.platform, ...step.inputs.flatMap((input) => listFiles(input)).map((f) => `${f}:${sha256(readFileSync(join(ROOT, f)))}`)];
  return sha256(parts.join('\n'));
}

const readCache = (id) => { try { return readJson(join(CACHE_DIR, `${id}.json`)); } catch { return undefined; } };

// Stream the long mutation gate so GitHub Actions receives progress instead of waiting for a buffered process.
function runMutationStreaming(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const collect = (chunk) => {
      const part = String(chunk);
      process.stdout.write(part);
      output = (output + part).slice(-1024 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => { output = (output + String(error)).slice(-1024 * 1024); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, signal, output, timedOut });
    });
  });
}

async function execute(step) {
  const log = [];
  let outcome = { code: 0 };
  for (const [command, args] of [step.pre, step.cmd, step.then].filter(Boolean)) {
    const executable = command === 'node' ? process.execPath : command;
    const result = step.id === 'mutation' ? await runMutationStreaming(executable, args, step.timeoutMs)
      : run(executable, args, { timeoutMs: step.timeoutMs });
    log.push(`$ ${command} ${args.join(' ')}\n${result.output}`);
    outcome = result;
    if (result.code !== 0) break;
  }
  writeFileSync(join(REPORTS, 'logs', `${step.id}.log`), log.join('\n'));
  const stepReport = step.report && existsSync(join(STEP_DIR, `${step.report}.json`)) ? readJson(join(STEP_DIR, `${step.report}.json`)) : undefined;
  if (stepReport && stepReport.generatedAt >= started) return { status: stepReport.status, evidence: stepReport.evidence };
  const tail = outcome.output.trim().split(/\r?\n/).slice(-6).join('\n');
  if (outcome.timedOut) return { status: STATUS.FAIL, evidence: { summary: 'timed out', exitCode: outcome.code, tail } };
  return { status: outcome.code === 0 ? STATUS.PASS : STATUS.FAIL, evidence: { summary: outcome.code === 0 ? 'exit code 0' : `exit code ${outcome.code}`, exitCode: outcome.code, tail } };
}

ensureDir(join(REPORTS, 'logs')); ensureDir(CACHE_DIR); ensureDir(STEP_DIR);
const started = new Date().toISOString();
const only = list(values.only), skip = list(values.skip);
const changed = flags.has('changed') ? changedFiles() : undefined;
const results = [];

for (const step of STEPS) {
  const entry = { id: step.id, title: step.title, required: required(step) && inProfile(step) };
  const skipWith = (why) => results.push({ ...entry, status: STATUS.SKIP, evidence: { summary: why }, durationMs: 0 });
  if (!inProfile(step) && !only.includes(step.id)) { skipWith(`not part of profile "${profile}"`); continue; }
  if (only.length && !only.includes(step.id)) { skipWith('excluded by --only'); continue; }
  if (skip.includes(step.id)) { skipWith('excluded by --skip'); continue; }
  const key = inputsHash(step);
  const cached = flags.has('no-cache') || step.cache === false ? undefined : readCache(step.id);
  const reusable = cached?.key === key && cached.status === STATUS.PASS;
  if (changed && !impacted(step, changed.files) && !reusable) { skipWith(`not impacted by changes vs ${changed.base}`); continue; }
  if (reusable) {
    results.push({ ...entry, status: STATUS.PASS_REUSED, durationMs: 0, evidence: { ...cached.evidence, reusedFrom: cached.at, inputsHash: key } });
    continue;
  }
  const blockedBy = (step.needs ?? []).map((id) => results.find((r) => r.id === id)).find((r) => r && !isPass(r.status) && r.status !== STATUS.WARN && r.status !== STATUS.SKIP);
  if (blockedBy) { results.push({ ...entry, status: STATUS.INCONCLUSIVE, durationMs: 0, evidence: { summary: `prerequisite ${blockedBy.id} is ${blockedBy.status}` } }); continue; }
  const early = step.prepare?.();
  if (early) { results.push({ ...entry, status: early.status, durationMs: 0, evidence: { summary: early.summary } }); continue; }
  const t0 = Date.now();
  console.log(`> ${step.id}: ${step.title}`);
  const { status, evidence } = await execute(step);
  console.log(`  ${status}${evidence.summary ? ' - ' + evidence.summary : ''}`);
  results.push({ ...entry, status, evidence: { ...evidence, inputsHash: key }, durationMs: Date.now() - t0 });
  if (status === STATUS.PASS && step.cache !== false) writeJson(join(CACHE_DIR, `${step.id}.json`), { key, status, at: new Date().toISOString(), evidence });
}

const has = (status) => results.some((r) => r.status === status);
const requiredSkipped = results.some((r) => r.required && r.status === STATUS.SKIP);
const overall = has(STATUS.FAIL) ? 'FAIL' : has(STATUS.BLOCKED) ? 'BLOCKED' : has(STATUS.INCONCLUSIVE) || requiredSkipped ? 'INCONCLUSIVE' : has(STATUS.WARN) ? 'WARN' : 'PASS';
const git = (...args) => { const r = run('git', args); return r.code === 0 ? r.output.trim() : null; };
const report = {
  schema: 'orquestivo.verify-enterprise/1', generatedAt: new Date().toISOString(), profile, overall,
  scope: { only, skip, changed: changed ? { base: changed.base, files: changed.files.length } : null, complete: !requiredSkipped },
  environment: { node: process.version, platform: process.platform, ci: Boolean(process.env.CI) },
  commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), strict: flags.has('strict'),
  steps: results,
};
writeJson(join(REPORTS, 'verify-enterprise.json'), report);

const md = [
  `# Orquestivo verification (${profile})`, '',
  `Overall: **${overall}** | commit \`${report.commit?.slice(0, 12) ?? 'unknown'}\`${report.dirty ? ' (dirty tree)' : ''} | Node ${process.version} | ${process.platform} | ${report.generatedAt}`, '',
  report.scope.complete ? '' : '> Scope is partial: at least one required step did not run, so the overall status cannot be PASS.', '',
  '| Step | Required | Status | Evidence |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.required ? 'yes' : 'no'} | ${r.status} | ${(r.evidence.summary ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')}${r.evidence.reusedFrom ? ` (original run ${r.evidence.reusedFrom})` : ''} |`), '',
  'Logs: `reports/logs/<step>.log`. PASS_REUSED means inputs, Node version and platform are unchanged since the original PASS.', '',
];
writeFileSync(join(REPORTS, 'verify-enterprise.md'), md.join('\n'));
console.log(`\nOverall: ${overall}  (reports/verify-enterprise.md)`);
process.exitCode = has(STATUS.FAIL) || (flags.has('strict') && overall !== 'PASS') ? 1 : 0;
