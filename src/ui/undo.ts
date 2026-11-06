import type { RollbackOperation } from '../core/generator.js';
import { WORKFLOWS_DIR, validateWorkflowFileName } from './wizard.js';

/** What `orquestivo.undoLastGeneration` needs; persisted as plain JSON in workspace state. */
export interface UndoRecord {
  readonly folderUri: string;
  readonly rollback: Exclude<RollbackOperation, { kind: 'none' }>;
  /** Exact text that was written; undo asks again when the file changed since. */
  readonly written: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith(`${WORKFLOWS_DIR}/`)) return false;
  const name = path.slice(WORKFLOWS_DIR.length + 1);
  return validateWorkflowFileName(name) === undefined;
}

/** Validates persisted state: it may be stale or tampered with, so a bad record is simply dropped. */
export function parseUndoRecord(raw: unknown): UndoRecord | undefined {
  if (!isRecord(raw) || typeof raw['folderUri'] !== 'string' || typeof raw['written'] !== 'string') return undefined;
  const rollback = raw['rollback'];
  if (!isRecord(rollback) || !validPath(rollback['path'])) return undefined;
  if (rollback['kind'] === 'delete-file') {
    return { folderUri: raw['folderUri'], written: raw['written'], rollback: { kind: 'delete-file', path: rollback['path'] } };
  }
  if (rollback['kind'] === 'restore-content' && typeof rollback['content'] === 'string') {
    return { folderUri: raw['folderUri'], written: raw['written'], rollback: { kind: 'restore-content', path: rollback['path'], content: rollback['content'] } };
  }
  return undefined;
}
