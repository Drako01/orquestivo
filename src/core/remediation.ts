/**
 * Pure, deterministic and deliberately tiny fix planner for existing GitHub Actions workflows.
 * It only builds a minimal text edit in memory (comments and unrelated lines untouched) and proves it
 * by re-analysing the result: the targeted finding must disappear and nothing new may appear.
 * It never touches the file system; writing is the job of `src/vscode/remediation.ts`.
 */
import { createHash } from 'node:crypto';
import type { TextKey } from '../i18n.js';
import { githubActionsProvider } from './github/provider.js';
import type { Finding } from './types.js';

export const FIXABLE_CODES: ReadonlySet<string> = new Set(['PERMISSIONS_UNDECLARED', 'TIMEOUT_UNSET']);
export const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_KEY_LOOKBACK = 4;

export interface FixPlan {
  readonly code: string;
  readonly before: string;
  readonly after: string;
  /** SHA-256 of `before`: the write is refused when the file no longer hashes to this value. */
  readonly sourceHash: string;
  readonly summaryKey: TextKey;
  readonly summaryParams: Readonly<Record<string, string | number>>;
}

export const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const eolOf = (source: string): string => (source.includes('\r\n') ? '\r\n' : '\n');
const KEY_LINE = /^(\s*)([A-Za-z0-9_.-]+):\s*(#.*)?$/;
const isBlankOrComment = (line: string): boolean => /^\s*(#.*)?$/.test(line);
const indentOf = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;

function insertLines(lines: readonly string[], at: number, added: readonly string[]): string[] {
  return [...lines.slice(0, at), ...added, ...lines.slice(at)];
}

function fixPermissions(source: string): { after: string; summaryKey: TextKey; summaryParams: Record<string, string> } | undefined {
  const lines = source.split(/\r?\n/);
  if (lines.some((l) => /^permissions\s*:/.test(l))) return undefined;
  const jobs = lines.flatMap((l, i) => (/^jobs:\s*(#.*)?$/.test(l) ? [i] : []));
  if (jobs.length !== 1 || jobs[0] === undefined) return undefined;
  const added = ['permissions:', '  contents: read', ''];
  return { after: insertLines(lines, jobs[0], added).join(eolOf(source)), summaryKey: 'fixSummaryPermissions', summaryParams: {} };
}

function fixTimeout(source: string, finding: Pick<Finding, 'line' | 'message'>): { after: string; summaryKey: TextKey; summaryParams: Record<string, string | number> } | undefined {
  const lines = source.split(/\r?\n/);
  const jobId = /Job "([^"]+)"/.exec(finding.message)?.[1];
  if (!jobId) return undefined;
  // The reported line is the job key or, depending on the YAML node, its first child: search upwards a few lines.
  let keyAt = finding.line - 1;
  while (keyAt >= 0 && finding.line - 1 - keyAt <= MAX_KEY_LOOKBACK && KEY_LINE.exec(lines[keyAt] ?? '')?.[2] !== jobId) keyAt -= 1;
  const key = keyAt >= 0 ? KEY_LINE.exec(lines[keyAt] ?? '') : null;
  if (!key || key[2] !== jobId || key[1] === undefined) return undefined;
  const parent = key[1].length;
  let child: number | undefined;
  let end = keyAt + 1;
  for (; end < lines.length; end += 1) {
    const line = lines[end] ?? '';
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) <= parent) break;
    child ??= indentOf(line);
    if (indentOf(line) === child && /^\s*timeout-minutes\s*:/.test(line)) return undefined;
  }
  const firstChild = lines.findIndex((l, i) => i > keyAt && !isBlankOrComment(l));
  if (child === undefined || firstChild < 0) return undefined;
  const added = [`${' '.repeat(child)}timeout-minutes: ${DEFAULT_TIMEOUT_MINUTES}`];
  return {
    after: insertLines(lines, firstChild, added).join(eolOf(source)),
    summaryKey: 'fixSummaryTimeout', summaryParams: { job: jobId, minutes: DEFAULT_TIMEOUT_MINUTES },
  };
}

function countCodes(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  return counts;
}

/** True when the edited text is still valid, fixed the target code and introduced no finding that was not there before. */
function proves(before: string, after: string, code: string): boolean {
  const a = githubActionsProvider.analyze(before);
  const b = githubActionsProvider.analyze(after);
  if (!b.syntaxValid) return false;
  const was = countCodes(a.findings);
  const now = countCodes(b.findings);
  if ((now.get(code) ?? 0) >= (was.get(code) ?? 0)) return false;
  return [...now].every(([c, n]) => n <= (was.get(c) ?? 0));
}

/** Builds a verified minimal fix for one finding of a GitHub Actions file, or undefined when none is provably safe. */
export function planFix(source: string, provider: string | undefined, finding: Pick<Finding, 'code' | 'line' | 'message'>): FixPlan | undefined {
  if (provider !== 'github-actions' || !FIXABLE_CODES.has(finding.code)) return undefined;
  const built = finding.code === 'PERMISSIONS_UNDECLARED' ? fixPermissions(source) : fixTimeout(source, finding);
  if (!built || built.after === source || !proves(source, built.after, finding.code)) return undefined;
  return { code: finding.code, before: source, after: built.after, sourceHash: hashText(source), summaryKey: built.summaryKey, summaryParams: built.summaryParams };
}

/** Indexes of the findings that have a verified fix; used to offer "apply" only where it can really work. */
export function fixableIndexes(source: string, provider: string | undefined, findings: readonly Finding[]): readonly number[] {
  if (provider !== 'github-actions') return [];
  return findings.flatMap((f, i) => (FIXABLE_CODES.has(f.code) && planFix(source, provider, f) ? [i] : []));
}
