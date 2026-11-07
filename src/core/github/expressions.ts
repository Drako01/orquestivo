/** Lexical helpers for GitHub `${{ }}` expressions. Purely textual: no evaluation. */

export const KNOWN_CONTEXTS: ReadonlySet<string> = new Set([
  'github', 'env', 'vars', 'job', 'jobs', 'steps', 'runner', 'secrets', 'strategy', 'matrix', 'needs', 'inputs',
]);

export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set([
  'contains', 'startswith', 'endswith', 'format', 'join', 'tojson', 'fromjson', 'hashfiles',
  'success', 'always', 'cancelled', 'failure',
]);

/** True when the value is a string containing a `${{ }}` expression. */
export const hasExpression = (value: unknown): boolean => typeof value === 'string' && value.includes('${{');

export interface ExtractedExpressions {
  /** Trimmed bodies of every well-formed `${{ ... }}`. For a bare condition, the whole text. */
  readonly exprs: readonly string[];
  /** True when a `${{` is never closed by `}}`. */
  readonly unclosed: boolean;
}

/** Splits `text` into its expression bodies. A bare condition (`if: a == b`) is itself one expression. */
export function extractExpressions(text: string, bareAllowed = false): ExtractedExpressions {
  const exprs: string[] = [];
  let unclosed = false;
  let from = 0;
  for (let open = text.indexOf('${{', from); open !== -1; open = text.indexOf('${{', from)) {
    const close = text.indexOf('}}', open + 3);
    if (close === -1) { unclosed = true; break; }
    exprs.push(text.slice(open + 3, close).trim());
    from = close + 2;
  }
  if (bareAllowed && !text.includes('${{') && text.trim() !== '') exprs.push(text.trim());
  return { exprs, unclosed };
}

/** Replaces single-quoted string literals (with `''` escapes) by an empty literal. */
export function stripStrings(expr: string): string {
  return expr.replace(/'(?:[^']|'')*'/g, "''");
}

/** True when parentheses/brackets and quotes of the expression are balanced. */
export function isBalanced(expr: string): boolean {
  if ((expr.match(/'/g)?.length ?? 0) % 2 !== 0) return false;
  let round = 0;
  let square = 0;
  for (const ch of stripStrings(expr)) {
    if (ch === '(') round++;
    else if (ch === ')') round--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

/** Context names used as the root of a property access (`github.ref`, `matrix['os']`). */
export function contextRoots(expr: string): string[] {
  const roots = new Set<string>();
  for (const m of stripStrings(expr).matchAll(/(?<![\w.\-$])([A-Za-z_][\w-]*)(?=\s*[.[])/g)) roots.add(m[1] as string);
  return [...roots];
}

/** Function names called in the expression. */
export function functionCalls(expr: string): string[] {
  const calls = new Set<string>();
  for (const m of stripStrings(expr).matchAll(/(?<![\w.\-$])([A-Za-z_][\w-]*)(?=\s*\()/g)) calls.add(m[1] as string);
  return [...calls];
}

/** Job ids referenced as `needs.<id>`. */
export function neededJobRefs(expr: string): string[] {
  const ids = new Set<string>();
  for (const m of stripStrings(expr).matchAll(/(?<![\w.\-])needs\.([A-Za-z_][\w-]*)/g)) ids.add(m[1] as string);
  return [...ids];
}
