import { asString } from '../context.js';
import type { JobInfo, Rule } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const DEPLOY_ENVIRONMENT_MISSING = meta('DEPLOY_ENVIRONMENT_MISSING', 'warning', 'security',
  'Without an environment the job cannot use required reviewers, wait timers or environment-scoped secrets.',
  'Declare environment: <name> and configure protection rules for it in the repository settings.', DOCS.environments);
const DEPLOY_CONCURRENCY_MISSING = meta('DEPLOY_CONCURRENCY_MISSING', 'warning', 'reliability',
  'Overlapping deploys can race and leave the target in a mixed state.',
  'Add a concurrency group (cancel-in-progress: false) at job or workflow level.', DOCS.concurrency);

const DEPLOY_WORD = /(^|[^a-z0-9])(deploy|deployment|release|publish|production|prod|rollout)([^a-z0-9]|$)/i;

/** True for jobs that look like they ship software, judged by id and display name. */
export const isDeployLike = (info: JobInfo): boolean =>
  DEPLOY_WORD.test(info.id) || DEPLOY_WORD.test(asString(info.job.name) ?? '');

export const deployRule: Rule = {
  id: 'deploy',
  metas: [DEPLOY_ENVIRONMENT_MISSING, DEPLOY_CONCURRENCY_MISSING],
  check(ctx) {
    const workflowConcurrency = ctx.root.concurrency !== undefined;
    for (const info of ctx.jobs) {
      if (!isDeployLike(info)) continue;
      if (info.job.environment === undefined) {
        ctx.report(DEPLOY_ENVIRONMENT_MISSING, 'Deploy-like job "' + info.id + '" declares no environment.', info.path);
      }
      if (!workflowConcurrency && info.job.concurrency === undefined) {
        ctx.report(DEPLOY_CONCURRENCY_MISSING, 'Deploy-like job "' + info.id + '" has no concurrency control.', info.path);
      }
    }
  },
};
