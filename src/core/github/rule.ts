import { makeFinding } from '../findings.js';
import type { Category, Finding, Severity } from '../types.js';

/** Static, per-code description of a rule. The single source of truth for severity, category and guidance. */
export interface RuleMeta {
  readonly code: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly impact: string;
  readonly recommendation: string;
  readonly docs?: string;
}

export const meta = (
  code: string, severity: Severity, category: Category,
  impact: string, recommendation: string, docs?: string,
): RuleMeta => ({ code, severity, category, impact, recommendation, ...(docs === undefined ? {} : { docs }) });

/** Optional per-occurrence details. */
export interface FindingExtra {
  readonly snippet?: string;
  readonly fix?: string;
  readonly column?: number;
}

export function toFinding(m: RuleMeta, message: string, line: number, extra: FindingExtra = {}): Finding {
  return makeFinding({ ...m, message, line, ...extra });
}
