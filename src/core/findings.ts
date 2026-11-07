import type { Category, Finding, Severity } from './types.js';

export interface FindingInput {
  readonly code: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly message: string;
  readonly line: number;
  readonly impact: string;
  readonly recommendation: string;
  readonly column?: number;
  readonly snippet?: string;
  readonly fix?: string;
  readonly docs?: string;
}

/** Single factory so every provider emits identically shaped, statically-evidenced findings. */
export function makeFinding(input: FindingInput): Finding {
  return { ...input, evidence: 'static', verification: 'static-only' };
}
