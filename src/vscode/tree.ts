import * as vscode from 'vscode';
import type { Finding } from '../core/types.js';
import type { TextKey } from '../i18n.js';
import { t } from './runtime.js';
import type { ScanEntry } from './scanner.js';
import type { ScanStore } from './store.js';

export const COMMANDS = {
  openHome: 'orquestivo.openHome',
  analyze: 'orquestivo.analyze',
  generate: 'orquestivo.generateCI',
  openFinding: 'orquestivo.openFinding',
  connectGitHub: 'orquestivo.connectGitHub',
  disconnectGitHub: 'orquestivo.disconnectGitHub',
  fetchRuns: 'orquestivo.fetchRuns',
  explainFinding: 'orquestivo.ai.explainFinding',
  undoGeneration: 'orquestivo.undoLastGeneration',
} as const;

type Node =
  | { readonly kind: 'action'; readonly command: string; readonly textKey: TextKey; readonly icon: string }
  | { readonly kind: 'file'; readonly entry: ScanEntry }
  | { readonly kind: 'finding'; readonly entry: ScanEntry; readonly finding: Finding };

const ACTIONS: readonly Extract<Node, { kind: 'action' }>[] = [
  { kind: 'action', command: COMMANDS.openHome, textKey: 'actionOpenHome', icon: 'dashboard' },
  { kind: 'action', command: COMMANDS.analyze, textKey: 'scan', icon: 'beaker' },
  { kind: 'action', command: COMMANDS.generate, textKey: 'actionGenerate', icon: 'add' },
];

const SEVERITY_ICON = { error: 'error', warning: 'warning', information: 'info' } as const;

/** Activity Bar view: quick actions on top, then the diagnostics grouped by file. */
export class FindingsTree implements vscode.TreeDataProvider<Node> {
  private readonly changes = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly store: ScanStore) {
    store.onDidChange(() => this.changes.fire(undefined));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'action') {
      const item = new vscode.TreeItem(t(node.textKey));
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.command = { command: node.command, title: t(node.textKey) };
      return item;
    }
    if (node.kind === 'file') {
      const result = node.entry.file.result;
      const item = new vscode.TreeItem(result.path, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${node.entry.file.providerName} · ${result.findings.length}`;
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.accessibilityInformation = { label: t('treeFileAria', { path: result.path, provider: node.entry.file.providerName, count: result.findings.length }) };
      return item;
    }
    const { finding } = node;
    const item = new vscode.TreeItem(`[${finding.code}] ${finding.message}`);
    item.tooltip = `${finding.message}\n\n${finding.recommendation}`;
    item.iconPath = new vscode.ThemeIcon(SEVERITY_ICON[finding.severity]);
    item.command = { command: COMMANDS.openFinding, title: t('actionOpenLine'), arguments: [node.entry.uri.toString(), finding.line] };
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) return [...ACTIONS, ...this.store.entries.map((entry): Node => ({ kind: 'file', entry }))];
    return node.kind === 'file'
      ? node.entry.file.result.findings.map((finding): Node => ({ kind: 'finding', entry: node.entry, finding })) : [];
  }
}
