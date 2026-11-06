import type { Category, Finding, Severity } from '../../core/types.js';
import { makeFinding } from '../../core/findings.js';

/** Static description of one rule; the single source of truth for severity, category, impact and fix advice. */
export interface RuleDef {
  readonly severity: Severity;
  readonly category: Category;
  readonly impact: string;
  readonly recommendation: string;
}
export type RuleCatalog<K extends string = string> = Readonly<Record<K, RuleDef>>;

/** Rules every YAML provider can emit regardless of dialect. */
export const COMMON_RULES = {
  YAML_INVALID: {
    severity: 'error', category: 'syntax',
    impact: 'The file cannot be parsed, so the CI system will reject it.',
    recommendation: 'Fix the YAML syntax error reported at this location.',
  },
  PIPELINE_ROOT_INVALID: {
    severity: 'error', category: 'syntax',
    impact: 'The pipeline definition must be a YAML mapping at the top level.',
    recommendation: 'Make the document a mapping of pipeline keys.',
  },
  SOURCE_TOO_LARGE: {
    severity: 'error', category: 'maintainability',
    impact: 'Oversized files are not analysed to keep the editor responsive.',
    recommendation: 'Split the pipeline into smaller files or templates.',
  },
  ANALYZER_FAILURE: {
    severity: 'error', category: 'syntax',
    impact: 'The file could not be analysed completely (for example an alias expansion bomb).',
    recommendation: 'Simplify the file structure; report the issue if the file is valid.',
  },
} as const satisfies RuleCatalog;
export type CommonRuleCode = keyof typeof COMMON_RULES;

/** Builds findings from a catalog so call sites only provide code, line and a message. */
export class FindingCollector<K extends string> {
  private readonly items: Finding[] = [];
  constructor(private readonly catalog: RuleCatalog<K>) {}

  add(code: K, line: number, message: string, snippet?: string, fix?: string): void {
    const rule = this.catalog[code];
    this.items.push(makeFinding({
      code, message, line: Math.max(1, line),
      severity: rule.severity, category: rule.category, impact: rule.impact, recommendation: rule.recommendation,
      ...(snippet !== undefined ? { snippet: snippet.slice(0, 200) } : {}),
      ...(fix !== undefined ? { fix } : {}),
    }));
  }
  get findings(): readonly Finding[] { return this.items; }
}
