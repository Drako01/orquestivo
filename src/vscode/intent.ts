import * as vscode from 'vscode';
import { INTENT_CONTRACT_PATH, IntentContractError, parseIntentContract } from '../core/evidence/intent.js';
import type { IntentInput } from '../ui/view-model.js';
import type { Logger} from './runtime.js';
import { t } from './runtime.js';

const MAX_INTENT_BYTES = 256 * 1024;

/** Reads and validates `.orquestivo/intent.json` from the first workspace folder (bounded read). */
export async function loadIntent(log: Logger): Promise<IntentInput> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !vscode.workspace.isTrusted) return { status: 'absent' };
  const uri = vscode.Uri.joinPath(folder.uri, ...INTENT_CONTRACT_PATH.split('/'));
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_INTENT_BYTES) return { status: 'invalid', issues: [{ path: '$', message: t('intentTooLarge') }] };
    const text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    return { status: 'ready', contract: parseIntentContract(text) };
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return { status: 'absent' };
    if (error instanceof IntentContractError) return { status: 'invalid', issues: error.issues };
    log.error('Cannot read the intent contract', error);
    return { status: 'invalid', issues: [{ path: '$', message: t('intentReadError') }] };
  }
}
