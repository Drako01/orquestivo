import type { JobModel, PipelineModel, StepModel, TriggerModel } from '../model.js';
import { asMap, asString, refs } from './context.js';
import type { JobInfo, Mapping, RuleContext, StepInfo } from './context.js';

const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
const strings = (value: unknown): string[] | undefined => {
  const list = refs(value);
  return list.length > 0 ? list : undefined;
};
const numberOf = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;

type Permissions = NonNullable<PipelineModel['permissions']>;
function permissionsOf(value: unknown): Permissions | undefined {
  if (value === 'read-all' || value === 'write-all') return value;
  const scopes = asMap(value);
  if (!scopes) return undefined;
  return Object.fromEntries(Object.entries(scopes).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function triggerModels(ctx: RuleContext): TriggerModel[] {
  return [...ctx.events].map(([event, config]) => {
    const options = asMap(config) ?? {};
    return {
      event,
      ...opt('branches', strings(options.branches)),
      ...opt('tags', strings(options.tags)),
      ...opt('paths', strings(options.paths)),
      ...opt('types', strings(options.types)),
    };
  });
}

function matrixOf(job: Mapping): JobModel['matrix'] {
  const matrix = asMap(asMap(job.strategy)?.matrix);
  if (!matrix) return undefined;
  const axes = Object.entries(matrix).filter((e): e is [string, unknown[]] =>
    e[0] !== 'include' && e[0] !== 'exclude' && Array.isArray(e[1]));
  return Object.fromEntries(axes);
}

function runsOnOf(value: unknown): string[] {
  const labels = asMap(value)?.labels;
  return refs(labels ?? value);
}

function jobModel(ctx: RuleContext, info: JobInfo, own: readonly StepInfo[]): JobModel {
  const { id, job, path } = info;
  const environment = asString(job.environment) ?? asString(asMap(job.environment)?.name);
  const steps: StepModel[] = own.map(({ index, step, path: stepPath }) => ({
    index,
    line: ctx.lineAt(stepPath),
    ...opt('name', asString(step.name)),
    ...opt('uses', asString(step.uses)),
    ...opt('run', asString(step.run)),
    ...opt('condition', asString(step.if)),
  }));
  return {
    id, line: ctx.lineAt(path, true), needs: info.needs, runsOn: runsOnOf(job['runs-on']), steps,
    ...opt('name', asString(job.name)),
    ...opt('uses', asString(job.uses)),
    ...opt('environment', environment),
    ...opt('condition', asString(job.if)),
    ...opt('timeoutMinutes', numberOf(job['timeout-minutes'])),
    ...opt('permissions', permissionsOf(job.permissions)),
    ...opt('matrix', matrixOf(job)),
  };
}

/** Maps a parsed GitHub Actions workflow onto the provider-neutral pipeline model. */
export function buildPipelineModel(ctx: RuleContext): PipelineModel {
  const stepsByJob = new Map<JobInfo, StepInfo[]>();
  for (const step of ctx.steps) {
    const list = stepsByJob.get(step.job);
    if (list) list.push(step); else stepsByJob.set(step.job, [step]);
  }
  return {
    provider: 'github-actions',
    triggers: triggerModels(ctx),
    hasConcurrency: ctx.root.concurrency !== undefined,
    jobs: ctx.jobs.map((info) => jobModel(ctx, info, stepsByJob.get(info) ?? [])),
    ...opt('name', asString(ctx.root.name)),
    ...opt('permissions', permissionsOf(ctx.root.permissions)),
  };
}
