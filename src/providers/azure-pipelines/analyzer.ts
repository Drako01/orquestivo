import type { Analysis } from '../../core/types.js';
import { findCycleMembers } from '../shared/graph.js';
import type { FindingCollector } from '../shared/rules.js';
import { hasCurlPipeShell, isLiteralValue, isSecretName, isUnpinnedImage } from '../shared/text.js';
import { analyzeYamlPipeline, asArray, asMap, flatStrings, type Mapping, type PathSegment, type YamlDocument } from '../shared/yaml.js';
import { AZURE_RULES, type AzureRuleCode } from './rules.js';
import {
  collectStages, environmentName, scriptOf, stepKind, type AzureJob, type AzureStage,
} from './structure.js';

type Collector = FindingCollector<AzureRuleCode>;
const TASK_VERSION = /@\d+(?:\.(?:\d+|\*))*$/;
const DEPLOY_NAME = /deploy|release|publish-prod/i;
const MOVING_BRANCH = /^(?:refs\/heads\/)?(?:main|master|develop)$/i;

const at = (doc: YamlDocument, path: PathSegment[], ...rest: PathSegment[]): number => doc.lineOf(...path, ...rest);

function checkVariables(variables: unknown, doc: YamlDocument, path: PathSegment[], collector: Collector): void {
  const entries: { name: string; value: unknown }[] = [];
  if (Array.isArray(variables)) {
    for (const item of variables) {
      const map = asMap(item);
      if (map && typeof map.name === 'string') entries.push({ name: map.name, value: map.value });
    }
  } else {
    for (const [name, raw] of Object.entries(asMap(variables) ?? {})) {
      entries.push({ name, value: asMap(raw) ? asMap(raw)?.value : raw });
    }
  }
  for (const { name, value } of entries) {
    if (isSecretName(name) && isLiteralValue(value)) {
      collector.add('AZURE_SECRET_IN_VARIABLES', at(doc, path, 'variables'), `Variable "${name}" looks like a secret with a literal value.`, name);
    }
  }
}

function checkPoolAndCondition(raw: Mapping, doc: YamlDocument, path: PathSegment[], collector: Collector): void {
  const vmImage = asMap(raw.pool)?.vmImage;
  if (typeof vmImage === 'string' && /(?:^|-)latest$/i.test(vmImage.trim())) {
    collector.add('AZURE_POOL_IMAGE_LATEST', at(doc, path, 'pool'), `Pool image "${vmImage}" is not pinned.`, vmImage);
  }
  if (typeof raw.condition === 'string' && raw.condition.trim() === 'always()') {
    collector.add('AZURE_CONDITION_ALWAYS', at(doc, path, 'condition'), 'condition: always() also runs on cancellation.', raw.condition);
  }
}

function checkJob(job: AzureJob, stage: AzureStage, doc: YamlDocument, collector: Collector): void {
  checkPoolAndCondition(job.raw, doc, job.path, collector);
  checkVariables(job.raw.variables, doc, job.path, collector);
  if (job.kind === 'deployment' && environmentName(job.raw) === undefined) {
    collector.add('AZURE_DEPLOYMENT_NO_ENVIRONMENT', at(doc, job.path), `Deployment "${job.id}" has no environment.`, job.id);
  }
  if (job.kind === 'job' && DEPLOY_NAME.test(job.id)) {
    collector.add('AZURE_DEPLOY_JOB_NOT_DEPLOYMENT', at(doc, job.path), `Job "${job.id}" looks like a deployment but is a plain job.`, job.id);
  }
  const siblings = new Set(stage.jobs.map((j) => j.id));
  for (const dep of job.dependsOn ?? []) {
    if (!siblings.has(dep)) {
      collector.add('AZURE_JOB_DEPENDS_UNKNOWN', at(doc, job.path, 'dependsOn'), `Job "${job.id}" depends on unknown job "${dep}".`, dep);
    }
  }
  for (const step of job.steps) {
    const kind = stepKind(step.raw);
    const line = at(doc, step.path);
    if (!kind) {
      collector.add('AZURE_STEP_INVALID', line, 'Step has no recognised keyword (script, task, checkout, template, ...).');
    }
    const task = step.raw.task;
    if (typeof task === 'string' && !TASK_VERSION.test(task)) {
      collector.add('AZURE_TASK_VERSION_MISSING', line, `Task "${task}" has no major version (Name@N).`, task);
    }
    const script = scriptOf(step.raw);
    if (script !== undefined && hasCurlPipeShell(script)) {
      collector.add('AZURE_CURL_PIPE_SHELL', line, 'Step pipes a download into a shell.', script);
    }
    if (typeof step.raw.condition === 'string' && step.raw.condition.trim() === 'always()') {
      collector.add('AZURE_CONDITION_ALWAYS', line, 'condition: always() also runs on cancellation.', step.raw.condition);
    }
  }
}

function reportDuplicates(ids: readonly string[], lineFor: (index: number) => number, what: string, collector: Collector): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) collector.add('AZURE_DUPLICATE_ID', lineFor(index), `Duplicate ${what} "${id}".`, id);
    seen.add(id);
  });
}

function checkStages(stages: readonly AzureStage[], doc: YamlDocument, collector: Collector): void {
  const explicit = stages.filter((s) => !s.implicit);
  const stageIds = new Set(explicit.map((s) => s.id));
  reportDuplicates(explicit.map((s) => s.id), (i) => at(doc, explicit[i]?.path ?? []), 'stage', collector);
  for (const stage of explicit) {
    for (const dep of stage.dependsOn ?? []) {
      if (!stageIds.has(dep)) {
        collector.add('AZURE_STAGE_DEPENDS_UNKNOWN', at(doc, stage.path, 'dependsOn'), `Stage "${stage.id}" depends on unknown stage "${dep}".`, dep);
      }
    }
  }
  const stageCycle = findCycleMembers(new Map(explicit.map((s) => [s.id, s.dependsOn ?? []])));
  explicit.filter((s) => stageCycle.has(s.id)).forEach((s) => {
    collector.add('AZURE_STAGE_DEPENDS_CYCLE', at(doc, s.path, 'dependsOn'), `Stage "${s.id}" is part of a dependency cycle.`, s.id);
  });
  for (const stage of stages) {
    checkPoolAndCondition(stage.raw, doc, stage.path, collector);
    if (!stage.implicit) checkVariables(stage.raw.variables, doc, stage.path, collector);
    reportDuplicates(stage.jobs.map((j) => j.id), (i) => at(doc, stage.jobs[i]?.path ?? []), 'job', collector);
    const jobCycle = findCycleMembers(new Map(stage.jobs.map((j) => [j.id, j.dependsOn ?? []])));
    stage.jobs.filter((j) => jobCycle.has(j.id)).forEach((j) => {
      collector.add('AZURE_JOB_DEPENDS_CYCLE', at(doc, j.path, 'dependsOn'), `Job "${j.id}" is part of a dependency cycle.`, j.id);
    });
    stage.jobs.forEach((job) => checkJob(job, stage, doc, collector));
  }
}

function checkTriggers(root: Mapping, doc: YamlDocument, collector: Collector): void {
  if (root.trigger === undefined) {
    collector.add('AZURE_TRIGGER_MISSING', 1, 'No trigger is declared; every push to every branch runs the pipeline.');
  } else {
    const include = asMap(root.trigger)?.branches;
    const branches = flatStrings(Array.isArray(root.trigger) ? root.trigger : asMap(include)?.include ?? include);
    if (branches.includes('*')) {
      collector.add('AZURE_TRIGGER_WILDCARD', doc.lineOf('trigger'), 'trigger includes the "*" wildcard branch.', '*');
    }
  }
  if (root.pr === undefined) collector.add('AZURE_PR_TRIGGER_MISSING', 1, 'No pr trigger is declared.');
}

function checkResources(root: Mapping, doc: YamlDocument, collector: Collector): void {
  const resources = asMap(root.resources);
  asArray(resources?.containers).forEach((item, index) => {
    const image = asMap(item)?.image;
    if (typeof image === 'string' && isUnpinnedImage(image)) {
      collector.add('AZURE_CONTAINER_UNPINNED', doc.lineOf('resources', 'containers', index), `Container image "${image}" is unpinned.`, image);
    }
  });
  asArray(resources?.repositories).forEach((item, index) => {
    const repo = asMap(item);
    if (!repo) return;
    const ref = typeof repo.ref === 'string' ? repo.ref : undefined;
    if (ref === undefined || MOVING_BRANCH.test(ref)) {
      collector.add('AZURE_REPO_RESOURCE_UNPINNED', doc.lineOf('resources', 'repositories', index), `Repository resource "${String(repo.repository)}" tracks a moving branch.`, ref);
    }
  });
}

export function analyzeAzure(source: string): Analysis {
  return analyzeYamlPipeline<AzureRuleCode>(source, AZURE_RULES, (doc, collector) => {
    const { root } = doc;
    const shapes = (['stages', 'jobs', 'steps'] as const).filter((key) => root[key] !== undefined);
    if (shapes.length > 1) {
      collector.add('AZURE_MIXED_STRUCTURE', doc.lineOf(shapes[1] ?? 'stages'), `The top level mixes ${shapes.join(', ')}.`);
    }
    if (shapes.length === 0 && root.extends === undefined && root.template === undefined) {
      collector.add('AZURE_NO_WORK', 1, 'The pipeline defines no stages, jobs or steps.');
    }
    checkTriggers(root, doc, collector);
    checkVariables(root.variables, doc, [], collector);
    checkPoolAndCondition(root, doc, [], collector);
    checkResources(root, doc, collector);
    const stages = collectStages(root);
    checkStages(stages, doc, collector);
    const untimed = stages.flatMap((s) => s.jobs).find((j) => j.raw.timeoutInMinutes === undefined);
    if (untimed) {
      collector.add('AZURE_NO_TIMEOUT', at(doc, untimed.path), `Job "${untimed.id}" (and possibly others) has no timeoutInMinutes.`);
    }
  });
}
