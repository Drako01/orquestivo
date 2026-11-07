import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import { extractExpressions } from './expressions.js';
import type { Finding } from '../types.js';
import { toFinding } from './rule.js';
import type { FindingExtra, RuleMeta } from './rule.js';

export type Mapping = Record<string, unknown>;
export type Path = readonly (string | number)[];
/** 1-based line of the node at `path`; with `atKey`, of the mapping key that introduces it. */
export type LineLocator = (path: Path, atKey?: boolean) => number;

/** Guards against hostile inputs; analysis must stay fast and never throw. */
export const MAX_SOURCE_LENGTH = 2_000_000;
export const MAX_ALIAS_COUNT = 50;
const MAX_WALK_DEPTH = 40;
/** Flow collections (`[`/`{`) nested deeper than any real workflow; rejecting early avoids a costly parse. */
const MAX_FLOW_DEPTH = 100;

export const asMap = (value: unknown): Mapping | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Mapping : undefined;
export const refs = (value: unknown): string[] =>
  typeof value === 'string' ? [value] :
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
export const positiveInt = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value > 0;

export interface SyntaxIssue { readonly message: string; readonly line: number }
export type ParseResult =
  | { readonly ok: true; readonly root: Mapping; readonly lineAt: LineLocator }
  | { readonly ok: false; readonly reason: 'syntax' | 'root' | 'too-large'; readonly issues: readonly SyntaxIssue[] };

const failure = (reason: 'syntax' | 'root' | 'too-large', message: string, line = 1): ParseResult =>
  ({ ok: false, reason, issues: [{ message, line }] });

function createLocator(contents: unknown, counter: LineCounter): LineLocator {
  const keyIndex = new WeakMap<object, Map<string, { key: unknown; value: unknown }>>();
  const child = (map: YAMLMap, key: string): { key: unknown; value: unknown } | undefined => {
    let index = keyIndex.get(map);
    if (!index) {
      index = new Map();
      for (const pair of map.items) if (isScalar(pair.key)) index.set(String(pair.key.value), { key: pair.key, value: pair.value ?? pair.key });
      keyIndex.set(map, index);
    }
    return index.get(key);
  };
  return (path, atKey = false) => {
    let node: unknown = contents;
    let last: unknown = node;
    for (const [position, key] of path.entries()) {
      if (typeof key === 'string' && isMap(node)) {
        const next = child(node, key);
        if (next === undefined) break;
        node = next.value;
        last = atKey && position === path.length - 1 ? next.key : node;
      } else if (typeof key === 'number' && isSeq(node)) {
        node = node.items[key];
        last = node;
      } else break;
    }
    const range = last !== null && typeof last === 'object' && 'range' in last
      ? (last as { range?: readonly number[] }).range : undefined;
    return counter.linePos(range?.[0] ?? 0).line;
  };
}

/** Line (1-based) where flow nesting first exceeds the limit, or undefined. A linear scan, far cheaper than parsing. */
function flowDepthViolation(source: string): number | undefined {
  let depth = 0;
  let line = 1;
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charCodeAt(i);
    if (char === 10) line += 1;
    else if (char === 91 || char === 123) {
      depth += 1;
      if (depth > MAX_FLOW_DEPTH) return line;
    } else if ((char === 93 || char === 125) && depth > 0) depth -= 1;
  }
  return undefined;
}

/** Parses defensively: size guard, alias cap, and every parser failure becomes a reported issue. */
export function parseWorkflow(source: string): ParseResult {
  if (source.length > MAX_SOURCE_LENGTH) {
    return failure('too-large', 'Workflow exceeds the ' + MAX_SOURCE_LENGTH + ' character analysis limit.');
  }
  const tooDeep = flowDepthViolation(source);
  if (tooDeep !== undefined) {
    return { ok: false, reason: 'syntax', issues: [{ message: 'Flow collections are nested deeper than ' + MAX_FLOW_DEPTH + ' levels.', line: tooDeep }] };
  }
  const counter = new LineCounter();
  try {
    const doc = parseDocument(source, { uniqueKeys: true, strict: true, lineCounter: counter });
    if (doc.errors.length) {
      return { ok: false, reason: 'syntax', issues: doc.errors.map((e) => ({ message: e.message, line: counter.linePos(e.pos[0]).line })) };
    }
    const root = asMap(doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }));
    if (!root) return failure('root', 'The workflow must contain a YAML mapping.');
    return { ok: true, root, lineAt: createLocator(doc.contents, counter) };
  } catch (error) {
    return failure('syntax', error instanceof Error ? error.message : 'Unparseable YAML.');
  }
}

export interface JobInfo {
  readonly id: string;
  readonly job: Mapping;
  readonly path: Path;
  readonly reusable: boolean;
  readonly needs: readonly string[];
  /** The raw `steps` array (entries may be invalid), when present. */
  readonly rawSteps: readonly unknown[] | undefined;
}
export interface StepInfo { readonly job: JobInfo; readonly index: number; readonly step: Mapping; readonly path: Path }
export interface ExprSite {
  readonly path: Path;
  /** `jobs.<id>` the site belongs to, if any. */
  readonly jobId?: string;
  /** Key directly under the job (`if`, `runs-on`, `steps`, ...) or under the root. */
  readonly field: string;
  readonly isCondition: boolean;
  readonly exprs: readonly string[];
  readonly unclosed: boolean;
}

export interface RuleContext {
  readonly root: Mapping;
  /** Event name -> its configuration (undefined when the event has none). */
  readonly events: ReadonlyMap<string, unknown>;
  readonly privileged: boolean;
  readonly jobsRaw: Mapping | undefined;
  readonly jobs: readonly JobInfo[];
  readonly steps: readonly StepInfo[];
  readonly sites: readonly ExprSite[];
  readonly lineAt: LineLocator;
  report(m: RuleMeta, message: string, path: Path, extra?: FindingExtra): void;
}

function readEvents(on: unknown): Map<string, unknown> {
  const events = new Map<string, unknown>();
  if (typeof on === 'string') events.set(on, undefined);
  else if (Array.isArray(on)) {
    for (const name of on) if (typeof name === 'string') events.set(name, undefined);
  } else {
    for (const [name, config] of Object.entries(asMap(on) ?? {})) events.set(name, config);
  }
  return events;
}

function collectSites(root: Mapping): ExprSite[] {
  const sites: ExprSite[] = [];
  const path: (string | number)[] = [];
  const visit = (value: unknown): void => {
    if (path.length > MAX_WALK_DEPTH) return;
    if (typeof value === 'string') {
      const isCondition = path[path.length - 1] === 'if';
      const { exprs, unclosed } = extractExpressions(value, isCondition);
      if (exprs.length === 0 && !unclosed) return;
      const inJob = path[0] === 'jobs' && typeof path[1] === 'string';
      sites.push({
        path: [...path], isCondition, exprs, unclosed,
        field: String(inJob ? path[2] ?? '' : path[0] ?? ''),
        ...(inJob ? { jobId: path[1] as string } : {}),
      });
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const entries: [string | number, unknown][] = Array.isArray(value)
      ? value.map((v, i): [number, unknown] => [i, v]) : Object.entries(value);
    for (const [key, child] of entries) { path.push(key); visit(child); path.pop(); }
  };
  visit(root);
  return sites;
}

export function createContext(root: Mapping, lineAt: LineLocator, sink: Finding[]): RuleContext {
  const events = readEvents(root.on);
  const jobsRaw = asMap(root.jobs);
  const jobs: JobInfo[] = [];
  const steps: StepInfo[] = [];
  for (const [id, value] of Object.entries(jobsRaw ?? {})) {
    const job = asMap(value);
    if (!job) continue;
    const info: JobInfo = {
      id, job, path: ['jobs', id], reusable: typeof job.uses === 'string', needs: refs(job.needs),
      rawSteps: Array.isArray(job.steps) ? job.steps : undefined,
    };
    jobs.push(info);
    for (const [index, raw] of (info.rawSteps ?? []).entries()) {
      const step = asMap(raw);
      if (step) steps.push({ job: info, index, step, path: ['jobs', id, 'steps', index] });
    }
  }
  return {
    root, events, privileged: events.has('pull_request_target'), jobsRaw, jobs, steps,
    sites: collectSites(root), lineAt,
    report: (m, message, path, extra) => { sink.push(toFinding(m, message, lineAt(path), extra)); },
  };
}

/** A self-contained check. Rules are registered in `rules/index.ts`; adding one never edits the engine. */
export interface Rule {
  readonly id: string;
  readonly metas: readonly RuleMeta[];
  check(ctx: RuleContext): void;
}

export const asString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
/** Lower-cased `owner/repo[/path]` of a step's `uses`, without the ref. */
export const actionName = (step: Mapping): string | undefined => asString(step.uses)?.split('@')[0]?.toLowerCase();
export const withInputs = (step: Mapping): Mapping => asMap(step.with) ?? {};
/** Effective permissions of a job: its own block, else the workflow's. */
export const permissionsOf = (ctx: RuleContext, job: Mapping): unknown =>
  Object.hasOwn(job, 'permissions') ? job.permissions : ctx.root.permissions;
