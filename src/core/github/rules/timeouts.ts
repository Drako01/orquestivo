import { positiveInt } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { hasExpression } from '../expressions.js';
import { meta } from '../rule.js';

const TIMEOUT_UNSET = meta('TIMEOUT_UNSET', 'information', 'reliability',
  'Without a timeout a hung job occupies a runner for up to six hours.',
  'Set timeout-minutes on the job to a realistic upper bound.', DOCS.timeouts);
const TIMEOUT_INVALID = meta('TIMEOUT_INVALID', 'error', 'semantic',
  'timeout-minutes must be a positive number; other values are rejected by GitHub.',
  'Use a positive integer, for example timeout-minutes: 15.', DOCS.timeouts);
const TIMEOUT_EXCESSIVE = meta('TIMEOUT_EXCESSIVE', 'information', 'reliability',
  'GitHub-hosted runners stop jobs after 360 minutes, so a larger value has no effect there.',
  'Lower the timeout to 360 minutes or less, or split the job.', DOCS.timeouts);

/** GitHub-hosted maximum job duration. */
export const MAX_HOSTED_TIMEOUT_MINUTES = 360;

export const timeoutsRule: Rule = {
  id: 'timeouts',
  metas: [TIMEOUT_UNSET, TIMEOUT_INVALID, TIMEOUT_EXCESSIVE],
  check(ctx) {
    for (const { id, job, path, reusable } of ctx.jobs) {
      const value = job['timeout-minutes'];
      const where = [...path, 'timeout-minutes'];
      if (value === undefined) {
        if (!reusable) ctx.report(TIMEOUT_UNSET, 'Job "' + id + '" lacks an explicit timeout.', path);
      } else if (!positiveInt(value) && !hasExpression(value)) {
        ctx.report(TIMEOUT_INVALID, 'Job "' + id + '" timeout-minutes must be a positive integer.', where);
      } else if (typeof value === 'number' && value > MAX_HOSTED_TIMEOUT_MINUTES) {
        ctx.report(TIMEOUT_EXCESSIVE, 'Job "' + id + '" timeout of ' + value + ' minutes exceeds the hosted limit.', where);
      }
    }
    for (const { job, step, path } of ctx.steps) {
      const value = step['timeout-minutes'];
      if (value !== undefined && !positiveInt(value) && !hasExpression(value)) {
        ctx.report(TIMEOUT_INVALID, 'Step timeout-minutes in "' + job.id + '" must be a positive integer.', [...path, 'timeout-minutes']);
      }
    }
  },
};
