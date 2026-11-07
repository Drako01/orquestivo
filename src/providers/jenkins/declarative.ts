import { parseStatements, tokenize, type Statement, type Token } from './groovy.js';

export const findStatement = (statements: readonly Statement[] | undefined, name: string): Statement | undefined =>
  statements?.find((s) => s.name === name);
export const findStatements = (statements: readonly Statement[] | undefined, name: string): Statement[] =>
  statements?.filter((s) => s.name === name) ?? [];

/** Every statement below `statements` (depth first), including the given ones. */
export function* walk(statements: readonly Statement[] | undefined): Generator<Statement> {
  for (const statement of statements ?? []) {
    yield statement;
    yield* walk(statement.block);
  }
}

export interface StageNode {
  readonly name: string;
  readonly line: number;
  readonly statement: Statement;
  /** Nested sequential stages (`stages { }` inside a stage). */
  readonly nested: readonly StageNode[];
  /** Parallel branches (`parallel { stage(...) }`). */
  readonly parallel: readonly StageNode[];
}

const firstString = (statement: Statement): string | undefined => statement.head.find((t) => t.kind === 'string')?.text;

function toStageNode(statement: Statement): StageNode {
  return {
    name: firstString(statement) ?? '', line: statement.line, statement,
    nested: stageNodes(findStatement(statement.block, 'stages')),
    parallel: stageNodes(findStatement(statement.block, 'parallel')),
  };
}
export const stageNodes = (container: Statement | undefined): StageNode[] =>
  findStatements(container?.block, 'stage').map(toStageNode);

/** Stages that carry steps themselves (no nested stages / parallel branches), in declaration order. */
export function leafStages(nodes: readonly StageNode[]): StageNode[] {
  return nodes.flatMap((node) =>
    node.nested.length + node.parallel.length === 0 ? [node] : [...leafStages(node.nested), ...leafStages(node.parallel)]);
}

export type JenkinsfileShape =
  | { readonly kind: 'declarative'; readonly pipeline: Statement }
  | { readonly kind: 'scripted' }
  | { readonly kind: 'empty' };

/** Splits a Jenkinsfile into declarative / scripted / empty. Throws GroovySyntaxError on structural errors. */
export function parseJenkinsfile(source: string): { statements: readonly Statement[]; shape: JenkinsfileShape } {
  const statements = parseStatements(tokenize(source));
  const pipeline = statements.find((s) => s.name === 'pipeline' && s.block !== undefined);
  if (pipeline) return { statements, shape: { kind: 'declarative', pipeline } };
  return { statements, shape: statements.length === 0 ? { kind: 'empty' } : { kind: 'scripted' } };
}

const SHELL_STEPS = new Set(['sh', 'bat', 'powershell', 'pwsh']);
export const isShellStep = (statement: Statement): boolean => SHELL_STEPS.has(statement.name);

/** Value of a named argument such as `time: 30` in `timeout(time: 30, unit: 'MINUTES')`. */
export function namedArgument(head: readonly Token[], key: string): Token | undefined {
  const index = head.findIndex((t, i) => t.text === key && head[i + 1]?.text === ':');
  return index < 0 ? undefined : head[index + 2];
}
