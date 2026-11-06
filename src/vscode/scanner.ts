import * as vscode from 'vscode';
import { makeFinding } from '../core/findings.js';
import type { Finding, WorkflowFileResult } from '../core/types.js';
import { detectProvider, providerFilePatterns } from '../providers/registry.js';
import { LimitExceededError, assertMaxBytes } from '../security/limits.js';
import type { ScanFile } from '../ui/view-model.js';
import type { Logger} from './runtime.js';
import { relativePath, t, type Settings } from './runtime.js';

export interface ScanEntry {
  readonly file: ScanFile;
  readonly uri: vscode.Uri;
  /** Text that was analysed (the editor buffer when open); undefined if it could not be read. */
  readonly source: string | undefined;
}

export interface ScanOutcome {
  readonly entries: readonly ScanEntry[];
  /** Files found, capped at `maxFiles + 1`. */
  readonly found: number;
  readonly limit: number;
}

const EXCLUDE = '**/{node_modules,.git}/**';

/** One brace glob covering every provider's discovery patterns. */
export function discoveryGlob(): string {
  const patterns = providerFilePatterns.map((p) => (p.startsWith('**/') ? p : `**/${p}`));
  return `{${patterns.join(',')}}`;
}

async function readSource(uri: vscode.Uri, maxBytes: number): Promise<string> {
  // Prefer the open document: it holds unsaved edits and may differ from disk.
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    const text = open.getText();
    assertMaxBytes(text, maxBytes, relativePath(uri));
    return text;
  }
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > maxBytes) throw new LimitExceededError(relativePath(uri), maxBytes);
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > maxBytes) throw new LimitExceededError(relativePath(uri), maxBytes);
  return new TextDecoder('utf-8').decode(bytes);
}

function problemFinding(code: string, message: string): Finding {
  return makeFinding({
    code, severity: 'warning', category: 'configuration', message, line: 1,
    impact: t('scanProblemImpact'), recommendation: t('scanProblemRecommendation'),
  });
}

async function analyzeUri(uri: vscode.Uri, id: number, settings: Settings, log: Logger): Promise<ScanEntry> {
  const path = relativePath(uri);
  const provider = detectProvider(path);
  const providerName = provider?.displayName ?? '?';
  const base = { path, uri: uri.toString(), ...(provider ? { provider: provider.id } : {}) };
  const failed = (finding: Finding, source?: string): ScanEntry => ({
    file: { id, providerName, result: { ...base, findings: [finding], syntaxValid: false, executionVerified: false } },
    uri, source,
  });
  if (!provider) return failed(problemFinding('FILE_UNSUPPORTED', t('scanUnsupported')));

  let source: string;
  try {
    source = await readSource(uri, settings.maxFileBytes);
  } catch (error) {
    if (error instanceof LimitExceededError) return failed(problemFinding('FILE_LIMIT', t('oversized')));
    log.error(`Cannot read ${path}`, error);
    return failed(problemFinding('FILE_READ', t('readError')));
  }
  try {
    const result: WorkflowFileResult = { ...provider.analyze(source), ...base };
    return { file: { id, providerName, result, model: provider.model(source) }, uri, source };
  } catch (error) {
    log.error(`Analysis failed for ${path}`, error);
    return failed(problemFinding('ANALYSIS_FAILED', t('analysisFailed')), source);
  }
}

/** Discovers and analyses CI files of every provider. Returns undefined when cancelled. */
export async function scanWorkspace(settings: Settings, token: vscode.CancellationToken, log: Logger): Promise<ScanOutcome | undefined> {
  const found = await vscode.workspace.findFiles(discoveryGlob(), EXCLUDE, settings.maxFiles + 1, token);
  if (token.isCancellationRequested) return undefined;
  const uris = found.filter((uri) => detectProvider(relativePath(uri)) !== undefined)
    .sort((a, b) => relativePath(a).localeCompare(relativePath(b)))
    .slice(0, settings.maxFiles);
  const entries: ScanEntry[] = [];
  for (const [id, uri] of uris.entries()) {
    if (token.isCancellationRequested) return undefined;
    entries.push(await analyzeUri(uri, id, settings, log));
  }
  return { entries, found: found.length, limit: settings.maxFiles };
}
