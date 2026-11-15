/** Pure recommendation planner and audit summary (no IO, no vscode). Turns real findings into an ordered plan. */
import type { Category, Finding, Severity } from './types.js';

export type Priority = 'P0' | 'P1' | 'P2';
/** `preview-required` only for findings with a verified fix; everything else stays `manual-only` (no apply button). */
export type AutomationLevel = 'safe-auto' | 'preview-required' | 'manual-only';

export interface PlannerFile {
  readonly id: number;
  readonly result: { readonly path: string; readonly findings: readonly Finding[] };
  /** Indexes of findings that have a verified, previewable fix (see `core/remediation`). */
  readonly fixable?: readonly number[] | undefined;
}

export interface Proposal {
  /** Stable per file path + rule + line. */
  readonly id: string;
  readonly fileId: number;
  /** Index of the finding inside its file result. */
  readonly index: number;
  readonly path: string;
  readonly line: number;
  readonly code: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly priority: Priority;
  readonly automation: AutomationLevel;
  /** What happens. */
  readonly message: string;
  /** Why it matters / what may happen if left as is. */
  readonly rationale: string;
  readonly recommendation: string;
  /** Mechanical suggestion from the rule, shown as guidance only. */
  readonly suggestion?: string;
  /** Always static here: the plan never claims runtime evidence. */
  readonly evidence: Finding['evidence'];
}

const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = { error: 0, warning: 1, information: 2 };

export function priorityOf(finding: Pick<Finding, 'severity' | 'category'>): Priority {
  if (finding.severity === 'error') return 'P0';
  if (finding.severity === 'warning') return finding.category === 'security' ? 'P0' : 'P1';
  return 'P2';
}

/** Ordered, de-duplicated proposals: P0 first, then severity, security first, then location. */
export function planRecommendations(files: readonly PlannerFile[]): readonly Proposal[] {
  const seen = new Set<string>();
  const proposals: Proposal[] = [];
  for (const file of files) {
    for (const [index, f] of file.result.findings.entries()) {
      const id = `${file.result.path}#${f.code}@${f.line}`;
      if (seen.has(id)) continue;
      seen.add(id);
      proposals.push({
        id, fileId: file.id, index, path: file.result.path, line: f.line, code: f.code, severity: f.severity,
        category: f.category, priority: priorityOf(f), automation: file.fixable?.includes(index) ? 'preview-required' : 'manual-only', message: f.message,
        rationale: f.impact, recommendation: f.recommendation, ...(f.fix ? { suggestion: f.fix } : {}), evidence: f.evidence,
      });
    }
  }
  return proposals.sort((a, b) =>
    a.priority.localeCompare(b.priority)
    || SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity]
    || Number(b.category === 'security') - Number(a.category === 'security')
    || a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code));
}

export type AuditStatus = 'not-evaluated' | 'no-ci' | 'attention' | 'partial' | 'no-findings';

export interface AuditInput {
  readonly trusted: boolean;
  readonly scanned: boolean;
  readonly files: readonly { readonly result: { readonly syntaxValid: boolean; readonly findings: readonly Finding[] } }[];
  readonly truncated: boolean;
}

const INCOMPLETE_CODES: ReadonlySet<string> = new Set(['FILE_UNSUPPORTED', 'FILE_LIMIT', 'FILE_READ', 'ANALYSIS_FAILED']);

export interface AuditSummary {
  readonly status: AuditStatus;
  /** Some files could not be fully analysed (limit, read error, parser failure) or the scan was cut. */
  readonly incomplete: boolean;
  readonly needsAttention: number;
  /** Findings that mean a file could not be read, was over the size limit, unsupported or failed to analyse. */
  readonly unreadable: number;
}

/** Honest result: absence of findings is "no findings in scope", never "perfect". */
export function summarizeAudit(input: AuditInput): AuditSummary {
  if (!input.trusted || !input.scanned) return { status: 'not-evaluated', incomplete: false, needsAttention: 0, unreadable: 0 };
  if (input.files.length === 0) return { status: 'no-ci', incomplete: false, needsAttention: 0, unreadable: 0 };
  const findings = input.files.flatMap((f) => f.result.findings);
  const unreadable = findings.filter((f) => INCOMPLETE_CODES.has(f.code)).length;
  const incomplete = input.truncated || unreadable > 0;
  const needsAttention = findings.filter((f) => f.severity !== 'information').length
    + input.files.filter((f) => !f.result.syntaxValid && f.result.findings.length === 0).length;
  if (needsAttention > 0) return { status: 'attention', incomplete, needsAttention, unreadable };
  return { status: incomplete ? 'partial' : 'no-findings', incomplete, needsAttention, unreadable };
}
