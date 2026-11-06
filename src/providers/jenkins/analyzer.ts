import type { Analysis } from '../../core/types.js';
import { FindingCollector } from '../shared/rules.js';
import { MAX_SOURCE_CHARS } from '../shared/yaml.js';
import { hasCurlPipeShell, isLiteralValue, isSecretName, isUnpinnedImage } from '../shared/text.js';
import {
  findStatement, findStatements, isShellStep, leafStages, parseJenkinsfile, stageNodes, walk, type StageNode,
} from './declarative.js';
import { GroovySyntaxError, stringsOf, type Statement } from './groovy.js';
import { JENKINS_RULES, type JenkinsRuleCode } from './rules.js';

type Collector = FindingCollector<JenkinsRuleCode>;
const INJECTABLE = /\$\{?\s*(?:params|env)\b|\$\{?(?:BRANCH_NAME|CHANGE_\w+|GIT_BRANCH|TAG_NAME)\b/;
const DEPLOY_STAGE = /\b(?:deploy\w*|release|promot\w*)\b/i;
const isInterpolating = (quote: string | undefined): boolean => quote === '"' || quote === '"""';

/** Image names declared by an `agent { docker ... }` directive. */
function agentImages(agent: Statement): { image: string; line: number }[] {
  const images: { image: string; line: number }[] = [];
  for (const statement of [agent, ...walk(agent.block)]) {
    const isImage = statement.name === 'image' || statement.name === 'docker';
    const literal = stringsOf(statement)[0];
    if (isImage && literal) images.push({ image: literal.text, line: statement.line });
  }
  return images;
}

/** Credential-bound and literal variables from an `environment { }` block. */
function readEnvironment(environment: Statement | undefined, collector: Collector, credentialVars: Set<string>): void {
  for (const entry of environment?.block ?? []) {
    const [name, equals, rhs, ...rest] = entry.head;
    if (name?.kind !== 'ident' || equals?.text !== '=' || !rhs) continue;
    if (rhs.text === 'credentials') { credentialVars.add(name.text); continue; }
    const literal = rhs.kind === 'string' && rest.length === 0 ? rhs.text : undefined;
    if (isSecretName(name.text) && isLiteralValue(literal)) {
      collector.add('JENKINS_HARDCODED_SECRET', entry.line, `Environment variable "${name.text}" holds a literal secret.`, name.text);
    }
  }
}

function checkShellSteps(root: Statement, credentialVars: ReadonlySet<string>, collector: Collector): void {
  const credentialUse = credentialVars.size > 0
    ? new RegExp(`\\$\\{?(?:env\\.)?(?:${[...credentialVars].join('|')})(?:_USR|_PSW)?\\b`) : undefined;
  for (const step of walk(root.block)) {
    if (!isShellStep(step)) continue;
    for (const literal of stringsOf(step)) {
      if (hasCurlPipeShell(literal.text)) {
        collector.add('JENKINS_CURL_PIPE_SHELL', literal.line, 'A shell step pipes a download into a shell.', literal.text);
      }
      if (!isInterpolating(literal.quote)) continue;
      if (INJECTABLE.test(literal.text)) {
        collector.add('JENKINS_SH_INTERPOLATION', literal.line, 'A double-quoted shell step interpolates params/env values.', literal.text);
      }
      if (credentialUse?.test(literal.text)) {
        collector.add('JENKINS_CREDENTIAL_INTERPOLATION', literal.line, 'A double-quoted shell step interpolates a credential.', literal.text);
      }
    }
  }
}

function checkStages(leaves: readonly StageNode[], all: readonly StageNode[], pipelineFailFast: boolean, collector: Collector): void {
  const names = new Set<string>();
  const visit = (nodes: readonly StageNode[]): void => {
    for (const node of nodes) {
      if (names.has(node.name)) collector.add('JENKINS_DUPLICATE_STAGE', node.line, `Duplicate stage "${node.name}".`, node.name);
      names.add(node.name);
      if (node.parallel.length > 0 && !pipelineFailFast && !findStatement(node.statement.block, 'failFast')) {
        collector.add('JENKINS_PARALLEL_NO_FAILFAST', node.line, `Parallel stage "${node.name}" lacks failFast.`, node.name);
      }
      visit(node.nested);
      visit(node.parallel);
    }
  };
  visit(all);
  for (const leaf of leaves) {
    const block = leaf.statement.block;
    if (!findStatement(block, 'steps') && !findStatement(block, 'matrix')) {
      collector.add('JENKINS_STAGE_NO_STEPS', leaf.line, `Stage "${leaf.name}" has no steps.`, leaf.name);
    }
    if (DEPLOY_STAGE.test(leaf.name) && ![...walk(block)].some((s) => s.name === 'input')) {
      collector.add('JENKINS_DEPLOY_NO_APPROVAL', leaf.line, `Deploy stage "${leaf.name}" has no input approval.`, leaf.name);
    }
  }
}

function checkPipeline(pipeline: Statement, collector: Collector): void {
  const block = pipeline.block ?? [];
  const stagesBlock = findStatement(block, 'stages');
  const nodes = stageNodes(stagesBlock);
  const leaves = leafStages(nodes);
  if (!stagesBlock || nodes.length === 0) {
    collector.add('JENKINS_NO_STAGES', stagesBlock?.line ?? pipeline.line, 'The pipeline declares no stages.');
  }
  const options = findStatement(block, 'options');
  const hasOption = (name: string): boolean => findStatement(options?.block, name) !== undefined;
  const agents = [findStatement(block, 'agent'), ...leaves.map((l) => findStatement(l.statement.block, 'agent'))];
  if (!agents[0] && leaves.some((_, i) => !agents[i + 1]) || !agents[0] && leaves.length === 0) {
    collector.add('JENKINS_NO_AGENT', pipeline.line, 'No agent is declared at pipeline or stage level.');
  }
  for (const agent of agents) {
    if (!agent) continue;
    if (agent.head[1]?.text === 'any') collector.add('JENKINS_AGENT_ANY', agent.line, 'The pipeline uses "agent any".');
    for (const { image, line } of agentImages(agent)) {
      if (isUnpinnedImage(image)) collector.add('JENKINS_DOCKER_IMAGE_UNPINNED', line, `Agent image "${image}" is unpinned.`, image);
    }
  }
  const stageTimeouts = leaves.length > 0 && leaves.every((l) =>
    findStatement(findStatement(l.statement.block, 'options')?.block, 'timeout'));
  if (!hasOption('timeout') && !stageTimeouts) {
    collector.add('JENKINS_NO_TIMEOUT', options?.line ?? pipeline.line, 'No timeout option is configured.');
  }
  if (!hasOption('buildDiscarder')) {
    collector.add('JENKINS_NO_BUILD_DISCARDER', options?.line ?? pipeline.line, 'No buildDiscarder option is configured.');
  }
  if (!findStatement(block, 'post')) collector.add('JENKINS_NO_POST', pipeline.line, 'The pipeline has no post section.');
  const credentialVars = new Set<string>();
  [findStatements(block, 'environment'), ...leaves.map((l) => findStatements(l.statement.block, 'environment'))]
    .flat().forEach((environment) => readEnvironment(environment, collector, credentialVars));
  checkShellSteps(pipeline, credentialVars, collector);
  checkStages(leaves, nodes, hasOption('parallelsAlwaysFailFast'), collector);
}

export function analyzeJenkins(source: string): Analysis {
  const collector = new FindingCollector<JenkinsRuleCode>(JENKINS_RULES);
  const result = (syntaxValid: boolean): Analysis =>
    ({ findings: collector.findings, syntaxValid, executionVerified: false });
  if (source.length > MAX_SOURCE_CHARS) {
    collector.add('SOURCE_TOO_LARGE', 1, `The file exceeds ${MAX_SOURCE_CHARS} characters and was not analysed.`);
    return result(false);
  }
  try {
    const { statements, shape } = parseJenkinsfile(source);
    if (shape.kind === 'empty') {
      collector.add('JENKINS_NO_PIPELINE', 1, 'The Jenkinsfile is empty.');
      return result(true);
    }
    if (shape.kind === 'scripted') {
      collector.add('JENKINS_UNPARSEABLE_SCRIPTED', statements[0]?.line ?? 1, 'Scripted pipeline detected; it was not analysed.');
      return result(true);
    }
    checkPipeline(shape.pipeline, collector);
    return result(true);
  } catch (error) {
    if (error instanceof GroovySyntaxError) {
      collector.add('JENKINS_SYNTAX_ERROR', error.line, error.message);
    } else {
      collector.add('ANALYZER_FAILURE', 1, `Analysis aborted: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result(false);
  }
}
