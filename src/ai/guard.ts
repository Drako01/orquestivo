import type { RunEvidence } from '../core/evidence/run-evidence.js';

/**
 * Hard rule: AI text may never claim a pipeline works/passes unless real remote evidence of a
 * successful run exists. These patterns are intentionally broad (false positives are acceptable).
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(?:will|should|would|now|already|then)\s+(?:pass|work|succeed|run|be\s+(?:green|fixed|passing))/i,
  /\b(?:tests?|checks?|build|pipeline|workflow|ci|jobs?)\s+(?:now\s+|will\s+)?(?:pass(?:es|ed)?|succeed(?:s|ed)?|(?:is|are|will\s+be)\s+(?:green|passing|successful))\b/i,
  /\b(?:works?|worked|fixed|verified|validated|confirmed|guaranteed?)\b/i,
  /\bworking\b(?!\s+(?:directory|dir|tree))/i,
  /\b(?:green|passing)\b/i,
  /\bno\s+(?:more\s+)?errors?\b|\bsuccessfully\b|\bwithout\s+(?:any\s+)?(?:errors?|issues?|problems?)\b/i,
  /\bfunciona(?:r[aá]n?|n)?(?![\wáéíóúñ])|\bpasar[aá]n?(?![\wáéíóúñ])|\bpasa(?:n)?\b|\bex[ií]to(?:s[oa])?(?![\wáéíóúñ])|\bverificad[oa]s?\b|\bgarantiz|\bsin\s+errores\b|\bcorregid[oa]s?\b/i,
];

export function claimsExecutionSuccess(text: string): boolean {
  return CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/** True only when a real, completed, successful run was observed. */
export function hasSuccessEvidence(evidence: readonly RunEvidence[]): boolean {
  return evidence.some((run) => run.status === 'completed' && run.conclusion === 'success');
}

export interface GuardedText {
  readonly text: string;
  readonly blocked: boolean;
  readonly removed: readonly string[];
}

const SENTENCE_BOUNDARY = /(?<=[.!?\n])\s+/;

/** Drops every sentence that claims execution success unless success evidence is supplied. */
export function guardAiText(text: string, evidence: readonly RunEvidence[] = []): GuardedText {
  if (hasSuccessEvidence(evidence)) return { text, blocked: false, removed: [] };
  const kept: string[] = [];
  const removed: string[] = [];
  for (const sentence of text.split(SENTENCE_BOUNDARY)) {
    (claimsExecutionSuccess(sentence) ? removed : kept).push(sentence);
  }
  return { text: kept.join(' ').trim(), blocked: removed.length > 0, removed };
}
