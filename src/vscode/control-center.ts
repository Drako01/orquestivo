import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseWebviewMessage, type WebviewCommand, type WebviewMessage } from '../ui/messages.js';
import { renderControlCenter } from '../ui/render.js';
import { toggleInSet, buildViewModel, NO_FILTERS, type Filters, type IntentInput } from '../ui/view-model.js';
import type { Logger} from './runtime.js';
import { readSettings, revealLine, t } from './runtime.js';
import type { RemoteEvidence } from './remote.js';
import type { ScanStore } from './store.js';
import { COMMANDS } from './tree.js';

export const HOME_VIEW_TYPE = 'orquestivo.home';

const WEBVIEW_COMMAND_IDS: Readonly<Record<WebviewCommand, string>> = {
  analyze: COMMANDS.analyze,
  generate: COMMANDS.generate,
  connectGitHub: COMMANDS.connectGitHub,
  disconnectGitHub: COMMANDS.disconnectGitHub,
  fetchRuns: COMMANDS.fetchRuns,
};

export interface ControlCenterSources {
  readonly store: ScanStore;
  readonly remote: RemoteEvidence;
  readonly intent: () => IntentInput;
}

/** The webview. All rendering lives in src/ui; this class only wires VS Code to it. */
export class ControlCenter implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private filters: Filters = NO_FILTERS;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sources: ControlCenterSources,
    private readonly log: Logger,
  ) {}

  show(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.One); this.refresh(); return; }
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(HOME_VIEW_TYPE, t('panelTitle'), vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [mediaRoot] });
    this.panel = panel;
    panel.webview.onDidReceiveMessage((raw: unknown) => { void this.handle(parseWebviewMessage(raw)); });
    panel.onDidDispose(() => { this.panel = undefined; });
    this.refresh();
  }

  refresh(): void {
    const panel = this.panel;
    if (!panel) return;
    const { store, remote, intent } = this.sources;
    const settings = readSettings();
    const model = buildViewModel({
      files: store.entries.map((e) => e.file),
      scanned: store.scanned,
      trusted: vscode.workspace.isTrusted,
      level: settings.level,
      filters: this.filters,
      intent: intent(),
      remote: { enabled: settings.remoteEnabled, connected: remote.isConnected, context: remote.context },
      aiEnabled: settings.aiEnabled,
      policy: { maxFiles: settings.maxFiles, maxFileBytes: settings.maxFileBytes },
      truncated: store.truncated,
    });
    const logo = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'icon-128.png'));
    panel.title = t('panelTitle');
    panel.webview.html = renderControlCenter(model, {
      nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource,
      language: vscode.env.language, logoUri: logo.toString(), t,
    });
  }

  private async handle(message: WebviewMessage | undefined): Promise<void> {
    if (!message) { this.log.info('Ignored an invalid webview message'); return; }
    switch (message.type) {
      case 'openLocation': {
        const entry = this.sources.store.entryById(message.file);
        if (entry) await revealLine(entry.uri, message.line);
        return;
      }
      case 'toggleFilter':
        this.filters = message.dimension === 'severity'
          ? { ...this.filters, severities: toggleInSet(this.filters.severities, message.value) }
          : { ...this.filters, categories: toggleInSet(this.filters.categories, message.value) };
        this.refresh();
        return;
      case 'clearFilters':
        this.filters = NO_FILTERS;
        this.refresh();
        return;
      case 'setLevel':
        await vscode.workspace.getConfiguration('orquestivo').update('ui.experienceLevel', message.level, vscode.ConfigurationTarget.Global);
        return; // The configuration listener re-renders.
      case 'explainFinding':
        await vscode.commands.executeCommand(COMMANDS.explainFinding, { file: message.file, index: message.index });
        return;
      case 'command':
        await vscode.commands.executeCommand(WEBVIEW_COMMAND_IDS[message.command]);
        return;
    }
  }

  dispose(): void { this.panel?.dispose(); }
}
