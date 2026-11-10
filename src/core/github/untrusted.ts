import { extractExpressions, stripStrings } from './expressions.js';

/**
 * Single source of truth for expression contexts an outside actor can influence (titles, branch names,
 * commit messages, dispatch inputs). Purely textual: there is no data-flow, so values copied through
 * `steps.*.outputs` or `env` indirections are not tracked.
 */
const UNTRUSTED_EVENT_OBJECTS = [
  'pull_request', 'pull_request_target', 'issue', 'comment', 'review', 'review_comment', 'discussion', 'pages',
  'head_commit', 'commits', 'workflow_run', 'release', 'client_payload', 'inputs',
] as const;

const EVENT_PATTERN = new RegExp(String.raw`^github\.event\.(?:${UNTRUSTED_EVENT_OBJECTS.join('|')})\b`);
const GITHUB_PATTERN = /^github\.(?:head_ref|ref_name)\b/;
const INPUT_PATTERN = /^inputs\.[A-Za-z_]/;
/** Attacker-independent scalars of the event objects (numbers, ids, commit hashes). */
const SAFE_SUFFIX = /\.(?:number|id|node_id|sha|run_number|run_attempt)$/;

/** `a['b']["c"]` -> `a.b.c`, so bracket access cannot hide a context from the patterns. */
const normalizeAccess = (expr: string): string => expr.replace(/\[\s*(['"])([\w-]+)\1\s*\]/g, '.$2');

/** Property-access chains (`github.event.issue.title`, `inputs.name`) found in an expression body. */
function accessChains(expr: string): string[] {
  const body = stripStrings(normalizeAccess(expr));
  return [...body.matchAll(/(?<![\w.\-$])([A-Za-z_][\w-]*(?:\.[\w*-]+|\[[^\]]*\])+)/g)].map((m) => m[1] as string);
}

const isUntrustedChain = (chain: string): boolean =>
  (EVENT_PATTERN.test(chain) || GITHUB_PATTERN.test(chain) || INPUT_PATTERN.test(chain)) && !SAFE_SUFFIX.test(chain);

/** Untrusted contexts referenced by any `${{ }}` expression in `text`, deduplicated, in order of appearance. */
export function untrustedContexts(text: string): string[] {
  const found = new Set<string>();
  for (const expr of extractExpressions(text).exprs) {
    for (const chain of accessChains(expr)) if (isUntrustedChain(chain)) found.add(chain);
  }
  return [...found];
}
