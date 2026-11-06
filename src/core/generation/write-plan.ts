/**
 * Pure planning of a file write. The UI layer shows `diff`, asks for confirmation
 * when required, performs the I/O and keeps the `rollback` data to undo it.
 */
export const DEFAULT_WORKFLOW_PATH = '.github/workflows/ci.yml';
const CONTEXT_LINES = 3;

export type DiffLine = { readonly kind: 'context' | 'add' | 'remove'; readonly text: string };

export interface WritePlan {
  /** `create`: no file yet. `overwrite`: differs from the existing file. `unchanged`: identical. */
  readonly action: 'create' | 'overwrite' | 'unchanged';
  readonly path: string;
  readonly previousContent?: string | undefined;
  readonly newContent: string;
  /** True for any action that would replace existing content. */
  readonly requiresConfirmation: boolean;
  readonly diff: readonly DiffLine[];
  /** Unified-diff style text with hunk headers, ready to display. */
  readonly unifiedDiff: string;
}

export type WriteOperation = { readonly kind: 'write-file'; readonly path: string; readonly content: string };
export type RollbackOperation =
  | { readonly kind: 'delete-file'; readonly path: string }
  | { readonly kind: 'restore-content'; readonly path: string; readonly content: string }
  | { readonly kind: 'none' };

export class WriteRefusedError extends Error {
  constructor(readonly plan: WritePlan) {
    super('Refusing to overwrite "' + plan.path + '" without explicit confirmation.');
    this.name = 'WriteRefusedError';
  }
}

const normalize = (text: string): string => text.replace(/\r\n/g, '\n');
const splitLines = (text: string): string[] => {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Line diff through the longest common subsequence (workflow files are small). */
function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const width = after.length + 1;
  const table = new Int32Array((before.length + 1) * width);
  const cell = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] = before[i] === after[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { result.push({ kind: 'context', text: before[i] ?? '' }); i++; j++; }
    else if (cell(i + 1, j) >= cell(i, j + 1)) { result.push({ kind: 'remove', text: before[i++] ?? '' }); }
    else { result.push({ kind: 'add', text: after[j++] ?? '' }); }
  }
  while (i < before.length) result.push({ kind: 'remove', text: before[i++] ?? '' });
  while (j < after.length) result.push({ kind: 'add', text: after[j++] ?? '' });
  return result;
}

const PREFIX = { context: ' ', add: '+', remove: '-' } as const;

function formatUnified(path: string, diff: readonly DiffLine[], created: boolean): string {
  if (!diff.some((line) => line.kind !== 'context')) return '';
  const changed = diff.flatMap((line, index) => (line.kind === 'context' ? [] : [index]));
  const hunks: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(diff.length, index + CONTEXT_LINES + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end) last.end = end;
    else hunks.push({ start, end });
  }
  const out = [created ? '--- /dev/null' : '--- a/' + path, '+++ b/' + path];
  for (const { start, end } of hunks) {
    const slice = diff.slice(start, end);
    const oldBefore = diff.slice(0, start).filter((l) => l.kind !== 'add').length;
    const newBefore = diff.slice(0, start).filter((l) => l.kind !== 'remove').length;
    const oldCount = slice.filter((l) => l.kind !== 'add').length;
    const newCount = slice.filter((l) => l.kind !== 'remove').length;
    out.push('@@ -' + (oldCount === 0 ? oldBefore : oldBefore + 1) + ',' + oldCount + ' +' +
      (newCount === 0 ? newBefore : newBefore + 1) + ',' + newCount + ' @@');
    out.push(...slice.map((l) => PREFIX[l.kind] + l.text));
  }
  return out.join('\n') + '\n';
}

/** Plans a write. Never touches the disk; an existing, different file always requires confirmation. */
export function createWritePlan(
  existingContent: string | undefined, generated: string, path: string = DEFAULT_WORKFLOW_PATH,
): WritePlan {
  const diff = diffLines(splitLines(normalize(existingContent ?? '')), splitLines(normalize(generated)));
  const action = existingContent === undefined ? 'create'
    : normalize(existingContent) === normalize(generated) ? 'unchanged' : 'overwrite';
  return {
    action, path, previousContent: existingContent, newContent: generated,
    requiresConfirmation: action === 'overwrite', diff,
    unifiedDiff: formatUnified(path, diff, action === 'create'),
  };
}

/** Alias kept for callers that think in terms of "planning a write". */
export const planWrite = createWritePlan;

/** The inverse of applying `plan`, as data for the UI layer to execute. */
export function createRollback(plan: WritePlan): RollbackOperation {
  switch (plan.action) {
    case 'create': return { kind: 'delete-file', path: plan.path };
    case 'overwrite': return { kind: 'restore-content', path: plan.path, content: plan.previousContent ?? '' };
    case 'unchanged': return { kind: 'none' };
  }
}

export interface AuthorizedWrite {
  /** `undefined` when nothing needs writing. */
  readonly write?: WriteOperation | undefined;
  readonly rollback: RollbackOperation;
}

/** Turns a plan into the operation to execute; refuses an unconfirmed overwrite. */
export function authorizeWrite(plan: WritePlan, options: { readonly confirmOverwrite?: boolean } = {}): AuthorizedWrite {
  if (plan.requiresConfirmation && options.confirmOverwrite !== true) throw new WriteRefusedError(plan);
  return {
    write: plan.action === 'unchanged' ? undefined : { kind: 'write-file', path: plan.path, content: plan.newContent },
    rollback: createRollback(plan),
  };
}
