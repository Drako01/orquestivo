import { createContext, parseWorkflow } from './github/context.js';
import type { ParseResult } from './github/context.js';
import { GITHUB_RULES } from './github/rules/index.js';
import { ANALYZER_INTERNAL_ERROR, WORKFLOW_ROOT_INVALID, YAML_INVALID, YAML_TOO_LARGE } from './github/rules/syntax.js';
import { toFinding } from './github/rule.js';
import type { Analysis, Finding } from './types.js';

const SYNTAX_META = { syntax: YAML_INVALID, root: WORKFLOW_ROOT_INVALID, 'too-large': YAML_TOO_LARGE } as const;

function syntaxFindings(parsed: Extract<ParseResult, { ok: false }>): Finding[] {
  return parsed.issues.map((issue) => toFinding(SYNTAX_META[parsed.reason], issue.message, issue.line));
}

/**
 * Deterministic, read-only analysis of a GitHub Actions workflow.
 * Never throws: hostile or malformed input yields findings. Findings never constitute execution evidence.
 */
export function analyzeWorkflow(source: string): Analysis {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) return { findings: syntaxFindings(parsed), syntaxValid: false, executionVerified: false };
  const findings: Finding[] = [];
  const ctx = createContext(parsed.root, parsed.lineAt, findings);
  for (const rule of GITHUB_RULES) {
    try {
      rule.check(ctx);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      findings.push(toFinding(ANALYZER_INTERNAL_ERROR, 'Rule "' + rule.id + '" failed: ' + reason, 1));
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, syntaxValid: true, executionVerified: false };
}
