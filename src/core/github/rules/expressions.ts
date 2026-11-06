import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { contextRoots, functionCalls, isBalanced, KNOWN_CONTEXTS, KNOWN_FUNCTIONS } from '../expressions.js';
import { meta } from '../rule.js';

const EXPR_UNBALANCED = meta('EXPR_UNBALANCED', 'error', 'syntax',
  'A malformed ${{ }} expression fails at runtime or is passed through as literal text.',
  'Close every ${{ with }} and balance parentheses, brackets and quotes.', DOCS.expressions);
const EXPR_UNKNOWN_CONTEXT = meta('EXPR_UNKNOWN_CONTEXT', 'error', 'semantic',
  'Unknown contexts make GitHub reject the workflow ("Unrecognized named-value").',
  'Use a documented context: github, env, vars, job, jobs, steps, runner, secrets, strategy, matrix, needs, inputs.', DOCS.contexts);
const EXPR_UNKNOWN_FUNCTION = meta('EXPR_UNKNOWN_FUNCTION', 'error', 'semantic',
  'Unknown functions make GitHub reject the workflow.',
  'Use a documented function such as contains, startsWith, format, join, toJSON, fromJSON or hashFiles.', DOCS.expressions);
const EXPR_SECRETS_IN_IF = meta('EXPR_SECRETS_IN_IF', 'error', 'semantic',
  'The secrets context is not available in if: conditions, so the condition fails or is always false.',
  'Copy the secret into an env variable at job level and test that, or test a non-secret flag.', DOCS.contextAvailability);
const EXPR_CONTEXT_UNAVAILABLE = meta('EXPR_CONTEXT_UNAVAILABLE', 'error', 'semantic',
  'This context is not available at this workflow key, so the expression evaluates to empty or fails.',
  'Use a context that is available here (see context availability) or move the logic into a step.', DOCS.contextAvailability);
const EXPR_MATRIX_UNDEFINED = meta('EXPR_MATRIX_UNDEFINED', 'error', 'semantic',
  'The matrix context is empty in a job that defines no strategy.matrix.',
  'Define strategy.matrix on the job or remove the matrix reference.', DOCS.matrix);

/** Contexts that are unavailable per job-level key (GitHub context availability table). */
const UNAVAILABLE: Readonly<Record<string, ReadonlySet<string>>> = {
  if: new Set(['env', 'steps', 'job', 'runner', 'matrix', 'strategy']),
  'runs-on': new Set(['env', 'secrets', 'steps', 'job', 'runner']),
};

export const expressionsRule: Rule = {
  id: 'expressions',
  metas: [EXPR_UNBALANCED, EXPR_UNKNOWN_CONTEXT, EXPR_UNKNOWN_FUNCTION, EXPR_SECRETS_IN_IF,
    EXPR_CONTEXT_UNAVAILABLE, EXPR_MATRIX_UNDEFINED],
  check(ctx) {
    const hasMatrix = new Map(ctx.jobs.map((j) => [j.id, Boolean((j.job.strategy as { matrix?: unknown } | undefined)?.matrix)]));
    for (const site of ctx.sites) {
      if (site.unclosed) ctx.report(EXPR_UNBALANCED, 'Expression "${{" is never closed with "}}".', site.path);
      const jobLevel = site.path.length === 3 && site.jobId !== undefined;
      for (const expr of site.exprs) {
        if (!isBalanced(expr)) {
          ctx.report(EXPR_UNBALANCED, 'Unbalanced parentheses, brackets or quotes in expression.', site.path, { snippet: expr });
        }
        const roots = contextRoots(expr);
        for (const root of roots) {
          if (!KNOWN_CONTEXTS.has(root)) {
            ctx.report(EXPR_UNKNOWN_CONTEXT, 'Unknown context "' + root + '" in expression.', site.path, { snippet: expr });
          }
        }
        for (const fn of functionCalls(expr)) {
          if (!KNOWN_FUNCTIONS.has(fn.toLowerCase())) {
            ctx.report(EXPR_UNKNOWN_FUNCTION, 'Unknown function "' + fn + '" in expression.', site.path, { snippet: expr });
          }
        }
        if (site.isCondition && roots.includes('secrets')) {
          ctx.report(EXPR_SECRETS_IN_IF, 'The secrets context cannot be used in an if: condition.', site.path, { snippet: expr });
        }
        const blocked = jobLevel ? UNAVAILABLE[site.field] : undefined;
        for (const root of roots) {
          if (blocked?.has(root)) {
            ctx.report(EXPR_CONTEXT_UNAVAILABLE,
              'The "' + root + '" context is not available in jobs.' + site.jobId + '.' + site.field + '.', site.path, { snippet: expr });
          }
        }
        if (site.jobId !== undefined && roots.includes('matrix') && hasMatrix.get(site.jobId) === false) {
          ctx.report(EXPR_MATRIX_UNDEFINED, 'Job "' + site.jobId + '" uses the matrix context without strategy.matrix.', site.path, { snippet: expr });
        }
      }
    }
  },
};
