import * as vscode from 'vscode';
import type { Severity } from '../core/types.js';
import { docsTarget, lineBounds, planFixInsertion } from '../ui/diagnostics.js';
import type { ScanEntry } from './scanner.js';
import { t } from './runtime.js';
import type { ScanStore } from './store.js';

export const DIAGNOSTIC_SOURCE = 'Orquestivo';

const LEVEL: Readonly<Record<Severity, vscode.DiagnosticSeverity>> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

function toDiagnostics(entry: ScanEntry): vscode.Diagnostic[] {
  return entry.file.result.findings.map((finding) => {
    const bounds = lineBounds(entry.source ?? '', finding.line, finding.column);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(bounds.line, bounds.start, bounds.line, bounds.end), finding.message, LEVEL[finding.severity]);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    const target = docsTarget(finding.docs);
    diagnostic.code = target ? { value: finding.code, target: vscode.Uri.parse(target, true) } : finding.code;
    return diagnostic;
  });
}

/** Mirrors the scan into the Problems panel. */
export class DiagnosticsPublisher implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('orquestivo');

  publish(entries: readonly ScanEntry[]): void {
    this.collection.clear();
    for (const entry of entries) this.collection.set(entry.uri, toDiagnostics(entry));
  }

  dispose(): void { this.collection.dispose(); }
}

/** Offers a quick fix only for findings that carry a suggested `fix`; the edit is previewed and needs confirmation. */
export class FixActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

  constructor(private readonly store: ScanStore) {}

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE) continue;
      const code = typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : String(diagnostic.code ?? '');
      const finding = this.store.findingAt(document.uri, code, diagnostic.range.start.line + 1);
      if (!finding?.fix) continue;
      const insertion = planFixInsertion(document.getText(), finding.line, finding.fix);
      const action = new vscode.CodeAction(t('quickFixTitle', { code: finding.code }), vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.edit = new vscode.WorkspaceEdit();
      action.edit.insert(document.uri, new vscode.Position(insertion.line, insertion.character), insertion.text,
        { label: t('quickFixPreviewLabel'), needsConfirmation: true });
      actions.push(action);
    }
    return actions;
  }
}
