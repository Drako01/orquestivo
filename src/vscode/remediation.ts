import * as vscode from 'vscode';
import { scopeContains, type ProjectScope } from '../core/project.js';
import { githubActionsProvider } from '../core/github/provider.js';
import { hashText, planFix, type FixPlan } from '../core/remediation.js';
import { isInsideFolder, type PreviewContent } from './generator.js';
import type { Logger } from './runtime.js';
import { relativePath, t } from './runtime.js';
import type { ScanStore } from './store.js';

interface Applied { readonly uri: vscode.Uri; readonly before: string; readonly after: string }

const MAX_INDEX = 100_000;
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INDEX;

/** The only component allowed to modify an existing workflow: preview, explicit consent, hash guard, rollback and undo. */
export class RemediationService {
  private last: Applied | undefined;

  constructor(
    private readonly store: ScanStore,
    private readonly previews: PreviewContent,
    private readonly scope: () => ProjectScope | undefined,
    private readonly log: Logger,
    private readonly rescan: () => Promise<void>,
  ) {}

  private async currentText(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  }

  private async replaceAll(uri: vscode.Uri, text: string): Promise<boolean> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), text);
    if (!await vscode.workspace.applyEdit(edit)) return false;
    return doc.save();
  }

  /** `arg` comes from an untrusted source (webview or command API): validate before use. */
  async improve(arg: unknown): Promise<void> {
    const raw = typeof arg === 'object' && arg !== null ? arg as Record<string, unknown> : {};
    if (!isIndex(raw['file']) || !isIndex(raw['index'])) return;
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(t('untrusted')); return; }
    const entry = this.store.entryById(raw['file']);
    const finding = entry?.file.result.findings[raw['index']];
    if (!entry || !finding || entry.source === undefined) return;
    const folder = vscode.workspace.getWorkspaceFolder(entry.uri);
    if (!folder || !scopeContains(this.scope(), entry.uri.toString())
      || !isInsideFolder(folder.uri, vscode.workspace.asRelativePath(entry.uri, false))) {
      await vscode.window.showWarningMessage(t('fixOutside'));
      return;
    }
    const current = await this.currentText(entry.uri);
    if (current !== entry.source) { await vscode.window.showWarningMessage(t('fixStale')); return; }
    const plan = planFix(current, entry.file.result.provider, finding);
    if (!plan) { await vscode.window.showInformationMessage(t('fixNotAvailable')); return; }

    const name = relativePath(entry.uri);
    await vscode.commands.executeCommand('vscode.diff', this.previews.register(plan.before), this.previews.register(plan.after),
      t('fixDiffTitle', { file: name }), { preview: true });
    const accept = t('fixApply');
    const answer = await vscode.window.showInformationMessage(
      t('fixConfirm', { file: name, summary: t(plan.summaryKey, plan.summaryParams) }), { modal: true }, accept);
    if (answer !== accept) return; // declined: nothing was written
    await this.apply(entry.uri, plan, name);
  }

  private async apply(uri: vscode.Uri, plan: FixPlan, name: string): Promise<void> {
    // Re-check right before writing: the file may have changed while the user reviewed the diff.
    const now = await this.currentText(uri);
    if (hashText(now) !== plan.sourceHash) { await vscode.window.showWarningMessage(t('fixStale')); return; }
    let written = false;
    try { written = await this.replaceAll(uri, plan.after); } catch (error) { this.log.error(`Cannot write ${name}`, error); }
    if (!written) {
      try { await this.replaceAll(uri, plan.before); } catch (error) { this.log.error(`Rollback failed for ${name}`, error); }
      await vscode.window.showErrorMessage(t('fixFailed'));
      return;
    }
    this.last = { uri, before: plan.before, after: plan.after };
    await this.rescan();
    const count = (text: string): number => githubActionsProvider.analyze(text).findings.length;
    await vscode.window.showInformationMessage(t('fixApplied', { file: name, before: count(plan.before), after: count(plan.after) }));
  }

  /** Reverts the last improvement only if the user has not edited the file since. */
  async undo(): Promise<void> {
    const last = this.last;
    if (!last) { await vscode.window.showInformationMessage(t('fixUndoNothing')); return; }
    const name = relativePath(last.uri);
    if (await this.currentText(last.uri) !== last.after) {
      const review = t('fixUndoReview');
      const choice = await vscode.window.showWarningMessage(t('fixUndoConflict'), review);
      if (choice === review) {
        await vscode.commands.executeCommand('vscode.diff', this.previews.register(last.before), last.uri, t('fixDiffTitle', { file: name }));
      }
      return;
    }
    if (!await this.replaceAll(last.uri, last.before)) { await vscode.window.showErrorMessage(t('fixFailed')); return; }
    this.last = undefined;
    await this.rescan();
    await vscode.window.showInformationMessage(t('fixUndone', { file: name }));
  }
}
