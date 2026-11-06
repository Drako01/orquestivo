/**
 * Bounded tokenizer and block parser for the declarative-Jenkinsfile subset of Groovy.
 * It only recovers structure (statement heads and `{}` blocks); it never evaluates code.
 */
export type TokenKind = 'ident' | 'string' | 'number' | 'punct';
export interface Token {
  readonly kind: TokenKind;
  /** Identifier/punctuation text, or the raw string content without quotes. */
  readonly text: string;
  /** Opening quote of a string token (`'`, `"`, `'''`, `"""`). */
  readonly quote?: string;
  readonly line: number;
  readonly newlineBefore: boolean;
}
export interface Statement {
  /** First token when it is an identifier, otherwise an empty string. */
  readonly name: string;
  readonly head: readonly Token[];
  readonly line: number;
  readonly block?: readonly Statement[];
}
export class GroovySyntaxError extends Error {
  constructor(message: string, readonly line: number) { super(message); }
}

export const MAX_TOKENS = 200_000;
const MAX_DEPTH = 64;
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const CONTINUES_LINE = new Set([',', '.', '+', '-', '*', '/', '=', '&', '|', '?', ':', '(', '[', '<', '>', '!']);
const STARTS_CONTINUATION = new Set(['.', '+', '&', '|', '?', ':']);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let newline = false;
  const push = (kind: TokenKind, text: string, startLine: number, quote?: string): void => {
    if (tokens.length >= MAX_TOKENS) throw new GroovySyntaxError('The Jenkinsfile has too many tokens.', startLine);
    tokens.push({ kind, text, line: startLine, newlineBefore: newline, ...(quote !== undefined ? { quote } : {}) });
    newline = false;
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === '\n') { line++; newline = true; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && next === '/' || ch === '#' && i === 0 && next === '!') {
      while (i < source.length && source.charAt(i) !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new GroovySyntaxError('Unterminated block comment.', line);
      line += source.slice(i, end).split('\n').length - 1;
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = source.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      const startLine = line;
      let j = i + quote.length;
      for (;;) {
        if (j >= source.length) throw new GroovySyntaxError('Unterminated string literal.', startLine);
        const c = source.charAt(j);
        if (c === '\\') { j += 2; continue; }
        if (source.startsWith(quote, j)) break;
        if (c === '\n') {
          if (quote.length === 1) throw new GroovySyntaxError('Unterminated string literal.', startLine);
          line++;
        }
        j++;
      }
      push('string', source.slice(i + quote.length, j), startLine, quote);
      i = j + quote.length;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source.charAt(j))) j++;
      push('ident', source.slice(i, j), line);
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[0-9A-Za-z_.]/.test(source.charAt(j))) j++;
      push('number', source.slice(i, j), line);
      i = j;
      continue;
    }
    push('punct', ch, line);
    i++;
  }
  return tokens;
}

/** Parses tokens into nested statements; throws {@link GroovySyntaxError} on unbalanced braces or excess nesting. */
export function parseStatements(tokens: readonly Token[]): Statement[] {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseStatement = (depth: number): Statement => {
    const head: Token[] = [];
    let nesting = 0;
    for (;;) {
      const token = peek();
      if (!token) break;
      const last = head[head.length - 1];
      if (last && nesting === 0 && token.newlineBefore
          && !(last.kind === 'punct' && CONTINUES_LINE.has(last.text))
          && !(token.kind === 'punct' && STARTS_CONTINUATION.has(token.text))) break;
      if (token.kind === 'punct') {
        if (token.text === '(' || token.text === '[') nesting++;
        else if (token.text === ')' || token.text === ']') nesting = Math.max(0, nesting - 1);
        else if (token.text === '{' && nesting === 0) {
          pos++;
          const block = parseBlock(depth + 1);
          const first = head[0];
          return { name: first?.kind === 'ident' ? first.text : '', head, line: first?.line ?? token.line, block };
        } else if (token.text === '{') nesting++;
        else if (token.text === '}') {
          if (nesting === 0) break;
          nesting--;
        } else if (token.text === ';' && nesting === 0) break;
      }
      head.push(token);
      pos++;
    }
    const first = head[0];
    return { name: first?.kind === 'ident' ? first.text : '', head, line: first?.line ?? 1 };
  };

  const parseBlock = (depth: number): Statement[] => {
    if (depth > MAX_DEPTH) throw new GroovySyntaxError('Blocks are nested too deeply.', peek()?.line ?? 1);
    const statements: Statement[] = [];
    for (;;) {
      const token = peek();
      if (!token) {
        throw new GroovySyntaxError('Unexpected end of file: missing closing brace.', tokens[tokens.length - 1]?.line ?? 1);
      }
      if (token.kind === 'punct' && token.text === '}') { pos++; return statements; }
      if (token.kind === 'punct' && token.text === ';') { pos++; continue; }
      const before = pos;
      statements.push(parseStatement(depth));
      if (pos === before) pos++;
    }
  };

  const top: Statement[] = [];
  while (peek()) {
    const token = peek() as Token;
    if (token.kind === 'punct' && token.text === '}') throw new GroovySyntaxError('Unexpected closing brace.', token.line);
    if (token.kind === 'punct' && token.text === ';') { pos++; continue; }
    const before = pos;
    top.push(parseStatement(0));
    if (pos === before) pos++;
  }
  return top;
}

/** String-literal tokens in a statement head. */
export const stringsOf = (statement: Statement): Token[] => statement.head.filter((t) => t.kind === 'string');
