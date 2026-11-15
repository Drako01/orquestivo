import * as vscode from 'vscode';
import { scopeKey, type ProjectScope } from '../core/project.js';
import type { IntentInput } from '../ui/view-model.js';
import type { DiagnosticsPublisher } from './diagnostics.js';
import { loadIntent } from './intent.js';
import type { ProjectSelection } from './project.js';
import type { Logger} from './runtime.js';
import { readSettings, t } from './runtime.js';
import { scanWorkspace } from './scanner.js';
import type { ScanStore } from './store.js';

interface Running { readonly key: string; readonly promise: Promise<void>; readonly cancel: () => void }

const rootUris = (scope: ProjectScope): vscode.Uri[] =>
  (scope.kind === 'project' ? [scope.root] : scope.roots).map((r) => vscode.Uri.parse(r.uri));

/** Orchestrates a scan: trust gate, project scope, progress/cancellation, store, Problems panel and intent contract. */
export class ScanService implements vscode.Disposable {
  private running: Running | undefined;
  private contract: IntentInput = { status: 'absent' };
  private generation = 0;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly store: ScanStore,
    private readonly diagnostics: DiagnosticsPublisher,
    private readonly selection: ProjectSelection,
    private readonly log: Logger,
  ) {
    // A different project invalidates everything shown so far and any scan still in flight.
    this.subscription = selection.onDidChange(() => {
      this.generation += 1;
      this.running?.cancel();
      this.contract = { status: 'absent' };
      this.diagnostics.publish([]);
      this.store.clear();
    });
  }

  get intent(): IntentInput { return this.contract; }

  /** `interactive` shows a cancellable notification and user messages; silent scans use the status bar progress. */
  run(interactive: boolean): Promise<void> {
    const key = scopeKey(this.selection.current);
    if (this.running?.key === key) return this.running.promise;
    this.running?.cancel();
    const source = new vscode.CancellationTokenSource();
    const generation = ++this.generation;
    const entry: Running = {
      key, cancel: () => { source.cancel(); },
      promise: this.execute(interactive, generation, source).finally(() => {
        source.dispose();
        if (this.running?.promise === entry.promise) this.running = undefined;
      }),
    };
    this.running = entry;
    return entry.promise;
  }

  private async execute(interactive: boolean, generation: number, source: vscode.CancellationTokenSource): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      if (interactive) await vscode.window.showWarningMessage(t('untrusted'));
      return;
    }
    if (interactive && this.selection.needsChoice && !(await this.selection.pick())) return;
    const scope = this.selection.current;
    if (!scope) {
      if (interactive) await vscode.window.showWarningMessage(t('noFolder'));
      return;
    }
    const settings = readSettings();
    const outcome = await vscode.window.withProgress(
      {
        location: interactive ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
        title: t('analyzeProgress'), cancellable: interactive,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => { source.cancel(); });
        return scanWorkspace(rootUris(scope), settings, source.token, this.log);
      });
    if (!outcome || generation !== this.generation) return; // cancelled or superseded: never publish stale results
    const contract = await loadIntent(this.log, this.selection.primaryUri);
    if (generation !== this.generation) return;
    this.contract = contract;
    this.diagnostics.publish(outcome.entries);
    this.store.set(outcome);
    if (!interactive) return;
    if (outcome.entries.length === 0) await vscode.window.showInformationMessage(t('noFiles'));
    else if (outcome.found > outcome.limit) {
      await vscode.window.showWarningMessage(t('scanTruncated', { scanned: outcome.limit, total: outcome.found }));
    }
  }

  dispose(): void { this.subscription.dispose(); this.running?.cancel(); }
}
