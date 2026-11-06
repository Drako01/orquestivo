import { asString } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';
import { isMutableReference } from './actions.js';

const REUSABLE_WORKFLOW_UNPINNED = meta('REUSABLE_WORKFLOW_UNPINNED', 'warning', 'security',
  'A reusable workflow referenced by a branch or tag can change under you and run new code with your secrets.',
  'Pin the reusable workflow to a full commit SHA.', DOCS.reusable);
const SECRETS_INHERIT_REVIEW = meta('SECRETS_INHERIT_REVIEW', 'warning', 'security',
  'secrets: inherit hands every secret to the called workflow.',
  'Pass only the secrets the called workflow needs, by name.', DOCS.reusable);
const REUSABLE_USES_FORMAT = meta('REUSABLE_USES_FORMAT', 'error', 'syntax',
  'A malformed reusable workflow reference is rejected by GitHub.',
  'Use ./.github/workflows/<file>.yml or <owner>/<repo>/.github/workflows/<file>.yml@<ref>.', DOCS.reusable);

const LOCAL = /^\.\/\.github\/workflows\/[^/@\s]+\.ya?ml$/;
const REMOTE = /^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[^@\s]+\.ya?ml@\S+$/;

export const reusableRule: Rule = {
  id: 'reusable',
  metas: [REUSABLE_WORKFLOW_UNPINNED, SECRETS_INHERIT_REVIEW, REUSABLE_USES_FORMAT],
  check(ctx) {
    for (const { id, job, path, reusable } of ctx.jobs) {
      if (!reusable) continue;
      const uses = asString(job.uses) as string;
      if (!LOCAL.test(uses) && !REMOTE.test(uses)) {
        ctx.report(REUSABLE_USES_FORMAT, 'Reusable workflow reference "' + uses + '" in "' + id + '" is malformed.',
          [...path, 'uses'], { snippet: uses });
      } else if (isMutableReference(uses)) {
        ctx.report(REUSABLE_WORKFLOW_UNPINNED, 'Reusable workflow "' + id + '" is not SHA-pinned.', [...path, 'uses'], { snippet: uses });
      }
      if (job.secrets === 'inherit') {
        ctx.report(SECRETS_INHERIT_REVIEW, 'Review secret inheritance for reusable job "' + id + '".', [...path, 'secrets']);
      }
    }
  },
};
