import { asMap, flatStrings, type Mapping } from '../shared/yaml.js';

export const DEFAULT_STAGES: readonly string[] = ['.pre', 'build', 'test', 'deploy', '.post'];
const RESERVED_KEYS = new Set([
  'stages', 'variables', 'default', 'include', 'workflow', 'image', 'services',
  'before_script', 'after_script', 'cache', 'spec',
]);

export interface GitlabJob {
  readonly name: string;
  /** Hidden jobs (`.name`) are templates that never run on their own. */
  readonly hidden: boolean;
  readonly own: Mapping;
  /** Job merged over its resolved `extends` chain and `default`. */
  readonly effective: Mapping;
  readonly parents: readonly string[];
}

/** Names listed in `extends` (string or list). */
export const extendsOf = (job: Mapping): string[] => flatStrings(job.extends);

/** Collects every top-level mapping that is a job (or a hidden template), resolving `extends` without recursion loops. */
export function collectJobs(root: Mapping): ReadonlyMap<string, GitlabJob> {
  const raw = new Map<string, Mapping>();
  for (const [name, value] of Object.entries(root)) {
    const job = asMap(value);
    if (job && !RESERVED_KEYS.has(name)) raw.set(name, job);
  }
  const defaults = asMap(root.default) ?? {};
  const resolve = (name: string, visiting: ReadonlySet<string>): Mapping => {
    const own = raw.get(name) ?? {};
    if (visiting.has(name)) return own;
    const next = new Set(visiting).add(name);
    const inherited = extendsOf(own).filter((p) => raw.has(p)).reduce<Mapping>(
      (acc, parent) => ({ ...acc, ...resolve(parent, next) }), {});
    return { ...inherited, ...own };
  };
  const jobs = new Map<string, GitlabJob>();
  for (const [name, own] of raw) {
    jobs.set(name, {
      name, own, hidden: name.startsWith('.'),
      effective: { ...defaults, ...resolve(name, new Set()) },
      parents: extendsOf(own),
    });
  }
  return jobs;
}

/** Declared stages, or GitLab's defaults. */
export function declaredStages(root: Mapping): readonly string[] {
  const stages = flatStrings(root.stages);
  return stages.length > 0 ? stages : DEFAULT_STAGES;
}

export const stageOf = (job: GitlabJob): string =>
  typeof job.effective.stage === 'string' ? job.effective.stage : 'test';

/** Dependency names from `needs`, ignoring cross-project/pipeline needs. */
export function needsOf(job: Mapping): { name: string; optional: boolean }[] {
  const needs = Array.isArray(job.needs) ? job.needs : asMap(job.needs) ? [job.needs] : [];
  const result: { name: string; optional: boolean }[] = [];
  for (const entry of needs) {
    if (typeof entry === 'string') result.push({ name: entry, optional: false });
    const map = asMap(entry);
    if (map && typeof map.job === 'string' && map.pipeline === undefined && map.project === undefined) {
      result.push({ name: map.job, optional: map.optional === true });
    }
  }
  return result;
}

/** Environment name of a job (string or `environment.name`), plus the action when set. */
export function environmentOf(job: Mapping): { name: string; action?: string } | undefined {
  if (typeof job.environment === 'string') return { name: job.environment };
  const map = asMap(job.environment);
  if (!map || typeof map.name !== 'string') return undefined;
  return typeof map.action === 'string' ? { name: map.name, action: map.action } : { name: map.name };
}
