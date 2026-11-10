#!/usr/bin/env node
// Bounded, dependency-free mutation testing for critical modules (see targets.json).
// Each mutant: mutate the TypeScript source text, compile it in memory with esbuild, drop the
// result into an isolated copy of dist-test/ + test/ (reports/.mutation/work) and run only the
// relevant test files. A mutant is KILLED when those tests fail (or time out), SURVIVED when they pass.
// Usage: node scripts/mutation/run.mjs [--max-mutants N] [--min-score PCT] [--target src/core/analyzer.ts] [--seed-offset N]
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { ROOT, STATUS, ensureDir, finish, parseArgs, posix, readJson, run, writeJson } from '../lib/common.mjs';
import { applyMutation, findMutations, sample } from './mutations.mjs';

const { flags, values } = parseArgs(process.argv.slice(2), ['max-mutants', 'min-score', 'target']);
const config = readJson(join(ROOT, 'scripts', 'mutation', 'targets.json'));
const inheritedRunId = process.env.ORQUESTIVO_MUTATION_RUN_ID;
const runId = inheritedRunId && /^orq-[0-9]+-[0-9]+$/.test(inheritedRunId)
  ? inheritedRunId : `orq-${process.pid}-${Date.now()}`;
const slug = (source) => source.replace(/[^a-zA-Z0-9_.-]/g, '_');
const RESULT_DIR = join(ROOT, 'reports', '.mutation', 'results', runId);
const WORK = join(ROOT, 'reports', '.mutation', 'work', runId, slug(values.target ?? 'all'));

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
    if (mutants.length % 10 === 0) console.log(`[mutation] ${target.source}: ${mutants.length}/${chosen.length} mutants`);
    if (Date.now() - started > limits.budgetMs) { mutants.push({ result: 'BUDGET_EXCEEDED' }); break; }
  }
  cpSync(join(ROOT, 'dist-test', outRel), outFile); // restore the clean build inside the work copy
  const killed = mutants.filter((m) => m.result === 'KILLED' || m.result === 'TIMEOUT').length;
  const survived = mutants.filter((m) => m.result === 'SURVIVED').length;
  const score = killed + survived ? Math.round((killed / (killed + survived)) * 1000) / 10 : null;
  const exhausted = mutants.some((m) => m.result === 'BUDGET_EXCEEDED');
  const floor = Number(values['min-score'] ?? target.minScore);
  return {
    source: target.source, tests, totalSites: sites.length, tried: mutants.length, killed, survived,
    invalid: mutants.filter((m) => m.result === 'INVALID').length, score, minScore: floor,
    status: exhausted || score === null ? STATUS.INCONCLUSIVE : score >= floor ? STATUS.PASS : STATUS.FAIL,
    survivors: mutants.filter((m) => m.result === 'SURVIVED'),
  };
}

const limits = {
  max: Number(values['max-mutants'] ?? config.maxMutantsPerTarget),
  timeoutMs: config.mutantTimeoutMs, budgetMs: 8 * 60 * 1000,
};
const selected = config.targets.filter((t) => !values.target || t.source === values.target);
if (!selected.length) {
  finish('mutation', STATUS.FAIL, { summary: `unknown target: ${values.target}` });
} else if (flags.has('worker')) {
  // The parent builds tests once. Each worker owns a different disposable work directory.
  rmSync(WORK, { recursive: true, force: true });
  ensureDir(WORK);
  let result;
  try {
    cpSync(join(ROOT, 'dist-test'), join(WORK, 'dist-test'), { recursive: true });
    cpSync(join(ROOT, 'test'), join(WORK, 'test'), { recursive: true });
    result = await mutateTarget(selected[0], limits);
  } catch (error) {
    result = { source: selected[0].source, status: STATUS.FAIL, reason: String(error?.message ?? error) };
  } finally {
    rmSync(WORK, { recursive: true, force: true });
  }
  writeJson(join(RESULT_DIR, `${slug(selected[0].source)}.json`), result);
  console.log(`[mutation] ${result.source}: ${result.status}${result.score == null ? '' : ` (${result.score}%)`}`);
  process.exitCode = result.status === STATUS.FAIL || result.status === STATUS.INCONCLUSIVE ? 1 : 0;
} else {
  const build = run(process.execPath, [join(ROOT, 'scripts', 'build-tests.mjs')]);
  if (build.code !== 0) {
    finish('mutation', STATUS.FAIL, { summary: 'test build failed', tail: build.output.slice(-800) });
  } else {
    const parsedConcurrency = Number(process.env.ORQUESTIVO_MUTATION_CONCURRENCY);
    const concurrency = Number.isInteger(parsedConcurrency) && parsedConcurrency >= 1
      ? Math.min(4, parsedConcurrency) : 4;
    const results = new Array(selected.length);
    let nextIndex = 0;
    const running = new Set();
    const cancel = () => {
      for (const child of running) child.kill('SIGTERM');
      process.exit(130); // stop dispatching new mutants after cancellation
    };
    process.once('SIGTERM', cancel);
    process.once('SIGINT', cancel);
    console.log(`[mutation] ${selected.length} targets, ${concurrency} isolated workers, ${limits.max} mutants/target`);
    async function workerLoop() {
      while (nextIndex < selected.length) {
        const index = nextIndex++;
        const target = selected[index];
        console.log(`[mutation] START ${target.source}`);
        results[index] = await new Promise((resolve) => {
          const childArgs = [fileURLToPath(import.meta.url), '--worker', '--target', target.source];
          if (values['max-mutants']) childArgs.push('--max-mutants', values['max-mutants']);
          if (values['min-score']) childArgs.push('--min-score', values['min-score']);
          const child = spawn(process.execPath, childArgs, {
            cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ORQUESTIVO_MUTATION_RUN_ID: runId },
          });
          running.add(child);
          let tail = '';
          for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
            const line = String(chunk);
            tail = (tail + line).slice(-1200);
            process.stdout.write(line);
          });
          child.on('error', (error) => { tail = (tail + String(error)).slice(-1200); });
          child.on('close', (code, signal) => {
            running.delete(child);
            const output = join(RESULT_DIR, `${slug(target.source)}.json`);
            try {
              const result = readJson(output);
              if (code !== 0 && result.status === STATUS.PASS) result.status = STATUS.FAIL;
              resolve(result);
            } catch {
              resolve({ source: target.source, status: STATUS.FAIL, reason: `worker failed (exit=${code}, signal=${signal ?? 'none'}): ${tail}` });
            }
          });
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => workerLoop()));
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
    rmSync(join(ROOT, 'reports', '.mutation', 'work', runId), { recursive: true, force: true });
    rmSync(RESULT_DIR, { recursive: true, force: true });
    const measured = results.filter((r) => r.score !== undefined && r.score !== null);
    const status = results.some((r) => r.status === STATUS.FAIL || r.status === STATUS.INCONCLUSIVE) ? STATUS.FAIL
      : !measured.length ? STATUS.INCONCLUSIVE
      : results.some((r) => r.status === STATUS.SKIP || r.status === STATUS.WARN) ? STATUS.WARN : STATUS.PASS;
    writeJson(join(ROOT, 'reports', 'mutation.json'), { limits, concurrency, results });
    finish('mutation', status, {
      summary: results.map((r) => `${r.source}: ${r.status}${r.score != null ? ` score ${r.score}% (${r.killed} killed, ${r.survived} survived of ${r.tried})` : ` (${r.reason ?? 'no score'})`}`).join('; '),
      report: 'reports/mutation.json', results,
    });
  }
}
