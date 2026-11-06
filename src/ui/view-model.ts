import { buildJobGraph, type JobGraph } from '../core/analysis/graph.js';
import { evaluateIntent, type IntentContract, type IntentIssue, type IntentResult } from '../core/evidence/intent.js';
import type { RemoteContext } from '../core/evidence/run-evidence.js';
import { aggregateResults, type Verdict } from '../core/evidence/verdict.js';
import type { PipelineModel } from '../core/model.js';
import type { Category, Finding, Severity, WorkflowFileResult } from '../core/types.js';
import type { ExperienceLevel } from './settings.js';

export const SEVERITIES = ['error', 'warning', 'information'] as const satisfies readonly Severity[];
export const CATEGORIES = [
  'syntax', 'semantic', 'configuration', 'security', 'reliability', 'performance', 'maintainability',
] as const satisfies readonly Category[];

export interface ScanFile {
  readonly id: number;
  readonly result: WorkflowFileResult;
  readonly providerName: string;
  readonly model?: PipelineModel | undefined;
}

export type IntentInput =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid'; readonly issues: readonly IntentIssue[] }
  | { readonly status: 'ready'; readonly contract: IntentContract };

export interface RemoteInput {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly context?: RemoteContext | undefined;
}

export interface PolicyInfo { readonly maxFiles: number; readonly maxFileBytes: number }

export interface Filters {
  readonly severities: ReadonlySet<Severity>;
  readonly categories: ReadonlySet<Category>;
}
export const NO_FILTERS: Filters = { severities: new Set(), categories: new Set() };

export interface ViewInput {
  readonly files: readonly ScanFile[];
  readonly scanned: boolean;
  readonly trusted: boolean;
  readonly level: ExperienceLevel;
  readonly filters: Filters;
  readonly intent: IntentInput;
  readonly remote: RemoteInput;
  readonly aiEnabled: boolean;
  readonly policy: PolicyInfo;
  /** Set when the scan was cut by the configured file limit. */
  readonly truncated?: { readonly scanned: number; readonly total: number } | undefined;
}

export interface FindingView {
  readonly key: string;
  readonly fileId: number;
  readonly index: number;
  readonly finding: Finding;
}

export type SeverityCounts = Readonly<Record<Severity, number>>;

export interface FileView {
  readonly id: number;
  readonly path: string;
  readonly providerName: string;
  readonly syntaxValid: boolean;
  readonly counts: SeverityCounts;
  readonly totalFindings: number;
  /** Findings that pass the active filters. */
  readonly findings: readonly FindingView[];
  readonly graph?: JobGraph | undefined;
}

export interface IntentGroupView {
  readonly fileId: number;
  readonly path: string;
  readonly overall: Verdict;
  readonly results: readonly IntentResult[];
}

export interface ViewModel {
  readonly input: ViewInput;
  readonly files: readonly FileView[];
  readonly totals: SeverityCounts & { readonly files: number; readonly findings: number; readonly shown: number };
  readonly categoryCounts: Readonly<Record<Category, number>>;
  readonly providers: readonly string[];
  readonly intentGroups: readonly IntentGroupView[];
}

const emptyCounts = (): Record<Severity, number> => ({ error: 0, warning: 0, information: 0 });

export function matchesFilters(finding: Finding, filters: Filters): boolean {
  return (filters.severities.size === 0 || filters.severities.has(finding.severity))
    && (filters.categories.size === 0 || filters.categories.has(finding.category));
}

export function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * Remote runs belong to one workflow; a criterion must only see runs of the workflow it evaluates.
 * GitHub names a run after the workflow `name:` or, when absent, its file path.
 */
export function remoteContextFor(remote: RemoteContext | undefined, model: PipelineModel, path: string): RemoteContext | undefined {
  if (remote === undefined || remote.status === 'unavailable') return remote;
  const names = new Set([model.name, path].filter((n): n is string => n !== undefined));
  return { status: 'available', runs: remote.runs.filter((run) => names.has(run.workflowName)) };
}

function buildIntentGroups(input: ViewInput): readonly IntentGroupView[] {
  if (input.intent.status !== 'ready') return [];
  const { contract } = input.intent;
  const remote = input.remote.enabled ? input.remote.context : undefined;
  return input.files.flatMap((file): IntentGroupView[] => {
    if (!file.model) return [];
    const results = evaluateIntent(contract, file.model, remoteContextFor(remote, file.model, file.result.path));
    return [{ fileId: file.id, path: file.result.path, overall: aggregateResults(results), results }];
  });
}

/** Same data for every experience level; the level only changes how the renderer presents it. */
export function buildViewModel(input: ViewInput): ViewModel {
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const totalCounts = emptyCounts();
  let shown = 0;
  const files = input.files.map((file): FileView => {
    const counts = emptyCounts();
    const all = file.result.findings.map((finding, index): FindingView => ({
      key: `${file.id}:${index}`, fileId: file.id, index, finding,
    }));
    for (const { finding } of all) {
      counts[finding.severity] += 1;
      totalCounts[finding.severity] += 1;
      categoryCounts[finding.category] += 1;
    }
    const findings = all.filter(({ finding }) => matchesFilters(finding, input.filters));
    shown += findings.length;
    return {
      id: file.id, path: file.result.path, providerName: file.providerName, syntaxValid: file.result.syntaxValid,
      counts, totalFindings: all.length, findings,
      graph: file.model && file.model.jobs.length > 0 ? buildJobGraph(file.model) : undefined,
    };
  });
  return {
    input, files,
    totals: { ...totalCounts, files: files.length, findings: totalCounts.error + totalCounts.warning + totalCounts.information, shown },
    categoryCounts,
    providers: [...new Set(input.files.map((f) => f.providerName))],
    intentGroups: buildIntentGroups(input),
  };
}
