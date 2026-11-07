import { actionName, asString, withInputs } from '../context.js';
import type { Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const ACTION_NOT_PINNED = meta('ACTION_NOT_PINNED', 'warning', 'security',
  'Tags and branches are mutable; a compromised or moved ref runs new code in your pipeline.',
  'Pin the action to a full-length commit SHA and keep the version in a trailing comment.', DOCS.pinning);
const CHECKOUT_PERSIST_CREDENTIALS = meta('CHECKOUT_PERSIST_CREDENTIALS', 'warning', 'security',
  'checkout stores the token in .git/config; uploading the workspace as an artifact can leak it.',
  'Set persist-credentials: false on checkout unless a later step needs git push.', DOCS.hardening);

/** True when the reference is not an immutable SHA (local actions are always fine). */
export const isMutableReference = (value: string): boolean => {
  if (value.startsWith('./')) return false;
  if (value.startsWith('docker://')) return !/@sha256:[a-f0-9]{64}$/i.test(value);
  return !/@[a-f0-9]{40}$/i.test(value);
};

export const actionsRule: Rule = {
  id: 'actions',
  metas: [ACTION_NOT_PINNED, CHECKOUT_PERSIST_CREDENTIALS],
  check(ctx) {
    const uploading = new Set(ctx.steps.filter((s) => actionName(s.step) === 'actions/upload-artifact').map((s) => s.job.id));
    for (const { job, step, path } of ctx.steps) {
      const uses = asString(step.uses)?.trim();
      if (!uses) continue;
      if (isMutableReference(uses)) {
        ctx.report(ACTION_NOT_PINNED, 'External action is not pinned to an immutable SHA.', [...path, 'uses'], { snippet: uses });
      }
      if (actionName(step) === 'actions/checkout' && withInputs(step)['persist-credentials'] === undefined &&
          uploading.has(job.id)) {
        ctx.report(CHECKOUT_PERSIST_CREDENTIALS,
          'checkout keeps credentials while "' + job.id + '" uploads an artifact.', path,
          { fix: 'with:\n  persist-credentials: false' });
      }
    }
  },
};
