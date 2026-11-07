import type { Analysis } from '../../core/types.js';
import { findCycleMembers } from '../shared/graph.js';
import type { FindingCollector } from '../shared/rules.js';
import { hasCurlPipeShell, isLiteralValue, isSecretName, isUnpinnedImage } from '../shared/text.js';
import { analyzeYamlPipeline, asMap, flatStrings, type Mapping, type YamlDocument } from '../shared/yaml.js';
import { collectJobs, declaredStages, environmentOf, needsOf, stageOf, type GitlabJob } from './jobs.js';
import { GITLAB_RULES, type GitlabRuleCode } from './rules.js';

type Collector = FindingCollector<GitlabRuleCode>;
const MOVING_REFS = new Set(['main', 'master', 'develop', 'head', '~latest']);
const SCRIPT_KEYS = ['before_script', 'script', 'after_script'] as const;

const imageName = (image: unknown): string | undefined =>
  typeof image === 'string' ? image : typeof asMap(image)?.name === 'string' ? asMap(image)?.name as string : undefined;

function checkVariables(variables: unknown, collector: Collector, line: number): void {
  const map = asMap(variables);
  if (!map) return;
  for (const [name, raw] of Object.entries(map)) {
    const value = asMap(raw) ? asMap(raw)?.value : raw;
    if (isSecretName(name) && isLiteralValue(value)) {
      collector.add('GITLAB_SECRET_IN_VARIABLES', line, `Variable "${name}" looks like a secret with a literal value.`, name);
    }
  }
}

function checkInclude(doc: YamlDocument, collector: Collector): void {
  const raw = doc.root.include;
  const entries = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  entries.forEach((entry, index) => {
    const line = doc.lineOf('include', ...(Array.isArray(raw) ? [index] : []));
    if (typeof entry === 'string') {
      if (/^http:\/\//i.test(entry)) collector.add('GITLAB_INCLUDE_INSECURE', line, `Include "${entry}" uses plain HTTP.`, entry);
      return;
    }
    const map = asMap(entry);
    if (!map) return;
    if (typeof map.remote === 'string' && /^http:\/\//i.test(map.remote)) {
      collector.add('GITLAB_INCLUDE_INSECURE', line, `Remote include "${map.remote}" uses plain HTTP.`, map.remote);
    }
    if (typeof map.project === 'string') {
      const ref = typeof map.ref === 'string' ? map.ref : undefined;
      if (!ref || MOVING_REFS.has(ref.toLowerCase())) {
        collector.add('GITLAB_INCLUDE_UNPINNED', line, `Include from project "${map.project}" is not pinned to a tag or SHA.`, map.project);
      }
    }
    if (typeof map.component === 'string') {
      const version = map.component.split('@')[1];
      if (!version || MOVING_REFS.has(version.toLowerCase())) {
        collector.add('GITLAB_INCLUDE_UNPINNED', line, `Component "${map.component}" is not pinned to a version.`, map.component);
      }
    }
  });
}

function checkGraph(jobs: ReadonlyMap<string, GitlabJob>, doc: YamlDocument, collector: Collector): void {
  const stages = declaredStages(doc.root);
  const extendsGraph = new Map([...jobs].map(([name, job]) => [name, job.parents]));
  const extendsCycle = findCycleMembers(extendsGraph);
  const needsGraph = new Map([...jobs].filter(([, j]) => !j.hidden)
    .map(([name, job]) => [name, needsOf(job.own).map((n) => n.name)]));
  const needsCycle = findCycleMembers(needsGraph);
  const usedStages = new Set<string>();

  for (const job of jobs.values()) {
    for (const parent of job.parents) {
      if (!jobs.has(parent)) {
        collector.add('GITLAB_EXTENDS_UNKNOWN', doc.lineOf(job.name, 'extends'), `Job "${job.name}" extends unknown "${parent}".`, parent);
      }
    }
    if (extendsCycle.has(job.name)) {
      collector.add('GITLAB_EXTENDS_CYCLE', doc.lineOf(job.name, 'extends'), `Job "${job.name}" is part of an extends cycle.`, job.name);
    }
    if (job.hidden) continue;
    const stage = stageOf(job);
    usedStages.add(stage);
    if (!stages.includes(stage)) {
      collector.add('GITLAB_STAGE_UNDEFINED', doc.lineOf(job.name, 'stage'), `Job "${job.name}" uses undeclared stage "${stage}".`, stage);
    }
    for (const need of needsOf(job.own)) {
      const target = jobs.get(need.name);
      const line = doc.lineOf(job.name, 'needs');
      if (!target || target.hidden) {
        if (!need.optional) collector.add('GITLAB_NEEDS_UNKNOWN', line, `Job "${job.name}" needs unknown job "${need.name}".`, need.name);
      } else if (stages.indexOf(stageOf(target)) > stages.indexOf(stage) && stages.includes(stage)) {
        collector.add('GITLAB_NEEDS_LATER_STAGE', line, `Job "${job.name}" needs "${need.name}" from a later stage.`, need.name);
      }
    }
    if (needsCycle.has(job.name)) {
      collector.add('GITLAB_NEEDS_CYCLE', doc.lineOf(job.name, 'needs'), `Job "${job.name}" is part of a needs cycle.`, job.name);
    }
  }
  if (Array.isArray(doc.root.stages)) {
    stages.filter((s) => !usedStages.has(s) && !s.startsWith('.')).forEach((stage) => {
      collector.add('GITLAB_STAGE_UNUSED', doc.lineOf('stages'), `Stage "${stage}" has no jobs.`, stage);
    });
  }
}

const isDeployLike = (job: GitlabJob): boolean => {
  const env = environmentOf(job.effective);
  if (env) return env.action !== 'stop' && env.action !== 'prepare';
  return stageOf(job) === 'deploy' || /deploy/i.test(job.name);
};
const hasGuard = (job: Mapping): boolean =>
  job.rules !== undefined || job.only !== undefined || job.except !== undefined || job.when === 'manual';

function checkJob(job: GitlabJob, doc: YamlDocument, collector: Collector): void {
  const { name, own, effective } = job;
  for (const key of SCRIPT_KEYS) {
    flatStrings(own[key]).forEach((script) => {
      if (hasCurlPipeShell(script)) {
        collector.add('GITLAB_CURL_PIPE_SHELL', doc.lineOf(name, key), `Job "${name}" pipes a download into a shell.`, script);
      }
    });
  }
  const image = imageName(own.image);
  if (image && isUnpinnedImage(image)) {
    collector.add('GITLAB_IMAGE_UNPINNED', doc.lineOf(name, 'image'), `Job "${name}" uses unpinned image "${image}".`, image);
  }
  checkVariables(own.variables, collector, doc.lineOf(name, 'variables'));
  if (own.rules !== undefined && (own.only !== undefined || own.except !== undefined)) {
    collector.add('GITLAB_RULES_AND_ONLY', doc.lineOf(name, 'rules'), `Job "${name}" combines rules with only/except.`);
  }
  if (own.only !== undefined || own.except !== undefined) {
    collector.add('GITLAB_ONLY_EXCEPT_DEPRECATED', doc.lineOf(name, own.only !== undefined ? 'only' : 'except'), `Job "${name}" uses legacy only/except.`);
  }
  const artifacts = asMap(own.artifacts);
  if (artifacts && (artifacts.paths !== undefined || artifacts.untracked === true) && artifacts.expire_in === undefined) {
    collector.add('GITLAB_ARTIFACT_NO_EXPIRY', doc.lineOf(name, 'artifacts'), `Artifacts of job "${name}" never expire.`);
  }
  const caches = Array.isArray(own.cache) ? own.cache : own.cache === undefined ? [] : [own.cache];
  for (const cache of caches) {
    const map = asMap(cache);
    if (map && map.paths !== undefined && map.key === undefined) {
      collector.add('GITLAB_CACHE_NO_KEY', doc.lineOf(name, 'cache'), `Cache of job "${name}" has no key.`);
    }
  }
  if (job.hidden) return;
  const hasScript = effective.script !== undefined || effective.trigger !== undefined || effective.run !== undefined;
  const unresolved = job.parents.some((p) => !doc.root[p]);
  if (!hasScript && !unresolved) {
    collector.add('GITLAB_JOB_NO_SCRIPT', doc.lineOf(name), `Job "${name}" has no script, trigger or run.`, name);
  }
  if (own.trigger !== undefined && own.script !== undefined) {
    collector.add('GITLAB_TRIGGER_WITH_SCRIPT', doc.lineOf(name, 'trigger'), `Job "${name}" defines both trigger and script.`);
  }
  if (isDeployLike(job)) {
    if (!hasGuard(effective)) {
      collector.add('GITLAB_DEPLOY_UNGUARDED', doc.lineOf(name), `Deploy job "${name}" runs on every pipeline.`, name);
    }
    if (effective.allow_failure === true) {
      collector.add('GITLAB_ALLOW_FAILURE_DEPLOY', doc.lineOf(name, 'allow_failure'), `Deploy job "${name}" is allowed to fail.`);
    }
  }
}

export function analyzeGitlab(source: string): Analysis {
  return analyzeYamlPipeline<GitlabRuleCode>(source, GITLAB_RULES, (doc, collector) => {
    const jobs = collectJobs(doc.root);
    const runnable = [...jobs.values()].filter((j) => !j.hidden);
    if (runnable.length === 0 && doc.root.include === undefined) {
      collector.add('GITLAB_NO_JOBS', 1, 'The pipeline defines no jobs.');
    }
    checkInclude(doc, collector);
    checkVariables(doc.root.variables, collector, doc.lineOf('variables'));
    const defaults = asMap(doc.root.default);
    for (const holder of [{ image: doc.root.image, path: 'image' }, { image: defaults?.image, path: 'default' }]) {
      const image = imageName(holder.image);
      if (image && isUnpinnedImage(image)) {
        collector.add('GITLAB_IMAGE_UNPINNED', doc.lineOf(holder.path), `Default image "${image}" is unpinned.`, image);
      }
    }
    flatStrings([doc.root.before_script, defaults?.before_script]).forEach((script) => {
      if (hasCurlPipeShell(script)) collector.add('GITLAB_CURL_PIPE_SHELL', doc.lineOf('before_script'), 'before_script pipes a download into a shell.', script);
    });
    checkGraph(jobs, doc, collector);
    jobs.forEach((job) => checkJob(job, doc, collector));
    const hasTimeout = (j: GitlabJob): boolean => j.effective.timeout !== undefined;
    const first = runnable.find((j) => !hasTimeout(j) && j.effective.trigger === undefined);
    if (first) {
      collector.add('GITLAB_NO_TIMEOUT', doc.lineOf(first.name), `Job "${first.name}" (and possibly others) has no timeout.`);
    }
  });
}
