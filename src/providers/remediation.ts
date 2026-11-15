/**
 * Pure, deterministic fix planner for existing pipelines (GitHub Actions, GitLab CI, Azure Pipelines, Jenkins).
 * It builds a minimal text edit in memory (comments and unrelated lines untouched) and proves it by
 * re-analysing the result with the owning provider: the targeted finding must decrease, the file must stay
 * valid and no finding may appear that was not there before. It never touches the file system; writing is
 * the job of `src/vscode/remediation.ts`.
 */
import { createHash } from 'node:crypto';
import type { TextKey } from '../i18n.js';
import type { Finding } from '../core/types.js';
import { getProvider } from './registry.js';

export const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_KEY_LOOKBACK = 4;
const KEEP_BUILDS = 20;
/** Persisted undo records above this size stay in memory only. */
export const MAX_RECORD_CHARS = 400_000;

type Ref = Pick<Finding, 'code' | 'line' | 'message'>;
interface Built { readonly after: string; readonly summaryKey: TextKey; readonly summaryParams: Readonly<Record<string, string | number>> }
type Fixer = (source: string, finding: Ref) => Built | undefined;

export interface FixPlan extends Built {
  readonly code: string;
  readonly before: string;
  /** SHA-256 of `before`: the write is refused when the file no longer hashes to this value. */
  readonly sourceHash: string;
}

export const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const eolOf = (source: string): string => (source.includes('\r\n') ? '\r\n' : '\n');
const KEY_LINE = /^(\s*)([A-Za-z0-9_.-]+):\s*(#.*)?$/;
const isBlankOrComment = (line: string): boolean => /^\s*(#.*)?$/.test(line);
const indentOf = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;
const spaces = (n: number): string => ' '.repeat(n);
const split = (source: string): string[] => source.split(/\r?\n/);
const jobNameOf = (message: string): string | undefined => /[Jj]ob "([^"]+)"/.exec(message)?.[1];

function insertLines(lines: readonly string[], at: number, added: readonly string[]): string[] {
  return [...lines.slice(0, at), ...added, ...lines.slice(at)];
}

/** The reported line is the key or, depending on the node, its first child: search upwards a few lines. */
function findKeyAbove(lines: readonly string[], line: number, name: string): number | undefined {
  for (let at = line - 1; at >= 0 && line - 1 - at <= MAX_KEY_LOOKBACK; at -= 1) {
    if (KEY_LINE.exec(lines[at] ?? '')?.[2] === name) return at;
  }
  return undefined;
}

/** Adds `entry` as the first child of the block mapping whose key is on line `keyAt`; refuses if `entryKey` already exists. */
function insertFirstChild(lines: readonly string[], keyAt: number, entryKey: string, entry: string): string[] | undefined {
  const parent = indentOf(lines[keyAt] ?? '');
  let child: number | undefined;
  let first = -1;
  for (let i = keyAt + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) <= parent) break;
    if (child === undefined) { child = indentOf(line); first = i; }
    if (indentOf(line) === child && line.trimStart().startsWith(`${entryKey}:`)) return undefined;
  }
  return child === undefined ? undefined : insertLines(lines, first, [`${spaces(child)}${entry}`]);
}

const built = (lines: readonly string[], source: string, summaryKey: TextKey, summaryParams: Built['summaryParams'] = {}): Built =>
  ({ after: lines.join(eolOf(source)), summaryKey, summaryParams });

const githubPermissions: Fixer = (source) => {
  const lines = split(source);
  if (lines.some((l) => /^permissions\s*:/.test(l))) return undefined;
  const jobs = lines.flatMap((l, i) => (/^jobs:\s*(#.*)?$/.test(l) ? [i] : []));
  if (jobs.length !== 1 || jobs[0] === undefined) return undefined;
  return built(insertLines(lines, jobs[0], ['permissions:', '  contents: read', '']), source, 'fixSummaryPermissions');
};

const githubTimeout: Fixer = (source, finding) => {
  const lines = split(source);
  const job = jobNameOf(finding.message);
  const keyAt = job ? findKeyAbove(lines, finding.line, job) : undefined;
  const next = job && keyAt !== undefined ? insertFirstChild(lines, keyAt, 'timeout-minutes', `timeout-minutes: ${DEFAULT_TIMEOUT_MINUTES}`) : undefined;
  return next && job ? built(next, source, 'fixSummaryTimeout', { job, minutes: DEFAULT_TIMEOUT_MINUTES }) : undefined;
};

const gitlabDefaultTimeout: Fixer = (source) => {
  const lines = split(source);
  if (lines.some((l) => /^default\s*:/.test(l))) return undefined;
  let at = 0;
  while (at < lines.length && (isBlankOrComment(lines[at] ?? '') || /^---\s*$/.test(lines[at] ?? ''))) at += 1;
  if (at >= lines.length) return undefined;
  return built(insertLines(lines, at, ['default:', `  timeout: ${DEFAULT_TIMEOUT_MINUTES} minutes`]), source, 'fixSummaryGitlabTimeout', { minutes: DEFAULT_TIMEOUT_MINUTES });
};

const gitlabArtifactExpiry: Fixer = (source, finding) => {
  const lines = split(source);
  const job = jobNameOf(finding.message);
  const keyAt = findKeyAbove(lines, finding.line, 'artifacts');
  const next = keyAt === undefined ? undefined : insertFirstChild(lines, keyAt, 'expire_in', 'expire_in: 1 week');
  return next && job ? built(next, source, 'fixSummaryExpire', { job }) : undefined;
};

const azureTimeout: Fixer = (source) => {
  const lines = split(source);
  const targets: number[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)- (?:job|deployment):\s*\S+\s*(?:#.*)?$/.exec(line);
    if (!m || m[1] === undefined) return;
    const dash = m[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? '';
      if (isBlankOrComment(next)) continue;
      if (indentOf(next) <= dash) break;
      if (indentOf(next) === dash + 2 && next.trimStart().startsWith('timeoutInMinutes:')) return;
    }
    targets.push(i);
  });
  if (targets.length === 0) return undefined;
  let out = lines;
  for (const i of [...targets].reverse()) {
    const dash = indentOf(lines[i] ?? '');
    out = insertLines(out, i + 1, [`${spaces(dash + 2)}timeoutInMinutes: ${DEFAULT_TIMEOUT_MINUTES}`]);
  }
  return built(out, source, 'fixSummaryAzureTimeout', { minutes: DEFAULT_TIMEOUT_MINUTES });
};

function jenkinsOption(option: string, summaryKey: TextKey, summaryParams: Built['summaryParams']): Fixer {
  return (source) => {
    const lines = split(source);
    const pipelines = lines.flatMap((l, i) => (/^\s*pipeline\s*\{\s*$/.test(l) ? [i] : []));
    if (pipelines.length !== 1 || pipelines[0] === undefined) return undefined;
    const base = indentOf(lines[pipelines[0]] ?? '');
    const optionsAt = lines.findIndex((l) => /^\s*options\s*\{\s*$/.test(l) && indentOf(l) === base + 2);
    if (optionsAt >= 0) return built(insertLines(lines, optionsAt + 1, [`${spaces(base + 4)}${option}`]), source, summaryKey, summaryParams);
    if (/\boptions\b/.test(source)) return undefined;
    const block = [`${spaces(base + 2)}options {`, `${spaces(base + 4)}${option}`, `${spaces(base + 2)}}`];
    return built(insertLines(lines, pipelines[0] + 1, block), source, summaryKey, summaryParams);
  };
}

const FIXERS: Readonly<Record<string, { readonly provider: string; readonly fix: Fixer }>> = {
  PERMISSIONS_UNDECLARED: { provider: 'github-actions', fix: githubPermissions },
  TIMEOUT_UNSET: { provider: 'github-actions', fix: githubTimeout },
  GITLAB_NO_TIMEOUT: { provider: 'gitlab-ci', fix: gitlabDefaultTimeout },
  GITLAB_ARTIFACT_NO_EXPIRY: { provider: 'gitlab-ci', fix: gitlabArtifactExpiry },
  AZURE_NO_TIMEOUT: { provider: 'azure-pipelines', fix: azureTimeout },
  JENKINS_NO_TIMEOUT: {
    provider: 'jenkins',
    fix: jenkinsOption(`timeout(time: ${DEFAULT_TIMEOUT_MINUTES}, unit: 'MINUTES')`, 'fixSummaryJenkinsTimeout', { minutes: DEFAULT_TIMEOUT_MINUTES }),
  },
  JENKINS_NO_BUILD_DISCARDER: {
    provider: 'jenkins',
    fix: jenkinsOption(`buildDiscarder(logRotator(numToKeepStr: '${KEEP_BUILDS}'))`, 'fixSummaryJenkinsDiscarder', { builds: KEEP_BUILDS }),
  },
};

export const FIXABLE_CODES: ReadonlySet<string> = new Set(Object.keys(FIXERS));

function countCodes(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  return counts;
}

/** True when the edited text is still valid, reduced the target code and introduced no finding that was not there before. */
function proves(providerId: string, before: string, after: string, code: string): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  const a = provider.analyze(before);
  const b = provider.analyze(after);
  if (!b.syntaxValid) return false;
  const was = countCodes(a.findings);
  const now = countCodes(b.findings);
  if ((now.get(code) ?? 0) >= (was.get(code) ?? 0)) return false;
  return [...now].every(([c, n]) => n <= (was.get(c) ?? 0));
}

/** Builds a verified minimal fix for one finding, or undefined when none is provably safe. */
export function planFix(source: string, providerId: string | undefined, finding: Ref): FixPlan | undefined {
  const entry = FIXERS[finding.code];
  if (!entry || providerId !== entry.provider) return undefined;
  const result = entry.fix(source, finding);
  if (!result || result.after === source || !proves(entry.provider, source, result.after, finding.code)) return undefined;
  return { ...result, code: finding.code, before: source, sourceHash: hashText(source) };
}

/** Indexes of the findings that have a verified fix; used to offer "apply" only where it can really work. */
export function fixableIndexes(source: string, providerId: string | undefined, findings: readonly Finding[]): readonly number[] {
  return findings.flatMap((f, i) => (FIXABLE_CODES.has(f.code) && planFix(source, providerId, f) ? [i] : []));
}

/** The last applied improvement, persisted so undo survives a reload. */
export interface ImprovementRecord { readonly uri: string; readonly before: string; readonly after: string }

/** Persisted state may be stale or tampered with: anything malformed or oversized is dropped. */
export function parseImprovementRecord(raw: unknown): ImprovementRecord | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const { uri, before, after } = r;
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 4096 || typeof before !== 'string' || typeof after !== 'string') return undefined;
  return before.length + after.length > MAX_RECORD_CHARS ? undefined : { uri, before, after };
}
