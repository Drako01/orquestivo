import * as vscode from 'vscode';
import { t } from './runtime.js';
import type { ScanStore } from './store.js';
import { COMMANDS } from './tree.js';

/** Status bar counters with an accessible label (icons alone are not announced). */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

  constructor(private readonly store: ScanStore) {
    this.item.command = COMMANDS.openHome;
    store.onDidChange(() => this.update());
    this.update();
  }

  update(): void {
    if (!this.store.scanned) { this.item.hide(); return; }
    const { error, warning, information } = this.store.counts();
    this.item.text = `$(error) ${error} $(warning) ${warning} $(info) ${information}`;
    const label = t('statusBarLabel', { errors: error, warnings: warning, info: information });
    this.item.accessibilityInformation = { label, role: 'button' };
    this.item.tooltip = label;
    this.item.name = t('statusBarName');
    this.item.show();
  }

  dispose(): void { this.item.dispose(); }
}
