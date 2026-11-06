/** Secret redaction for logs, errors and anything leaving the machine. Pure. */
export const REDACTED = '[REDACTED]';

interface Rule {
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const constant = (value: string) => () => value;

// Order matters: structural blocks first, then specific token shapes, then generic key=value.
const RULES: readonly Rule[] = [
  {
    // Terminated or truncated private key blocks (consume to end of input when unterminated).
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    replace: constant(`${REDACTED}_PRIVATE_KEY`),
  },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: constant(REDACTED) },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replace: constant(REDACTED) },
  { pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b/g, replace: constant(REDACTED) },
  { pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, replace: constant(REDACTED) },
  {
    pattern: /\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, scheme = '', space = ' ') => `${scheme}${space}${REDACTED}`,
  },
  {
    // scheme://user:password@host
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
    replace: (_m, head = '', _secret, at = '@') => `${head}${REDACTED}${at}`,
  },
  {
    pattern:
      /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)([^\s"'&,;]{4,})/gi,
    replace: (match, head = '', value = '') => (value === REDACTED ? match : `${head}${REDACTED}`),
  },
];

export interface RedactionResult {
  readonly text: string;
  /** Number of substitutions performed. */
  readonly count: number;
}

export function redactWithCount(input: string): RedactionResult {
  let count = 0;
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...groups: string[]) => {
      const replaced = rule.replace(match, ...groups);
      if (replaced !== match) count += 1;
      return replaced;
    });
  }
  return { text, count };
}

export function redactSecrets(input: string): string {
  return redactWithCount(input).text;
}

/** Redacts then bounds a (possibly downloaded) log so it cannot flood memory or UI. */
export function redactLog(input: string, maxChars = 100_000): string {
  const redacted = redactSecrets(input);
  return redacted.length <= maxChars ? redacted : `${redacted.slice(0, maxChars)}\n[TRUNCATED]`;
}

/** Redacts an unknown thrown value into a safe message. */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message);
}
