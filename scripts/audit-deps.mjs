#!/usr/bin/env node
// `npm audit --omit=dev` wrapper. Needs the network: if the registry cannot be reached the
// result is BLOCKED, never PASS. Fails on vulnerabilities at or above --level (default high).
import { STATUS, finish, parseArgs, run } from './lib/common.mjs';

const { values } = parseArgs(process.argv.slice(2), ['level']);
const level = values.level ?? 'high';
const rank = ['info', 'low', 'moderate', 'high', 'critical'];
const result = run('npm', ['audit', '--omit=dev', '--json'], { timeoutMs: 120000 });
let report;
try { report = JSON.parse(result.output); } catch { /* reported as BLOCKED below */ }
const counts = report?.metadata?.vulnerabilities;
if (!counts || report?.error) {
  finish('audit', STATUS.BLOCKED, {
    summary: 'npm audit could not complete (registry unreachable or malformed response)',
    exitCode: result.code, detail: (report?.error?.summary ?? result.output).slice(0, 500),
  });
} else {
  const blocking = rank.slice(rank.indexOf(level)).reduce((n, severity) => n + (counts[severity] ?? 0), 0);
  finish('audit', blocking ? STATUS.FAIL : counts.total ? STATUS.WARN : STATUS.PASS, {
    summary: `${counts.total} vulnerabilities (${blocking} at or above ${level})`, counts, level,
  });
}
