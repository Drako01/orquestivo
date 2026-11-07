import { EXPERIENCE_LEVELS, type ExperienceLevel } from './settings.js';
import { SEVERITIES, CATEGORIES } from './view-model.js';
import type { Category, Severity } from '../core/types.js';

/** Messages the webview may send to the extension host. Everything else is dropped. */
export type WebviewMessage =
  | { readonly type: 'openLocation'; readonly file: number; readonly line: number }
  | { readonly type: 'toggleFilter'; readonly dimension: 'severity'; readonly value: Severity }
  | { readonly type: 'toggleFilter'; readonly dimension: 'category'; readonly value: Category }
  | { readonly type: 'clearFilters' }
  | { readonly type: 'setLevel'; readonly level: ExperienceLevel }
  | { readonly type: 'explainFinding'; readonly file: number; readonly index: number }
  | { readonly type: 'command'; readonly command: WebviewCommand };

export const WEBVIEW_COMMANDS = ['analyze', 'generate', 'connectGitHub', 'disconnectGitHub', 'fetchRuns'] as const;
export type WebviewCommand = typeof WEBVIEW_COMMANDS[number];

const MAX_INDEX = 100_000;
const MAX_LINE = 10_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value);

/** Strict validation of an untrusted webview message: unknown types, extra keys and bad values yield undefined. */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return undefined;
  switch (raw['type']) {
    case 'openLocation':
      return hasExactKeys(raw, ['type', 'file', 'line']) && isInt(raw['file'], 0, MAX_INDEX) && isInt(raw['line'], 1, MAX_LINE)
        ? { type: 'openLocation', file: raw['file'], line: raw['line'] } : undefined;
    case 'toggleFilter': {
      if (!hasExactKeys(raw, ['type', 'dimension', 'value'])) return undefined;
      if (raw['dimension'] === 'severity' && oneOf(SEVERITIES, raw['value'])) return { type: 'toggleFilter', dimension: 'severity', value: raw['value'] };
      if (raw['dimension'] === 'category' && oneOf(CATEGORIES, raw['value'])) return { type: 'toggleFilter', dimension: 'category', value: raw['value'] };
      return undefined;
    }
    case 'clearFilters':
      return hasExactKeys(raw, ['type']) ? { type: 'clearFilters' } : undefined;
    case 'setLevel':
      return hasExactKeys(raw, ['type', 'level']) && oneOf(EXPERIENCE_LEVELS, raw['level']) ? { type: 'setLevel', level: raw['level'] } : undefined;
    case 'explainFinding':
      return hasExactKeys(raw, ['type', 'file', 'index']) && isInt(raw['file'], 0, MAX_INDEX) && isInt(raw['index'], 0, MAX_INDEX)
        ? { type: 'explainFinding', file: raw['file'], index: raw['index'] } : undefined;
    case 'command':
      return hasExactKeys(raw, ['type', 'command']) && oneOf(WEBVIEW_COMMANDS, raw['command'])
        ? { type: 'command', command: raw['command'] } : undefined;
    default:
      return undefined;
  }
}
