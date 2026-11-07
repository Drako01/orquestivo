#!/usr/bin/env node
// Bounded, dependency-free mutation testing for critical modules (see targets.json).
// Each mutant: mutate the TypeScript source text, compile it in memory with esbuild, drop the
// result into an isolated copy of dist-test/ + test/ (reports/.mutation/work) and run only the
// relevant test files. A mutant is KILLED when those tests fail (or time out), SURVIVED when they pass.
// Usage: node scripts/mutation/run.mjs [--max-mutants N] [--min-score PCT] [--target src/core/analyzer.ts] [--seed-offset N]
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { transform } from 'esbuild';
import { ROOT, STATUS, ensureDir, finish, parseArgs, posix, readJson, run, writeJson } from '../lib/common.mjs';
import { applyMutation, findMutations, sample } from './mutations.mjs';

const { values } = parseArgs(process.argv.slice(2), ['max-mutants', 'min-score', 'target']);
const config = readJson(join(ROOT, 'scripts', 'mutation', 'targets.json'));
const WORK = join(ROOT, 'reports', '.mutation', 'work');

const globToRegExp = (pattern) => new RegExp('^' + pattern.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
function expandTests(patterns) {
  const all = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'integration') walk(full); } else if (name.endsWith('.test.cjs')) all.push(posix(relative(ROOT, full)));
    }
  };
  walk(join(ROOT, 'test'));
  return all.filter((file) => patterns.some((p) => globToRegExp(p).test(file)));
}

const nodeTest = (files, timeoutMs) => run(process.execPath, ['--test', ...files], { cwd: WORK, timeoutMs });

async function mutateTarget(target, limits) {
  const sourcePath = join(ROOT, target.source);
  if (!existsSync(sourcePath)) return { source: target.source, status: STATUS.SKIP, reason: 'source file does not exist yet' };
  const tests = expandTests(target.tests);
  if (!tests.length) return { source: target.source, status: STATUS.SKIP, reason: 'no test files match the target' };
  const outRel = posix(relative('src', target.source)).replace(/\.ts$/, '.js');
  const outFile = join(WORK, 'dist-test', outRel);
  if (!existsSync(join(ROOT, 'dist-test', outRel))) return { source: target.source, status: STATUS.INCONCLUSIVE, reason: 'dist-test is stale or missing; run scripts/build-tests.mjs' };

  const original = readFileSync(sourcePath, 'utf8');
  const baseline = nodeTest(tests, limits.timeoutMs * 2);
  if (baseline.code !== 0) return { source: target.source, status: STATUS.FAIL, reason: 'baseline tests fail without mutation', tail: baseline.output.slice(-800) };

  const sites = findMutations(original);
  const chosen = sample(sites, limits.max);
  const mutants = [];
  const started = Date.now();
  for (const site of chosen) {
    const mutated = applyMutation(original, site);
    const mutant = { line: site.line, kind: site.kind, from: original.slice(site.start, site.end), to: site.replacement || '(removed)' };
    try {
      const { code } = await transform(mutated, { loader: 'ts', format: 'cjs', platform: 'node', target: 'node22', sourcefile: target.source });
      writeFileSync(outFile, code);
    } catch {
      mutants.push({ ...mutant, result: 'INVALID' });
      continue;
    }
    const result = nodeTest(tests, limits.timeoutMs);
    mutants.push({ ...mutant, result: result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'SURVIVED' : 'KILLED' });
    if (Date.now() - started > limits.budgetMs) { mutants.push({ result: 'BUDGET_EXCEEDED' }); break; }
  }
  cpSync(join(ROOT, 'dist-test', outRel), outFile); // restore the clean build inside the work copy
  const killed = mutants.filter((m) => m.result === 'KILLED' || m.result === 'TIMEOUT').length;
  const survived = mutants.filter((m) => m.result === 'SURVIVED').length;
  const score = killed + survived ? Math.round((killed / (killed + survived)) * 1000) / 10 : null;
  const floor = Number(values['min-score'] ?? target.minScore);
  return {
    source: target.source, tests, totalSites: sites.length, tried: mutants.length, killed, survived,
    invalid: mutants.filter((m) => m.result === 'INVALID').length, score, minScore: floor,
    status: score === null ? STATUS.INCONCLUSIVE : score >= floor ? STATUS.PASS : STATUS.FAIL,
    survivors: mutants.filter((m) => m.result === 'SURVIVED'),
  };
}

const build = run(process.execPath, [join(ROOT, 'scripts', 'build-tests.mjs')]);
if (build.code !== 0) {
  finish('mutation', STATUS.FAIL, { summary: 'test build failed', tail: build.output.slice(-800) });
} else {
  rmSync(WORK, { recursive: true, force: true });
  ensureDir(WORK);
  cpSync(join(ROOT, 'dist-test'), join(WORK, 'dist-test'), { recursive: true });
  cpSync(join(ROOT, 'test'), join(WORK, 'test'), { recursive: true });
  const limits = {
    max: Number(values['max-mutants'] ?? config.maxMutantsPerTarget), timeoutMs: config.mutantTimeoutMs, budgetMs: 8 * 60 * 1000,
  };
  const results = [];
  for (const target of config.targets.filter((t) => !values.target || t.source === values.target)) results.push(await mutateTarget(target, limits));
  rmSync(WORK, { recursive: true, force: true });
  const measured = results.filter((r) => r.score !== undefined && r.score !== null);
  const status = results.some((r) => r.status === STATUS.FAIL) ? STATUS.FAIL
    : !measured.length ? STATUS.INCONCLUSIVE
    : results.some((r) => r.status === STATUS.INCONCLUSIVE) ? STATUS.WARN : STATUS.PASS;
  const report = { limits, results };
  writeJson(join(ROOT, 'reports', 'mutation.json'), report);
  finish('mutation', status, {
    summary: results.map((r) => `${r.source}: ${r.status}${r.score != null ? ` score ${r.score}% (${r.killed} killed, ${r.survived} survived of ${r.tried})` : ` (${r.reason ?? 'no score'})`}`).join('; '),
    report: 'reports/mutation.json', results,
  });
}
