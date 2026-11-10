#!/usr/bin/env node
// Aggregate the exact 40-mutant deterministic sample across isolated GitHub Actions jobs.
// Fail closed on missing shards, incomplete samples, missing modules, or a score below the real floor.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, STATUS, finish, isMain, readJson, writeJson } from '../lib/common.mjs';

export const WRITE_PLAN = 'src/core/generation/write-plan.ts';
export const WRITE_PLAN_SLICES = 4;

export function aggregateMutationReports(config, shards) {
  const targets = config.targets;
  const seen = new Map();
  const required = ['mutation-rest', ...Array.from({ length: WRITE_PLAN_SLICES }, (_, n) => 'mutation-write-plan-' + n)];
  const actual = [...shards.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required.slice().sort()))
    throw new Error('Missing or unexpected mutation shards: ' + actual.join(', '));
  for (const [name, report] of shards) {
    if (!Array.isArray(report.results) || !report.results.length)
      throw new Error(name + ' has no mutation results');
    for (const result of report.results) {
      const target = targets.find((t) => t.source === result.source);
      if (!target || seen.get(result.source)?.some((s) => s.name === name))
        throw new Error(name + ' contains unknown/duplicate mutation target ' + result.source);
      const expectedCount = result.source === WRITE_PLAN ? WRITE_PLAN_SLICES : 1;
      const expectedIndex = result.source === WRITE_PLAN ? Number(name.replace('mutation-write-plan-', '')) : 0;
      if (result.source === WRITE_PLAN
        ? name !== 'mutation-write-plan-' + expectedIndex
        : name !== 'mutation-rest')
        throw new Error(name + ' has a result in the wrong artifact');
      if (result.status !== STATUS.PASS ||
          result.sliceCount !== expectedCount || result.sliceIndex !== expectedIndex ||
          result.minScore !== target.minScore ||
          !Number.isSafeInteger(result.totalSites) || result.totalSites < 1 ||
          result.sampledTotal !== Math.min(result.totalSites, config.maxMutantsPerTarget) ||
          !Number.isSafeInteger(result.tried) || !Number.isSafeInteger(result.killed) ||
          !Number.isSafeInteger(result.survived) || !Number.isSafeInteger(result.invalid) ||
          result.killed < 0 || result.survived < 0 || result.invalid < 0 ||
          result.tried !== result.killed + result.survived + result.invalid)
        throw new Error(name + ' reports incomplete, invalid, or non-PASS mutations for ' + result.source);
      const expectedMutants = Array.from({ length: result.sampledTotal }, (_, i) => i)
        .filter((i) => i % expectedCount === expectedIndex).length;
      if (result.tried !== expectedMutants)
        throw new Error(name + ' did not test every assigned mutant for ' + result.source);
      const collected = seen.get(result.source) ?? [];
      if (collected.some((s) => s.result.sliceIndex === result.sliceIndex))
        throw new Error('Duplicate mutation slice for ' + result.source);
      collected.push({ name, result });
      seen.set(result.source, collected);
    }
  }
  const results = targets.map((target) => {
    const shardsForTarget = seen.get(target.source) ?? [];
    const expectedCount = target.source === WRITE_PLAN ? WRITE_PLAN_SLICES : 1;
    if (shardsForTarget.length !== expectedCount)
      throw new Error('Missing mutation coverage for ' + target.source);
    const totalSites = shardsForTarget[0].result.totalSites;
    const sampledTotal = shardsForTarget[0].result.sampledTotal;
    if (shardsForTarget.some((s) => s.result.totalSites !== totalSites ||
      s.result.sampledTotal !== sampledTotal))
      throw new Error('Inconsistent sampled mutation population for ' + target.source);
    const killed = shardsForTarget.reduce((n, s) => n + s.result.killed, 0);
    const survived = shardsForTarget.reduce((n, s) => n + s.result.survived, 0);
    const invalid = shardsForTarget.reduce((n, s) => n + s.result.invalid, 0);
    if (killed + survived + invalid !== sampledTotal || killed + survived === 0)
      throw new Error('Incomplete/invalid scored mutation sample for ' + target.source);
    const score = Math.round((1000 * killed) / (killed + survived)) / 10;
    return { source: target.source, totalSites, tried: sampledTotal, killed, survived, invalid,
      score, minScore: target.minScore, status: score >= target.minScore ? STATUS.PASS : STATUS.FAIL };
  });
  return { status: results.every((r) => r.status === STATUS.PASS) ? STATUS.PASS : STATUS.FAIL,
    results, maxMutantsPerTarget: config.maxMutantsPerTarget };
}

if (isMain(import.meta.url)) {
  try {
    const directory = resolve(process.argv[2] ?? 'mutation-artifacts');
    const config = readJson(join(ROOT, 'scripts', 'mutation', 'targets.json'));
    const names = ['mutation-rest', ...Array.from({ length: WRITE_PLAN_SLICES }, (_, i) => 'mutation-write-plan-' + i)];
    const shards = new Map(names.map((name) => {
      const file = join(directory, name, 'mutation.json');
      if (!existsSync(file)) throw new Error('Mutation artifact missing: ' + name);
      return [name, readJson(file)];
    }));
    const report = aggregateMutationReports(config, shards);
    writeJson(join(ROOT, 'reports', 'mutation.json'), report);
    finish('mutation', report.status, { summary: report.results.map((r) =>
      r.source + ': ' + r.score + '% (min ' + r.minScore + '%)').join('; '),
      report: 'reports/mutation.json', results: report.results });
  } catch (error) {
    finish('mutation', STATUS.FAIL, { summary: String(error.message ?? error) });
  }
}
