import * as vscode from 'vscode';
import { detectProvider } from './providers/registry.js';
import { AiExplainer } from './vscode/ai.js';
import { ControlCenter } from './vscode/control-center.js';
import { DiagnosticsPublisher, FixActionProvider } from './vscode/diagnostics.js';
import { GeneratorWizard, PreviewContent } from './vscode/generator.js';
import { RemoteEvidence } from './vscode/remote.js';
import { Logger, relativePath, resolveWorkspaceUri, revealLine, t } from './vscode/runtime.js';
import { ScanService } from './vscode/scan-service.js';
import { StatusBar } from './vscode/status-bar.js';
import { ScanStore } from './vscode/store.js';
import { COMMANDS, FindingsTree } from './vscode/tree.js';

const RESCAN_DEBOUNCE_MS = 600;

/** Composition root: builds the services and wires them to VS Code. Logic lives in src/vscode and src/ui. */
export function activate(context: vscode.ExtensionContext): void {
  const log = new Logger();
  const store = new ScanStore();
  const diagnostics = new DiagnosticsPublisher();
  const scan = new ScanService(store, diagnostics, log);
  const remote = new RemoteEvidence(context.secrets, log);
  const center = new ControlCenter(context.extensionUri, { store, remote, intent: () => scan.intent }, log);
  const previews = new PreviewContent();
  const wizard = new GeneratorWizard(context.workspaceState, previews, log, async () => { await scan.run(false); center.show(); });
  const ai = new AiExplainer(store);
  const tree = new FindingsTree(store);

  // The Activity Bar is the primary entry point: opening its diagnostics view
  // must also reveal the Control Center in the editor, without a second click.
  const treeView = vscode.window.createTreeView('orquestivo.overview', { treeDataProvider: tree });
  const showHome = (): void => {
    center.show();
    if (!store.scanned) void scan.run(false);
  };

  let rescanTimer: NodeJS.Timeout | undefined;
  const scheduleRescan = (): void => {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => { void scan.run(false); }, RESCAN_DEBOUNCE_MS);
  };

  context.subscriptions.push(
    log, store, diagnostics, remote, center, treeView, new StatusBar(store),
    { dispose: () => clearTimeout(rescanTimer) },
    treeView.onDidChangeVisibility(({ visible }) => { if (visible) showHome(); }),
    store.onDidChange(() => center.refresh()),
    remote.onDidChange(() => center.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('orquestivo')) center.refresh(); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void scan.run(false); center.refresh(); }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (vscode.workspace.isTrusted && store.scanned && detectProvider(relativePath(doc.uri))) scheduleRescan();
    }),
    vscode.workspace.registerTextDocumentContentProvider(PreviewContent.scheme, previews),
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }, { scheme: 'vscode-vfs' }], new FixActionProvider(store), FixActionProvider.metadata),
    vscode.commands.registerCommand(COMMANDS.openHome, showHome),
    vscode.commands.registerCommand(COMMANDS.analyze, async () => { await scan.run(true); center.show(); }),
    vscode.commands.registerCommand(COMMANDS.generate, () => wizard.generate()),
    vscode.commands.registerCommand(COMMANDS.undoGeneration, () => wizard.undo()),
    vscode.commands.registerCommand(COMMANDS.connectGitHub, () => remote.connect()),
    vscode.commands.registerCommand(COMMANDS.disconnectGitHub, () => remote.disconnect()),
    vscode.commands.registerCommand(COMMANDS.fetchRuns, () => remote.fetchRuns()),
    vscode.commands.registerCommand(COMMANDS.explainFinding, (arg?: unknown) => ai.explain(arg)),
    vscode.commands.registerCommand(COMMANDS.openFinding, async (target: unknown, line: unknown) => {
      const uri = resolveWorkspaceUri(target);
      if (!uri) { await vscode.window.showWarningMessage(t('invalidTarget')); return; }
      await revealLine(uri, typeof line === 'number' ? line : 1);
    }),
  );
  void remote.refreshConnection();
  // When the view was restored already visible during activation, onDidChangeVisibility may not fire.
  if (treeView.visible) showHome();
}

export function deactivate(): void {}
