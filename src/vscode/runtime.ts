import * as vscode from 'vscode';
import { tr, type Translate } from '../i18n.js';
import { clampInt, toLine, ANALYSIS_LIMITS, parseExperienceLevel, type ExperienceLevel } from '../ui/settings.js';
import { safeErrorMessage } from '../security/redact.js';

/** Translator bound to the current VS Code display language. */
export const t: Translate = (key, params) => tr(key, vscode.env.language, params);

export interface Settings {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly level: ExperienceLevel;
  readonly remoteEnabled: boolean;
  readonly aiEnabled: boolean;
}

/** Reads every setting through one place, clamping numbers to the schema range. */
export function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration('orquestivo');
  return {
    maxFiles: clampInt(config.get<unknown>('analysis.maxFiles'), ANALYSIS_LIMITS.maxFiles),
    maxFileBytes: clampInt(config.get<unknown>('analysis.maxFileBytes'), ANALYSIS_LIMITS.maxFileBytes),
    level: parseExperienceLevel(config.get<unknown>('ui.experienceLevel')),
    remoteEnabled: config.get<unknown>('remote.enabled') === true,
    aiEnabled: config.get<unknown>('ai.enabled') === true,
  };
}

/** Structured, redacted log channel; secrets and tokens never reach it. */
export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('Orquestivo');
  info(message: string): void { this.channel.appendLine(`[info] ${safeErrorMessage(message)}`); }
  error(message: string, error?: unknown): void {
    this.channel.appendLine(`[error] ${safeErrorMessage(message)}${error === undefined ? '' : `: ${safeErrorMessage(error)}`}`);
  }
  dispose(): void { this.channel.dispose(); }
}

/** Validates an untrusted command argument as a URI that lives inside an open workspace folder. */
export function resolveWorkspaceUri(arg: unknown): vscode.Uri | undefined {
  let uri: vscode.Uri | undefined;
  if (arg instanceof vscode.Uri) uri = arg;
  else if (typeof arg === 'string' && arg.length > 0 && arg.length <= 4096) {
    try { uri = vscode.Uri.parse(arg, true); } catch { return undefined; }
  }
  if (!uri || uri.scheme === 'command') return undefined;
  return vscode.workspace.getWorkspaceFolder(uri) ? uri : undefined;
}

/** Opens `uri` and puts the cursor on the 1-based `line`, clamped to the document. */
export async function revealLine(uri: vscode.Uri, line: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const position = new vscode.Position(Math.max(0, Math.min(toLine(line) - 1, doc.lineCount - 1)), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** Workspace-relative POSIX path. */
export const relativePath = (uri: vscode.Uri): string => vscode.workspace.asRelativePath(uri, false);
