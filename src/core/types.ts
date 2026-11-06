export type Severity = 'error' | 'warning' | 'information';
export type EvidenceKind = 'static' | 'executed';

export interface Finding {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly line: number;
  readonly evidence: EvidenceKind;
}

export interface Analysis {
  readonly findings: readonly Finding[];
  readonly syntaxValid: boolean;
  readonly executionVerified: false;
}

export interface WorkflowFileResult extends Analysis {
  readonly path: string;
  readonly uri: string;
}
