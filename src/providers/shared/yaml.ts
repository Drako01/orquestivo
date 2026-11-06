import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Analysis } from '../../core/types.js';
import { COMMON_RULES, FindingCollector, type CommonRuleCode, type RuleCatalog } from './rules.js';

export type Mapping = Record<string, unknown>;
export type PathSegment = string | number;

export const asMap = (value: unknown): Mapping | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Mapping : undefined;
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
/** Drops `undefined` values so the result satisfies `exactOptionalPropertyTypes`. */
export const optionalProps = <T extends object>(props: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
/** A string or a (possibly nested) list of strings, flattened. */
export function flatStrings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || depth > 4) return [];
  return value.flatMap((item) => flatStrings(item, depth + 1));
}

/** Parsed YAML mapping with source-position lookup by key/index path. */
export interface YamlDocument {
  readonly root: Mapping;
  /** 1-based line of the node at `path` (the deepest reachable ancestor when the path does not exist). */
  lineOf(...path: PathSegment[]): number;
}

export const MAX_SOURCE_CHARS = 1_000_000;

function buildDocument(source: string, collector: FindingCollector<CommonRuleCode>): YamlDocument | undefined {
  const counter = new LineCounter();
  const parsed = parseDocument(source, { uniqueKeys: true, strict: true, merge: true, lineCounter: counter });
  const lineAtOffset = (offset: number): number => counter.linePos(offset).line;
  if (parsed.errors.length > 0) {
    for (const issue of parsed.errors) collector.add('YAML_INVALID', lineAtOffset(issue.pos[0]), issue.message);
    return undefined;
  }
  const root = asMap(parsed.toJS({ maxAliasCount: 100 }));
  if (!root) {
    collector.add('PIPELINE_ROOT_INVALID', 1, 'The pipeline must contain a YAML mapping at the top level.');
    return undefined;
  }
  const lineOf = (...path: PathSegment[]): number => {
    let node: unknown = parsed.contents;
    let last: unknown = node;
    for (const key of path) {
      if (typeof key === 'string' && isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
        if (!pair) break;
        last = pair.key;
        node = pair.value;
      } else if (typeof key === 'number' && isSeq(node)) {
        node = node.items[key];
        last = node ?? last;
      } else break;
    }
    const range = last !== null && typeof last === 'object' && 'range' in last
      ? (last as { range?: readonly number[] }).range : undefined;
    return lineAtOffset(range?.[0] ?? 0);
  };
  return { root, lineOf };
}

/**
 * Shared analyze skeleton for YAML dialects: size guard, parse, root validation and failure containment.
 * `check` receives the parsed document and a collector over the provider catalog.
 */
export function analyzeYamlPipeline<K extends string>(
  source: string,
  catalog: RuleCatalog<K | CommonRuleCode>,
  check: (doc: YamlDocument, collector: FindingCollector<K | CommonRuleCode>) => void,
): Analysis {
  const collector = new FindingCollector<K | CommonRuleCode>(catalog);
  const result = (syntaxValid: boolean): Analysis =>
    ({ findings: collector.findings, syntaxValid, executionVerified: false });
  if (source.length > MAX_SOURCE_CHARS) {
    collector.add('SOURCE_TOO_LARGE', 1, `The file exceeds ${MAX_SOURCE_CHARS} characters and was not analysed.`);
    return result(false);
  }
  try {
    const doc = buildDocument(source, collector);
    if (!doc) return result(false);
    check(doc, collector);
    return result(true);
  } catch (error) {
    collector.add('ANALYZER_FAILURE', 1, `Analysis aborted: ${error instanceof Error ? error.message : String(error)}`);
    return result(false);
  }
}

/** Parses a YAML mapping for `model()`; undefined for any invalid, hostile or oversized input. */
export function parseYamlForModel(source: string): YamlDocument | undefined {
  if (source.length > MAX_SOURCE_CHARS) return undefined;
  try {
    return buildDocument(source, new FindingCollector<CommonRuleCode>(COMMON_RULES));
  } catch {
    return undefined;
  }
}
