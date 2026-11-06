import * as vscode from 'vscode';
import { buildDisclosure } from '../ai/consent.js';
import type { AiPayloadItem } from '../ai/provider.js';
import type { Finding } from '../core/types.js';
import { formatDisclosure } from '../ui/disclosure.js';
import { readSettings, t } from './runtime.js';
import type { ScanStore } from './store.js';

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Pulls `{ file, index }` out of an untrusted command argument. */
function parseRef(arg: unknown): { file: number; index: number } | undefined {
  if (typeof arg !== 'object' || arg === null) return undefined;
  const { file, index } = arg as Record<string, unknown>;
  return isIndex(file) && isIndex(index) ? { file, index } : undefined;
}

/**
 * Optional AI helper. No provider is bundled, so this only discloses what WOULD be shared (redacted)
 * and reports that nothing was sent. It never opens a network connection.
 */
export class AiExplainer {
  constructor(private readonly store: ScanStore) {}

  async explain(arg?: unknown): Promise<void> {
    if (!readSettings().aiEnabled) {
      const open = await vscode.window.showInformationMessage(t('aiDisabled'), t('actionOpenSettings'));
      if (open) await vscode.commands.executeCommand('workbench.action.openSettings', 'orquestivo.ai.enabled');
      return;
    }
    const finding = await this.chooseFinding(parseRef(arg));
    if (!finding) return;
    const items: AiPayloadItem[] = [{ label: t('aiItemFinding'), text: `${finding.code}: ${finding.message}` }];
    if (finding.snippet) items.push({ label: t('aiItemSnippet'), text: finding.snippet });
    const disclosure = buildDisclosure({ purpose: t('aiPurpose'), items });
    const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: formatDisclosure(disclosure, t) });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    await vscode.window.showInformationMessage(t('aiNoProvider'));
  }

  private async chooseFinding(ref: { file: number; index: number } | undefined): Promise<Finding | undefined> {
    if (ref) return this.store.entryById(ref.file)?.file.result.findings[ref.index];
    const options = this.store.entries.flatMap((e) => e.file.result.findings.map((finding) => ({
      label: `[${finding.code}] ${finding.message}`, description: e.file.result.path, finding,
    })));
    if (options.length === 0) { await vscode.window.showInformationMessage(t('aiNoFindings')); return undefined; }
    return (await vscode.window.showQuickPick(options, { placeHolder: t('aiChooseFinding'), ignoreFocusOut: true }))?.finding;
  }
}
