import type { Analysis } from '../../core/types.js';
import type { JobModel, PipelineModel, StepModel } from '../../core/model.js';
import type { CiProvider } from '../../core/provider.js';
import { baseName } from '../shared/path.js';
import { parseDurationMinutes } from '../shared/text.js';
import { asMap, flatStrings, optionalProps, parseYamlForModel, type YamlDocument } from '../shared/yaml.js';
import { analyzeGitlab } from './analyzer.js';
import { collectJobs, environmentOf, needsOf, type GitlabJob } from './jobs.js';

function conditionOf(job: GitlabJob): string | undefined {
  const rules = (Array.isArray(job.effective.rules) ? job.effective.rules : [])
    .map((rule) => asMap(rule)?.if).filter((c): c is string => typeof c === 'string');
  if (rules.length > 0) return rules.join(' || ');
  const only = flatStrings(job.effective.only);
  return only.length > 0 ? `only: ${only.join(', ')}` : undefined;
}

function stepsOf(job: GitlabJob, doc: YamlDocument): StepModel[] {
  const lines = ['before_script', 'script', 'after_script'].flatMap((key) =>
    flatStrings(job.effective[key]).map((run) => ({ run, line: doc.lineOf(job.name, key) })));
  return lines.map(({ run, line }, index) => ({ index, line, run }));
}

function toJob(job: GitlabJob, doc: YamlDocument): JobModel {
  const image = job.effective.image;
  const imageName = typeof image === 'string' ? image : asMap(image)?.name;
  const environment = environmentOf(job.effective)?.name;
  const condition = conditionOf(job);
  const timeout = parseDurationMinutes(job.effective.timeout);
  return {
    id: job.name, line: doc.lineOf(job.name),
    needs: needsOf(job.own).map((n) => n.name),
    runsOn: typeof imageName === 'string' ? [imageName] : [],
    steps: stepsOf(job, doc),
    ...optionalProps({ environment, condition, timeoutMinutes: timeout }),
  };
}

export const gitlabCiProvider: CiProvider = {
  id: 'gitlab-ci',
  displayName: 'GitLab CI/CD',
  filePatterns: ['**/.gitlab-ci.yml', '**/.gitlab-ci.yaml'],
  matches: (relativePath: string): boolean => /^\.gitlab-ci\.ya?ml$/.test(baseName(relativePath)),
  analyze: (source: string): Analysis => analyzeGitlab(source),
  model(source: string): PipelineModel | undefined {
    const doc = parseYamlForModel(source);
    if (!doc) return undefined;
    const jobs = [...collectJobs(doc.root).values()].filter((j) => !j.hidden).map((j) => toJob(j, doc));
    return { provider: 'gitlab-ci', triggers: [{ event: 'pipeline' }], hasConcurrency: false, jobs };
  },
};
