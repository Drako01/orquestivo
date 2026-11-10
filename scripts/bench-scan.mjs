#!/usr/bin/env node
// Scan benchmark: analyses the realistic corpus workflows repeatedly, as the extension does for each file of a
// workspace, and reports per-file latency percentiles, total time and memory. Numbers depend on the machine, so
// this is a measurement tool (npm run bench), not a pass/fail gate; the budget test in test/perf is the gate.
// Usage: node scripts/bench-scan.mjs [--files 150,1000]
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { ROOT, STATUS, ensureDir, finish, parseArgs, writeJson } from './lib/common.mjs';

const require = createRequire(import.meta.url);
const { analyzeWorkflow } = require(join(ROOT, 'dist-test', 'core', 'analyzer.js'));
const { values } = parseArgs(process.argv.slice(2), ['files']);
const sizes = (values.files ?? '150,1000').split(',').map(Number);

const corpusDir = join(ROOT, 'test', 'corpus');
const corpus = readdirSync(corpusDir)
  .filter((name) => /^(good|bad)-.*\.yml$/.test(name))
  .map((name) => readFileSync(join(corpusDir, name), 'utf8'));

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const round = (n) => Math.round(n * 1000) / 1000;

function measure(fileCount) {
  const samples = [];
  let peakRss = process.memoryUsage().rss;
  const started = performance.now();
  for (let i = 0; i < fileCount; i++) {
    const t0 = performance.now();
    analyzeWorkflow(corpus[i % corpus.length]);
    samples.push(performance.now() - t0);
    if (i % 25 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    files: fileCount, totalMs: round(performance.now() - started),
    p50Ms: round(percentile(sorted, 50)), p95Ms: round(percentile(sorted, 95)), p99Ms: round(percentile(sorted, 99)),
    peakRssMb: Math.round(Math.max(peakRss, process.memoryUsage().rss) / 1048576),
  };
}

measure(50); // warm-up: JIT and module initialisation are not part of the measurement
const runs = sizes.map(measure);
const environment = {
  node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length,
  memoryGb: Math.round(totalmem() / 1073741824), dataset: `${corpus.length} corpus workflows cycled`,
};
ensureDir(join(ROOT, 'reports'));
writeJson(join(ROOT, 'reports', 'bench-scan.json'), { environment, runs });
console.table(runs);
finish('bench-scan', STATUS.PASS, { summary: runs.map((r) => `${r.files} files: p95 ${r.p95Ms} ms, total ${r.totalMs} ms, ${r.peakRssMb} MB`).join('; '), environment, runs });
