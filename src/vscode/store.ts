import * as vscode from 'vscode';
import type { Finding } from '../core/types.js';
import type { ScanEntry, ScanOutcome } from './scanner.js';

/** Latest scan result shared by the tree, Control Center, diagnostics and status bar. */
export class ScanStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private outcome: ScanOutcome | undefined;

  get scanned(): boolean { return this.outcome !== undefined; }
  get entries(): readonly ScanEntry[] { return this.outcome?.entries ?? []; }
  get truncated(): { readonly scanned: number; readonly total: number } | undefined {
    return this.outcome && this.outcome.found > this.outcome.limit
      ? { scanned: this.outcome.limit, total: this.outcome.found } : undefined;
  }

  set(outcome: ScanOutcome): void {
    this.outcome = outcome;
    this.emitter.fire();
  }

  entryById(id: number): ScanEntry | undefined { return this.entries.find((e) => e.file.id === id); }

  entryByUri(uri: vscode.Uri): ScanEntry | undefined {
    const key = uri.toString();
    return this.entries.find((e) => e.uri.toString() === key);
  }

  findingAt(uri: vscode.Uri, code: string, line: number): Finding | undefined {
    return this.entryByUri(uri)?.file.result.findings.find((f) => f.code === code && f.line === line);
  }

  counts(): { readonly error: number; readonly warning: number; readonly information: number } {
    const counts = { error: 0, warning: 0, information: 0 };
    for (const { file } of this.outcome?.entries ?? []) for (const f of file.result.findings) counts[f.severity] += 1;
    return counts;
  }

  dispose(): void { this.emitter.dispose(); }
}
