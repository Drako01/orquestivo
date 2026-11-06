import { asString } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const CONTINUE_ON_ERROR_REVIEW = meta('CONTINUE_ON_ERROR_REVIEW', 'information', 'reliability',
  'A step that may fail silently can hide a broken quality gate.',
  'Keep continue-on-error only for genuinely optional steps and verify downstream gates.', DOCS.continueOnError);
const CONTINUE_ON_ERROR_GATE = meta('CONTINUE_ON_ERROR_GATE', 'warning', 'reliability',
  'A gate job (test, lint, scan, or one other jobs depend on) that cannot fail turns the check into decoration.',
  'Remove continue-on-error from gate jobs, or move the optional work into a separate non-blocking job.', DOCS.continueOnError);
const ALWAYS_OVERUSE = meta('ALWAYS_OVERUSE', 'information', 'reliability',
  'always() also runs on cancellation, wasting minutes and blocking cancel-in-progress; it is rarely what you want.',
  'Use !cancelled() for cleanup that must run after failures, and limit it to the steps that need it.', DOCS.statusFunctions);

const GATE_NAME = /(^|[^a-z0-9])(test|tests|lint|check|verify|security|scan|ci|build)([^a-z0-9]|$)/i;
/** Steps in one job that may use always() before it is considered overuse. */
export const ALWAYS_STEP_LIMIT = 2;
const usesAlways = (condition: unknown): boolean => /\balways\s*\(\s*\)/.test(asString(condition) ?? '');

export const reliabilityRule: Rule = {
  id: 'reliability',
  metas: [CONTINUE_ON_ERROR_REVIEW, CONTINUE_ON_ERROR_GATE, ALWAYS_OVERUSE],
  check(ctx) {
    const needed = new Set(ctx.jobs.flatMap((j) => j.needs));
    const alwaysSteps = new Map<string, number>();
    for (const { id, job, path } of ctx.jobs) {
      if (job['continue-on-error'] === true && (needed.has(id) || GATE_NAME.test(id))) {
        ctx.report(CONTINUE_ON_ERROR_GATE, 'Gate job "' + id + '" ignores its own failures.', [...path, 'continue-on-error']);
      }
      if (usesAlways(job.if)) {
        ctx.report(ALWAYS_OVERUSE, 'Job "' + id + '" runs even when the workflow is cancelled.', [...path, 'if']);
      }
    }
    for (const { job, step, path } of ctx.steps) {
      if (step['continue-on-error'] === true) {
        ctx.report(CONTINUE_ON_ERROR_REVIEW, 'This step ignores failures; verify downstream quality gates.', [...path, 'continue-on-error']);
      }
      if (!usesAlways(step.if)) continue;
      const count = (alwaysSteps.get(job.id) ?? 0) + 1;
      alwaysSteps.set(job.id, count);
      if (count === ALWAYS_STEP_LIMIT + 1) {
        ctx.report(ALWAYS_OVERUSE, 'Job "' + job.id + '" uses always() on more than ' + ALWAYS_STEP_LIMIT + ' steps.', [...path, 'if']);
      }
    }
  },
};
