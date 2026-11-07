import type { Analysis } from '../../core/types.js';
import type { JobModel, PipelineModel, StepModel, TriggerModel } from '../../core/model.js';
import type { CiProvider } from '../../core/provider.js';
import { baseName } from '../shared/path.js';
import { MAX_SOURCE_CHARS, optionalProps } from '../shared/yaml.js';
import { analyzeJenkins } from './analyzer.js';
import {
  findStatement, isShellStep, namedArgument, parseJenkinsfile, stageNodes, type StageNode,
} from './declarative.js';
import { stringsOf, type Statement } from './groovy.js';

const tokenText = (statement: Statement): string => statement.head.map((t) => t.text).join(' ');

function agentLabels(agent: Statement | undefined): string[] {
  if (!agent) return [];
  if (agent.head[1]?.text === 'any') return ['any'];
  const inner = agent.block?.find((s) => ['label', 'docker', 'image', 'dockerfile'].includes(s.name));
  const literal = inner ? stringsOf(inner)[0]?.text : undefined;
  return literal !== undefined ? [literal] : inner ? [inner.name] : [];
}

function stepsOf(stage: StageNode): StepModel[] {
  const steps = findStatement(stage.statement.block, 'steps')?.block ?? [];
  return steps.map((step, index) => {
    const command = isShellStep(step) ? stringsOf(step)[0]?.text : undefined;
    return { index, line: step.line, name: step.name, ...optionalProps({ run: command }) };
  });
}

function toJob(stage: StageNode, needs: readonly string[], pipelineAgent: Statement | undefined): JobModel {
  const block = stage.statement.block;
  const when = findStatement(block, 'when');
  const timeout = findStatement(findStatement(block, 'options')?.block, 'timeout');
  const minutes = timeout ? Number(namedArgument(timeout.head, 'time')?.text) : Number.NaN;
  return {
    id: stage.name, line: stage.line, name: stage.name, needs,
    runsOn: agentLabels(findStatement(block, 'agent') ?? pipelineAgent),
    steps: stepsOf(stage),
    ...optionalProps({
      condition: when?.block?.map(tokenText).join(' && '),
      timeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
    }),
  };
}

/** Walks stages in execution order; each stage needs the stages that finished right before it. */
function toJobs(nodes: readonly StageNode[], previous: readonly string[], agent: Statement | undefined): { jobs: JobModel[]; last: string[] } {
  const jobs: JobModel[] = [];
  let upstream = [...previous];
  for (const node of nodes) {
    if (node.parallel.length > 0) {
      const branches = node.parallel.map((branch) => toJobs([branch], upstream, agent));
      jobs.push(...branches.flatMap((b) => b.jobs));
      upstream = branches.flatMap((b) => b.last);
    } else if (node.nested.length > 0) {
      const nested = toJobs(node.nested, upstream, agent);
      jobs.push(...nested.jobs);
      upstream = nested.last;
    } else {
      jobs.push(toJob(node, upstream, agent));
      upstream = [node.name];
    }
  }
  return { jobs, last: upstream };
}

function triggersOf(pipeline: Statement): TriggerModel[] {
  const declared = findStatement(pipeline.block, 'triggers')?.block ?? [];
  const mapped = declared.map((t): TriggerModel => ({ event: t.name === 'cron' ? 'schedule' : t.name }));
  return mapped.length > 0 ? mapped : [{ event: 'push' }];
}

export const jenkinsProvider: CiProvider = {
  id: 'jenkins',
  displayName: 'Jenkins',
  filePatterns: ['**/Jenkinsfile', '**/Jenkinsfile.*', '**/*.jenkinsfile'],
  matches: (relativePath: string): boolean => /^(?:Jenkinsfile(?:\..+)?|.+\.jenkinsfile)$/.test(baseName(relativePath)),
  analyze: (source: string): Analysis => analyzeJenkins(source),
  model(source: string): PipelineModel | undefined {
    if (source.length > MAX_SOURCE_CHARS) return undefined;
    try {
      const { shape } = parseJenkinsfile(source);
      if (shape.kind !== 'declarative') return undefined;
      const { pipeline } = shape;
      const nodes = stageNodes(findStatement(pipeline.block, 'stages'));
      const { jobs } = toJobs(nodes, [], findStatement(pipeline.block, 'agent'));
      return {
        provider: 'jenkins', triggers: triggersOf(pipeline), jobs,
        hasConcurrency: findStatement(findStatement(pipeline.block, 'options')?.block, 'disableConcurrentBuilds') !== undefined,
      };
    } catch {
      return undefined; // Structural errors are reported by analyze(); there is no model to build.
    }
  },
};
