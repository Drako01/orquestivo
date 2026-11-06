export type Severity = 'error' | 'warning' | 'information';
/** `static`: derived from file contents only. `executed`: backed by a real run (never produced by static analysis). */
export type EvidenceKind = 'static' | 'executed';
export type Category =
  | 'syntax' | 'semantic' | 'configuration' | 'security' | 'reliability' | 'performance' | 'maintainability';
/** Verification layers; a static pass never implies `execution` or `outcome`. */
export type VerificationState = 'static-only' | 'execution-unverified' | 'executed-verified';

export interface Finding {
  /** Stable rule identifier, e.g. `ACTION_NOT_PINNED`. Never renamed once released. */
  readonly code: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly message: string;
  /** 1-based line. */
  readonly line: number;
  readonly column?: number;
  readonly evidence: EvidenceKind;
  /** Offending snippet / value that triggered the rule. */
  readonly snippet?: string;
  /** Why it matters. */
  readonly impact: string;
  /** What to do about it. */
  readonly recommendation: string;
  /** Optional mechanical fix suggestion (never applied without preview). */
  readonly fix?: string;
  readonly verification: VerificationState;
  readonly docs?: string;
}

export interface Analysis {
  readonly findings: readonly Finding[];
  readonly syntaxValid: boolean;
  readonly executionVerified: false;
}

export interface WorkflowFileResult extends Analysis {
  readonly path: string;
  readonly uri: string;
  /** Provider that analysed the file, e.g. `github-actions`. */
  readonly provider?: string;
}
