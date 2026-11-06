import type { JobEvidence, RunEvidence } from './run-evidence.js';

/** Pure analytics over OBSERVED runs. Everything here is derived from remote evidence, not inferred from YAML. */
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const DECIDED_CONCLUSIONS = new Set(['success', ...FAILED_CONCLUSIONS]);
const INSTALL_STEP = /\b(?:install|npm ci|pnpm i|yarn|pip|bundle|restore dependencies|dependencies)\b/i;
const CACHE_STEP = /\bcache\b/i;
const MATRIX_SUFFIX = /\s*\(.*\)\s*$/;

export interface DurationStat {
  readonly name: string;
  readonly samples: number;
  readonly avgMs: number;
  readonly maxMs: number;
}

export interface RedundantJobGroup {
  readonly jobs: readonly string[];
  readonly stepSignature: readonly string[];
}

export interface CacheMissSuspicion {
  readonly job: string;
  readonly step: string;
  readonly avgMs: number;
  /** Heuristic label, never a proven cache miss. */
  readonly kind: 'slow-install-with-cache-step' | 'slow-install-without-cache-step';
}

export interface RunMetrics {
  readonly runCount: number;
  /** Runs with a definite success/failure conclusion (cancelled/skipped/in-progress are excluded). */
  readonly decidedCount: number;
  readonly failureRate: number | null;
  readonly durationP50Ms: number | null;
  readonly durationP95Ms: number | null;
  readonly slowestJobs: readonly DurationStat[];
  readonly slowestSteps: readonly DurationStat[];
  readonly redundantJobs: readonly RedundantJobGroup[];
  readonly cacheMissSuspicions: readonly CacheMissSuspicion[];
}

export interface MetricsOptions {
  readonly topN?: number;
  /** Install steps slower than this are flagged by the cache heuristic. */
  readonly slowInstallMs?: number;
}

export interface MetricsComparison {
  /** Positive = current is slower / worse. `null` when either side has no data. */
  readonly p50DeltaMs: number | null;
  readonly p95DeltaMs: number | null;
  readonly failureRateDelta: number | null;
  readonly slower: boolean;
  readonly moreFailures: boolean;
}

/** Nearest-rank percentile over unsorted input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

function rank(stats: Map<string, number[]>, topN: number): DurationStat[] {
  return [...stats.entries()]
    .map(([name, values]) => ({
      name,
      samples: values.length,
      avgMs: values.reduce((a, b) => a + b, 0) / values.length,
      maxMs: Math.max(...values),
    }))
    .sort((a, b) => b.avgMs - a.avgMs || a.name.localeCompare(b.name))
    .slice(0, topN);
}

const push = (map: Map<string, number[]>, key: string, value: number): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const baseJobName = (name: string): string => name.replace(MATRIX_SUFFIX, '');

function findRedundantJobs(runs: readonly RunEvidence[]): RedundantJobGroup[] {
  const latest = [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest) return [];
  // Matrix legs share step sets by design: collapse them into one logical job first.
  const logical = new Map<string, JobEvidence>();
  for (const job of latest.jobs) if (!logical.has(baseJobName(job.name))) logical.set(baseJobName(job.name), job);
  const groups = new Map<string, string[]>();
  for (const [name, job] of logical) {
    if (job.steps.length === 0) continue;
    const signature = JSON.stringify(job.steps.map((s) => s.name));
    groups.set(signature, [...(groups.get(signature) ?? []), name]);
  }
  return [...groups.entries()]
    .filter(([, jobs]) => jobs.length > 1)
    .map(([signature, jobs]) => ({ jobs, stepSignature: JSON.parse(signature) as string[] }));
}

function findCacheSuspicions(runs: readonly RunEvidence[], slowInstallMs: number): CacheMissSuspicion[] {
  const installs = new Map<string, number[]>();
  const hasCache = new Set<string>();
  for (const run of runs) {
    for (const job of run.jobs) {
      const name = baseJobName(job.name);
      for (const step of job.steps) {
        if (CACHE_STEP.test(step.name)) hasCache.add(name);
        else if (INSTALL_STEP.test(step.name) && step.durationMs !== null) push(installs, `${name}\u0000${step.name}`, step.durationMs);
      }
    }
  }
  const out: CacheMissSuspicion[] = [];
  for (const [key, values] of installs) {
    const avgMs = values.reduce((a, b) => a + b, 0) / values.length;
    if (avgMs < slowInstallMs) continue;
    const [job = '', step = ''] = key.split('\u0000');
    out.push({ job, step, avgMs, kind: hasCache.has(job) ? 'slow-install-with-cache-step' : 'slow-install-without-cache-step' });
  }
  return out.sort((a, b) => b.avgMs - a.avgMs);
}

export function analyzeRuns(runs: readonly RunEvidence[], options: MetricsOptions = {}): RunMetrics {
  const topN = options.topN ?? 5;
  const decided = runs.filter((r) => r.conclusion !== null && DECIDED_CONCLUSIONS.has(r.conclusion));
  const durations = decided.flatMap((r) => (r.status === 'completed' && r.durationMs !== null ? [r.durationMs] : []));
  const jobStats = new Map<string, number[]>();
  const stepStats = new Map<string, number[]>();
  for (const run of runs) {
    for (const job of run.jobs) {
      const name = baseJobName(job.name);
      if (job.durationMs !== null) push(jobStats, name, job.durationMs);
      for (const step of job.steps) if (step.durationMs !== null) push(stepStats, `${name} / ${step.name}`, step.durationMs);
    }
  }
  return {
    runCount: runs.length,
    decidedCount: decided.length,
    failureRate: decided.length === 0 ? null : decided.filter((r) => FAILED_CONCLUSIONS.has(r.conclusion ?? '')).length / decided.length,
    durationP50Ms: percentile(durations, 50),
    durationP95Ms: percentile(durations, 95),
    slowestJobs: rank(jobStats, topN),
    slowestSteps: rank(stepStats, topN),
    redundantJobs: findRedundantJobs(runs),
    cacheMissSuspicions: findCacheSuspicions(runs, options.slowInstallMs ?? 60_000),
  };
}

const delta = (before: number | null, after: number | null): number | null =>
  before === null || after === null ? null : after - before;

/** Historical comparison: `baseline` (older) versus `current` (newer) run sets. */
export function compareMetrics(baseline: RunMetrics, current: RunMetrics): MetricsComparison {
  const p50DeltaMs = delta(baseline.durationP50Ms, current.durationP50Ms);
  const p95DeltaMs = delta(baseline.durationP95Ms, current.durationP95Ms);
  const failureRateDelta = delta(baseline.failureRate, current.failureRate);
  return {
    p50DeltaMs,
    p95DeltaMs,
    failureRateDelta,
    slower: (p50DeltaMs ?? 0) > 0 || (p95DeltaMs ?? 0) > 0,
    moreFailures: (failureRateDelta ?? 0) > 0,
  };
}
