import * as vscode from 'vscode';
import type { IntentInput } from '../ui/view-model.js';
import type { DiagnosticsPublisher } from './diagnostics.js';
import { loadIntent } from './intent.js';
import type { Logger} from './runtime.js';
import { readSettings, t } from './runtime.js';
import { scanWorkspace } from './scanner.js';
import type { ScanStore } from './store.js';

/** Orchestrates a scan: trust gate, progress/cancellation, store, Problems panel and intent contract. */
export class ScanService {
  private running: Promise<void> | undefined;
  private contract: IntentInput = { status: 'absent' };

  constructor(
    private readonly store: ScanStore,
    private readonly diagnostics: DiagnosticsPublisher,
    private readonly log: Logger,
  ) {}

  get intent(): IntentInput { return this.contract; }

  /** `interactive` shows a cancellable notification and user messages; silent scans use the status bar progress. */
  run(interactive: boolean): Promise<void> {
    this.running ??= this.execute(interactive).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async execute(interactive: boolean): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      if (interactive) await vscode.window.showWarningMessage(t('untrusted'));
      return;
    }
    const settings = readSettings();
    const outcome = await vscode.window.withProgress(
      {
        location: interactive ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
        title: t('analyzeProgress'), cancellable: interactive,
      },
      (_progress, token) => scanWorkspace(settings, token, this.log));
    if (!outcome) return; // cancelled: keep the previous results
    this.contract = await loadIntent(this.log);
    this.diagnostics.publish(outcome.entries);
    this.store.set(outcome);
    if (!interactive) return;
    if (outcome.entries.length === 0) await vscode.window.showInformationMessage(t('noFiles'));
    else if (outcome.found > outcome.limit) {
      await vscode.window.showWarningMessage(t('scanTruncated', { scanned: outcome.limit, total: outcome.found }));
    }
  }
}
