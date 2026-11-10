// Dependency-free mutation operators over TypeScript source text.
// A tiny scanner skips comments, strings, template literals and regex literals so only code tokens are mutated.

const OPERATORS = [
  // Comparison flips
  ['===', '!=='], ['!==', '==='], ['==', '!='], ['!=', '=='],
  ['<=', '>'], ['>=', '<'],
  // Logical swaps
  ['&&', '||'], ['||', '&&'],
];
const SPACED = [[' < ', ' >= '], [' > ', ' <= '], [' + ', ' - '], [' - ', ' + '], [' * ', ' / ']];
const WORDS = [['true', 'false'], ['false', 'true']];
const RULE_CODE = /^[A-Z][A-Z0-9_]{2,}$/;

/** Returns [{ start, end, replacement, kind, line }] for every mutable site in `source`. */
export function findMutations(source) {
  const sites = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  const add = (start, end, replacement, kind) => sites.push({ start, end, replacement, kind, line: lineOf(start) });
  // String literals inside `type`/`interface` declarations (and `| 'A'` union continuations) are erased at compile time:
  // mutating them yields equivalent mutants that no test can kill and would only dilute the score.
  const TYPE_LEVEL_LINE = /^\s*(?:(?:export\s+)?(?:declare\s+)?(?:type|interface)\b|\|)/;
  const isTypeLevel = (index) => TYPE_LEVEL_LINE.test(source.slice(source.lastIndexOf('\n', index - 1) + 1, index));
  const regexAllowedAfter = /[(,=:[!&|?{};]$/;
  let last = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i = source.indexOf('*/', i + 2); i = i < 0 ? source.length : i + 2; continue; }
    if (c === '"' || c === "'") {
      const start = i++;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      i++;
      const body = source.slice(start + 1, i - 1);
      if (RULE_CODE.test(body) && !isTypeLevel(start)) add(start, i, `${c}MUTATED_${body}${c}`, 'rule-code');
      last = c;
      continue;
    }
    if (c === '`') {
      i++;
      let depth = 0;
      while (i < source.length && (source[i] !== '`' || depth)) {
        if (source[i] === '\\') i += 2;
        else if (source[i] === '$' && source[i + 1] === '{') { depth++; i += 2; }
        else if (source[i] === '}' && depth) { depth--; i++; }
        else i++;
      }
      i++; last = '`';
      continue;
    }
    if (c === '/' && regexAllowedAfter.test(last.trimEnd().slice(-1) || '(')) {
      i++;
      while (i < source.length && source[i] !== '/' && source[i] !== '\n') i += source[i] === '\\' ? 2 : source[i] === '[' ? (source.indexOf(']', i) - i + 1 || 1) : 1;
      i++;
      while (/[a-z]/.test(source[i] ?? '')) i++;
      last = '/';
      continue;
    }
    const three = source.slice(i, i + 3), two = source.slice(i, i + 2);
    const hit = OPERATORS.find(([from]) => from === three) ?? OPERATORS.find(([from]) => from === two);
    if (hit && !(two === '=>' || (hit[0] === '>=' && source[i - 1] === '=')) && !/[<>]/.test(source[i - 1] ?? '') ) {
      add(i, i + hit[0].length, hit[1], 'operator');
      i += hit[0].length; last = hit[0];
      continue;
    }
    const spaced = SPACED.find(([from]) => source.startsWith(from, i));
    if (spaced) {
      // String concatenation only builds user-facing message text; arithmetic mutants stay in scope.
      const concatenation = spaced[0] === ' + ' && (/['"`]$/.test(last) || /^['"`]/.test(source.slice(i + spaced[0].length)));
      if (!concatenation) add(i, i + spaced[0].length, spaced[1], 'operator');
      i += spaced[0].length; last = spaced[0];
      continue;
    }
    if (/[A-Za-z_$]/.test(c) && !/[\w$.]/.test(source[i - 1] ?? '')) {
      let j = i;
      while (/[\w$]/.test(source[j] ?? '')) j++;
      const word = source.slice(i, j);
      const swap = WORDS.find(([from]) => from === word);
      if (swap) add(i, j, swap[1], 'boolean');
      last = word; i = j;
      continue;
    }
    if (c === '!' && next !== '=' && /[\w(]/.test(next ?? '') && !/[\w)\]]$/.test(last)) {
      add(i, i + 1, '', 'negation-removal');
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return sites;
}

export const applyMutation = (source, site) => source.slice(0, site.start) + site.replacement + source.slice(site.end);

/** Deterministic, evenly spread selection of at most `max` sites. */
export function sample(sites, max) {
  if (sites.length <= max) return sites;
  const step = sites.length / max;
  return Array.from({ length: max }, (_, n) => sites[Math.floor(n * step)]);
}
