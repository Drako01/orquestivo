import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { analyzeWorkflow } from './core/analyzer.js';
import type { Finding, WorkflowFileResult } from './core/types.js';
import { tr, type TextKey } from './i18n.js';

type Node = { kind: 'file'; result: WorkflowFileResult } | { kind: 'finding'; result: WorkflowFileResult; finding: Finding };

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

class FindingsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changes = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private results: readonly WorkflowFileResult[] = [];
  setResults(results: readonly WorkflowFileResult[]): void { this.results = results; this.changes.fire(undefined); }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(vscode.workspace.asRelativePath(vscode.Uri.parse(node.result.uri)), vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.result.findings.length);
      item.iconPath = new vscode.ThemeIcon('file-code');
      return item;
    }
    const item = new vscode.TreeItem(`[${node.finding.code}] ${node.finding.message}`);
    item.tooltip = node.finding.message;
    item.iconPath = new vscode.ThemeIcon(node.finding.severity === 'error' ? 'error' : node.finding.severity === 'warning' ? 'warning' : 'info');
    item.command = { command: 'orquestivo.openFinding', title: 'Open finding', arguments: [node.result.uri, node.finding.line] };
    return item;
  }
  getChildren(node?: Node): Node[] {
    if (!node) return this.results.map(result => ({ kind: 'file', result }));
    return node.kind === 'file' ? node.result.findings.map(finding => ({ kind: 'finding', result: node.result, finding })) : [];
  }
}

function viewHtml(results: readonly WorkflowFileResult[], language: string): string {
  const t = (key: TextKey): string => htmlEscape(tr(key, language));
  const nonce = randomBytes(16).toString('base64');
  const findings = results.flatMap(result => result.findings.map(f => ({ ...f, path: vscode.workspace.asRelativePath(vscode.Uri.parse(result.uri)) })));
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'information').length;
  const resultMarkup = results.length ? findings.length ?
    `<div class="section-title">${t('findings')} <span class="muted">(${findings.length})</span></div>${findings.slice(0, 200).map(f => `<article class="finding"><span class="dot ${f.severity}"></span><div><strong>${htmlEscape(f.code)}</strong><p>${htmlEscape(f.message)}</p><small>${htmlEscape(f.path)} · ${f.line}</small></div></article>`).join('')}` :
    `<p class="empty">${t('clean')}</p>` : `<p class="empty">${t('empty')}</p>`;
  return `<!DOCTYPE html><html lang="${language.startsWith('es') ? 'es' : 'en'}"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
  :root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:28px;line-height:1.5}main{max-width:940px;margin:auto}.head{display:flex;align-items:center;gap:18px;margin-bottom:26px}.brand{display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:#14181d;color:#A6A3FF;font-size:32px;font-weight:800;border:1px solid #3B4261}.eyebrow{color:var(--vscode-descriptionForeground);font-size:11px;letter-spacing:.16em;text-transform:uppercase}h1{font-size:26px;margin:2px 0 0;letter-spacing:-.02em}p{margin:4px 0}.muted,small{color:var(--vscode-descriptionForeground)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:22px}.stat{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:12px;padding:18px}.value{font-size:28px;font-weight:750;font-variant-numeric:tabular-nums}.caption{font-size:12px;color:var(--vscode-descriptionForeground)}.panel{border:1px solid var(--vscode-panel-border);border-radius:14px;padding:22px;background:var(--vscode-sideBar-background)}.section-title{font-size:16px;font-weight:700;margin:0 0 15px}.finding{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-top:1px solid var(--vscode-panel-border)}.finding:first-of-type{border-top:0}.finding p{margin:4px 0}.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:7px;background:#7c8cf8}.dot.error{background:#ed6a77}.dot.warning{background:#e1ac5e}.empty{padding:18px 0;color:var(--vscode-descriptionForeground)}footer{margin:20px 0;color:var(--vscode-descriptionForeground);font-size:12px}
  </style></head><body><main><div class="head"><div class="brand" aria-hidden="true">O</div><div><div class="eyebrow">ORQUESTIVO · CI/CD</div><h1>${t('title')}</h1><p class="muted">${t('subtitle')}</p></div></div>
  <section class="cards" aria-label="Scan summary"><div class="stat"><div class="value">${results.length}</div><div class="caption">${t('files')}</div></div><div class="stat"><div class="value">${errors}</div><div class="caption">${t('errors')}</div></div><div class="stat"><div class="value">${warnings}</div><div class="caption">${t('warnings')}</div></div><div class="stat"><div class="value">${info}</div><div class="caption">${t('info')}</div></div></section>
  <section class="panel">${resultMarkup}</section><footer>${t('report')}</footer></main></body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new FindingsProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection('orquestivo');
  let results: readonly WorkflowFileResult[] = [];
  let panel: vscode.WebviewPanel | undefined;
  const language = vscode.env.language;
  const showHome = (): void => {
    if (panel) { panel.reveal(vscode.ViewColumn.One); panel.webview.html = viewHtml(results, language); return; }
    panel = vscode.window.createWebviewPanel('orquestivo.home', 'Orquestivo · CI/CD Workflow Studio', vscode.ViewColumn.One, { enableScripts: false, retainContextWhenHidden: true });
    panel.webview.html = viewHtml(results, language);
    panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
  };
  const scan = async (): Promise<void> => {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(tr('untrusted', language)); return; }
    const settings = vscode.workspace.getConfiguration('orquestivo.analysis');
    const maxFiles = settings.get<number>('maxFiles', 150);
    const maxBytes = settings.get<number>('maxFileBytes', 1048576);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: tr('analyzeProgress', language), cancellable: true }, async (_progress, token) => {
      const uris = await vscode.workspace.findFiles('**/.github/workflows/*.{yml,yaml}', '**/node_modules/**', maxFiles + 1, token);
      if (token.isCancellationRequested) return;
      const next: WorkflowFileResult[] = [];
      diagnostics.clear();
      for (const uri of uris.slice(0, maxFiles)) {
        if (token.isCancellationRequested) return;
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > maxBytes) {
            next.push({ uri: uri.toString(), path: vscode.workspace.asRelativePath(uri), findings: [{ code: 'FILE_LIMIT', severity: 'warning', line: 1, evidence: 'static', message: tr('oversized', language) }], syntaxValid: false, executionVerified: false });
            continue;
          }
          const analyzed = analyzeWorkflow(new TextDecoder().decode(bytes));
          next.push({ ...analyzed, uri: uri.toString(), path: vscode.workspace.asRelativePath(uri) });
          const doc = await vscode.workspace.openTextDocument(uri);
          diagnostics.set(uri, analyzed.findings.map(f => {
            const line = Math.max(0, Math.min(f.line - 1, doc.lineCount - 1));
            const d = new vscode.Diagnostic(doc.lineAt(line).range, `[${f.code}] ${f.message}`, f.severity === 'error' ? vscode.DiagnosticSeverity.Error : f.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
            d.source = 'Orquestivo';
            d.code = f.code;
            return d;
          }));
        } catch {
          next.push({ uri: uri.toString(), path: vscode.workspace.asRelativePath(uri), findings: [{ code: 'FILE_READ', severity: 'warning', line: 1, evidence: 'static', message: tr('readError', language) }], syntaxValid: false, executionVerified: false });
        }
      }
      results = next;
      provider.setResults(next);
      if (panel) panel.webview.html = viewHtml(results, language);
      if (uris.length === 0) await vscode.window.showInformationMessage(tr('noFiles', language));
      if (uris.length > maxFiles) await vscode.window.showWarningMessage(`Orquestivo: scanned ${maxFiles} of ${uris.length} workflow files (configured limit).`);
    });
  };
  context.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider('orquestivo.overview', provider),
    vscode.commands.registerCommand('orquestivo.openHome', showHome),
    vscode.commands.registerCommand('orquestivo.analyze', async () => { await scan(); showHome(); }),
    vscode.commands.registerCommand('orquestivo.openFinding', async (uri: string, line: number) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      const editor = await vscode.window.showTextDocument(doc);
      const position = new vscode.Position(Math.max(0, Math.min(line - 1, doc.lineCount - 1)), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    })
  );
}
export function deactivate(): void {}
