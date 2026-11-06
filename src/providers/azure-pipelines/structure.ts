import { asArray, asMap, flatStrings, type Mapping, type PathSegment } from '../shared/yaml.js';

export const IMPLICIT_STAGE = '__default';
const MAX_DEPTH = 8;

export interface AzureStep {
  readonly raw: Mapping;
  readonly path: PathSegment[];
}
export interface AzureJob {
  readonly id: string;
  readonly kind: 'job' | 'deployment';
  readonly raw: Mapping;
  readonly path: PathSegment[];
  /** Undefined means "implicit" (no explicit `dependsOn`). */
  readonly dependsOn: readonly string[] | undefined;
  readonly steps: readonly AzureStep[];
}
export interface AzureStage {
  readonly id: string;
  readonly implicit: boolean;
  readonly raw: Mapping;
  readonly path: PathSegment[];
  readonly dependsOn: readonly string[] | undefined;
  readonly jobs: readonly AzureJob[];
}

/** `dependsOn` as a list: a string, a list, or undefined when absent. */
const dependencies = (raw: Mapping): string[] | undefined =>
  raw.dependsOn === undefined ? undefined : flatStrings(raw.dependsOn);

/** Every `steps` array reachable from a job/deployment (deployment strategies nest them several levels deep). */
function collectSteps(node: unknown, path: PathSegment[], depth = 0): AzureStep[] {
  const map = asMap(node);
  if (!map || depth > MAX_DEPTH) return [];
  const found: AzureStep[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (key === 'steps') {
      asArray(value).forEach((item, index) => {
        const raw = asMap(item);
        if (raw) found.push({ raw, path: [...path, 'steps', index] });
      });
    } else {
      found.push(...collectSteps(value, [...path, key], depth + 1));
    }
  }
  return found;
}

function toJob(raw: Mapping, path: PathSegment[]): AzureJob | undefined {
  const kind = typeof raw.deployment === 'string' ? 'deployment' : typeof raw.job === 'string' ? 'job' : undefined;
  if (!kind) return undefined;
  return {
    id: String(raw[kind]), kind, raw, path, dependsOn: dependencies(raw), steps: collectSteps(raw, path),
  };
}

function jobsOf(list: unknown, basePath: PathSegment[]): AzureJob[] {
  return asArray(list).flatMap((item, index) => {
    const raw = asMap(item);
    const job = raw ? toJob(raw, [...basePath, index]) : undefined;
    return job ? [job] : [];
  });
}

/** Normalises the three entry shapes (`stages`, `jobs`, `steps`) into a stage list. */
export function collectStages(root: Mapping): AzureStage[] {
  if (Array.isArray(root.stages)) {
    return root.stages.flatMap((item, index) => {
      const raw = asMap(item);
      if (!raw || typeof raw.stage !== 'string') return [];
      const path: PathSegment[] = ['stages', index];
      return [{
        id: raw.stage, implicit: false, raw, path, dependsOn: dependencies(raw),
        jobs: jobsOf(raw.jobs, [...path, 'jobs']),
      }];
    });
  }
  if (Array.isArray(root.jobs)) {
    return [{ id: IMPLICIT_STAGE, implicit: true, raw: root, path: [], dependsOn: undefined, jobs: jobsOf(root.jobs, ['jobs']) }];
  }
  if (Array.isArray(root.steps)) {
    const job: AzureJob = {
      id: 'job', kind: 'job', raw: root, path: [], dependsOn: undefined, steps: collectSteps(root, []),
    };
    return [{ id: IMPLICIT_STAGE, implicit: true, raw: root, path: [], dependsOn: undefined, jobs: [job] }];
  }
  return [];
}

export const STEP_KEYS = [
  'script', 'bash', 'pwsh', 'powershell', 'task', 'checkout', 'template', 'download', 'downloadBuild',
  'getPackage', 'publish', 'reviewApp', 'restoreCache', 'saveCache',
] as const;
const SCRIPT_KEYS = ['script', 'bash', 'pwsh', 'powershell'] as const;

export const stepKind = (step: Mapping): (typeof STEP_KEYS)[number] | undefined =>
  STEP_KEYS.find((key) => step[key] !== undefined);

/** Inline script text of a step (script-like keys or a task `inputs.script`). */
export function scriptOf(step: Mapping): string | undefined {
  for (const key of SCRIPT_KEYS) if (typeof step[key] === 'string') return step[key];
  const inputs = asMap(step.inputs);
  return typeof inputs?.script === 'string' ? inputs.script : undefined;
}

/** Environment name of a deployment job (string or `environment.name`). */
export function environmentName(job: Mapping): string | undefined {
  if (typeof job.environment === 'string') return job.environment;
  const name = asMap(job.environment)?.name;
  return typeof name === 'string' ? name : undefined;
}
