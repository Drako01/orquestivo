import type { Severity } from '../core/types.js';
import { safeHttpUrl } from './escape.js';

export interface LineBounds { readonly line: number; readonly start: number; readonly end: number }

const splitLines = (source: string): string[] => source.split(/\r\n|\r|\n/);

/** Zero-based range covering the finding line (from its column when known) in the analysed source. */
export function lineBounds(source: string, line1: number, column1?: number): LineBounds {
  const lines = splitLines(source);
  const line = Math.max(0, Math.min(line1 - 1, lines.length - 1));
  const length = lines[line]?.length ?? 0;
  const start = column1 !== undefined && column1 >= 1 ? Math.min(column1 - 1, length) : 0;
  return { line, start, end: Math.max(start, length) };
}

export interface FixInsertion { readonly line: number; readonly character: number; readonly text: string }

/**
 * Where to put a suggested snippet: right after the finding line, indented like it. The snippet is a
 * suggestion, not a patch, so the editor previews it and asks for confirmation before it is applied.
 */
export function planFixInsertion(source: string, line1: number, fix: string): FixInsertion {
  const lines = splitLines(source);
  const line = Math.max(0, Math.min(line1 - 1, lines.length - 1));
  const current = lines[line] ?? '';
  const indent = /^[ \t]*/.exec(current)?.[0] ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const body = splitLines(fix).map((l) => (l === '' ? l : indent + l)).join(eol);
  return { line, character: current.length, text: eol + body };
}

/** Documentation link usable as `Diagnostic.code.target`; anything but http(s) is dropped. */
export const docsTarget = (docs: string | undefined): string | undefined => safeHttpUrl(docs);

export type DiagnosticLevel = 'Error' | 'Warning' | 'Information';
export const DIAGNOSTIC_LEVEL: Readonly<Record<Severity, DiagnosticLevel>> = { error: 'Error', warning: 'Warning', information: 'Information' };
