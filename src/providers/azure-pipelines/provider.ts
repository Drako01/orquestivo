import type { Analysis } from '../../core/types.js';
import type { JobModel, PipelineModel, StepModel, TriggerModel } from '../../core/model.js';
import type { CiProvider } from '../../core/provider.js';
import { baseName } from '../shared/path.js';
import { asArray, asMap, flatStrings, optionalProps, parseYamlForModel, type Mapping, type YamlDocument } from '../shared/yaml.js';
import { analyzeAzure } from './analyzer.js';
import {
  collectStages, environmentName, scriptOf, type AzureJob, type AzureStage,
} from './structure.js';

/** Branch filters of `trigger`/`pr`, each given as a list or as `{ branches: { include } }`. */
function branchesOf(value: unknown): string[] {
  if (Array.isArray(value)) return flatStrings(value);
  const branches = asMap(value)?.branches;
  return flatStrings(Array.isArray(branches) ? branches : asMap(branches)?.include);
}

function triggersOf(root: Mapping): TriggerModel[] {
  const triggers: TriggerModel[] = [];
  if (root.trigger !== 'none') {
    const branches = branchesOf(root.trigger);
    triggers.push({ event: 'push', ...(branches.length > 0 ? { branches } : {}) });
  }
  if (root.pr !== undefined && root.pr !== 'none') {
    const branches = branchesOf(root.pr);
    triggers.push({ event: 'pull_request', ...(branches.length > 0 ? { branches } : {}) });
  }
  for (const schedule of asArray(root.schedules)) {
    const branches = branchesOf(asMap(schedule));
    triggers.push({ event: 'schedule', ...(branches.length > 0 ? { branches } : {}) });
  }
  return triggers;
}

function toStep(raw: Mapping, index: number, doc: YamlDocument, path: AzureJob['path']): StepModel {
  const name = typeof raw.displayName === 'string' ? raw.displayName : typeof raw.name === 'string' ? raw.name : undefined;
  const uses = [raw.task, raw.template, raw.checkout].find((v): v is string => typeof v === 'string');
  return {
    index, line: doc.lineOf(...path),
    ...optionalProps({ name, uses, run: scriptOf(raw), condition: typeof raw.condition === 'string' ? raw.condition : undefined }),
  };
}

function jobIdFor(stage: AzureStage, job: AzureJob): string {
  return stage.implicit ? job.id : `${stage.id}.${job.id}`;
}

function toJobs(stages: readonly AzureStage[], doc: YamlDocument): JobModel[] {
  const jobsByStage = new Map(stages.map((s) => [s.id, s.jobs.map((j) => jobIdFor(s, j))]));
  return stages.flatMap((stage, stageIndex) => {
    const upstreamStages = stage.dependsOn ?? (stage.implicit || stageIndex === 0 ? [] : [stages[stageIndex - 1]?.id ?? '']);
    const stageNeeds = upstreamStages.flatMap((id) => jobsByStage.get(id) ?? []);
    return stage.jobs.map((job): JobModel => {
      const siblingNeeds = (job.dependsOn ?? []).map((dep) => jobIdFor(stage, { ...job, id: dep }));
      const pool = asMap(job.raw.pool) ?? asMap(stage.raw.pool) ?? asMap(doc.root.pool);
      const runsOn = [pool?.vmImage, pool?.name].filter((v): v is string => typeof v === 'string');
      const timeout = job.raw.timeoutInMinutes;
      return {
        id: jobIdFor(stage, job), line: doc.lineOf(...job.path),
        needs: job.dependsOn === undefined || job.dependsOn.length === 0 ? stageNeeds : siblingNeeds,
        runsOn,
        steps: job.steps.map((step, index) => toStep(step.raw, index, doc, step.path)),
        ...optionalProps({
          name: typeof job.raw.displayName === 'string' ? job.raw.displayName : undefined,
          environment: environmentName(job.raw),
          condition: typeof job.raw.condition === 'string' ? job.raw.condition : undefined,
          timeoutMinutes: typeof timeout === 'number' ? timeout : undefined,
        }),
      };
    });
  });
}

export const azurePipelinesProvider: CiProvider = {
  id: 'azure-pipelines',
  displayName: 'Azure Pipelines',
  filePatterns: ['**/azure-pipelines.yml', '**/azure-pipelines.yaml'],
  matches: (relativePath: string): boolean => /^azure-pipelines\.ya?ml$/.test(baseName(relativePath)),
  analyze: (source: string): Analysis => analyzeAzure(source),
  model(source: string): PipelineModel | undefined {
    const doc = parseYamlForModel(source);
    if (!doc) return undefined;
    const stages = collectStages(doc.root);
    const name = typeof doc.root.name === 'string' ? doc.root.name : undefined;
    return {
      provider: 'azure-pipelines', triggers: triggersOf(doc.root), hasConcurrency: false,
      jobs: toJobs(stages, doc), ...(name !== undefined ? { name } : {}),
    };
  },
};
