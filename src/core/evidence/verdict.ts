/**
 * Verdicts are deliberately strict: only an all-PASS set aggregates to PASS.
 * SKIP, WARN, INCONCLUSIVE and BLOCKED never become success.
 */
export type Verdict = 'PASS' | 'FAIL' | 'WARN' | 'SKIP' | 'INCONCLUSIVE' | 'BLOCKED';

/** Where a result comes from. Kept apart so observation is never confused with inference. */
export type EvidenceBasis = 'static-inference' | 'remote-evidence';

export interface EvidenceRef {
  readonly kind: 'workflow-line' | 'job' | 'step' | 'run' | 'artifact' | 'url';
  readonly ref: string;
}

export interface CheckResult {
  readonly id: string;
  readonly verdict: Verdict;
  readonly basis: EvidenceBasis;
  readonly message: string;
  readonly evidence: readonly EvidenceRef[];
}

/** Worst-first. */
const PRECEDENCE: readonly Verdict[] = ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'WARN', 'SKIP', 'PASS'];

export function aggregate(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return 'INCONCLUSIVE';
  return PRECEDENCE.find((candidate) => verdicts.includes(candidate)) ?? 'INCONCLUSIVE';
}

export function aggregateResults(results: readonly CheckResult[]): Verdict {
  return aggregate(results.map((r) => r.verdict));
}
