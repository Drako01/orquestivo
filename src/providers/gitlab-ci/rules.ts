import { COMMON_RULES, type RuleCatalog } from '../shared/rules.js';

export const GITLAB_RULES = {
  ...COMMON_RULES,
  GITLAB_NO_JOBS: {
    severity: 'error', category: 'semantic',
    impact: 'GitLab rejects a pipeline without any job, so nothing would run.',
    recommendation: 'Define at least one job with a `script`, or `include` a file that does.',
  },
  GITLAB_JOB_NO_SCRIPT: {
    severity: 'error', category: 'semantic',
    impact: 'A job needs `script`, `trigger` or `run`; otherwise the pipeline is invalid.',
    recommendation: 'Add a `script` to the job, or mark it as a hidden template by prefixing its name with a dot.',
  },
  GITLAB_STAGE_UNDEFINED: {
    severity: 'error', category: 'semantic',
    impact: 'A job assigned to a stage that is not declared makes the whole pipeline invalid.',
    recommendation: 'Add the stage to the top-level `stages` list or fix the job `stage` value.',
  },
  GITLAB_STAGE_UNUSED: {
    severity: 'information', category: 'maintainability',
    impact: 'Declared stages without jobs add noise and can confuse readers.',
    recommendation: 'Remove the unused stage or assign a job to it.',
  },
  GITLAB_NEEDS_UNKNOWN: {
    severity: 'error', category: 'semantic',
    impact: 'Needing a job that does not exist makes the pipeline invalid.',
    recommendation: 'Fix the job name in `needs`, define the job, or mark the need `optional: true`.',
  },
  GITLAB_NEEDS_CYCLE: {
    severity: 'error', category: 'semantic',
    impact: 'Circular `needs` dependencies can never be scheduled.',
    recommendation: 'Break the cycle by removing one of the `needs` edges.',
  },
  GITLAB_NEEDS_LATER_STAGE: {
    severity: 'error', category: 'semantic',
    impact: 'A job can only need jobs from the same or an earlier stage.',
    recommendation: 'Move the jobs to a consistent stage order or drop the need.',
  },
  GITLAB_EXTENDS_UNKNOWN: {
    severity: 'error', category: 'semantic',
    impact: 'Extending a template that does not exist makes the pipeline invalid.',
    recommendation: 'Define the template job or fix the name in `extends`.',
  },
  GITLAB_EXTENDS_CYCLE: {
    severity: 'error', category: 'semantic',
    impact: 'Circular `extends` chains cannot be resolved.',
    recommendation: 'Break the inheritance cycle.',
  },
  GITLAB_TRIGGER_WITH_SCRIPT: {
    severity: 'error', category: 'semantic',
    impact: 'Trigger jobs cannot define `script`; GitLab rejects the job.',
    recommendation: 'Split the trigger and the script into separate jobs.',
  },
  GITLAB_RULES_AND_ONLY: {
    severity: 'error', category: 'semantic',
    impact: 'Combining `rules` with `only`/`except` is invalid in GitLab.',
    recommendation: 'Express the whole condition with `rules`.',
  },
  GITLAB_ONLY_EXCEPT_DEPRECATED: {
    severity: 'information', category: 'maintainability',
    impact: '`only`/`except` are legacy keywords with fewer capabilities than `rules`.',
    recommendation: 'Migrate to `rules` with `if` conditions.',
  },
  GITLAB_IMAGE_UNPINNED: {
    severity: 'warning', category: 'reliability',
    impact: 'Untagged or `latest` images change silently and make builds non reproducible or unsafe.',
    recommendation: 'Pin a specific version tag, ideally with an `@sha256` digest.',
  },
  GITLAB_SECRET_IN_VARIABLES: {
    severity: 'error', category: 'security',
    impact: 'Secrets committed in `variables` are visible to everyone with repository access.',
    recommendation: 'Store the value as a masked, protected CI/CD variable in project settings or a secret manager.',
  },
  GITLAB_CURL_PIPE_SHELL: {
    severity: 'warning', category: 'security',
    impact: 'Piping a download into a shell executes unverified remote code in the pipeline.',
    recommendation: 'Download to a file, verify a checksum or signature, then execute it.',
  },
  GITLAB_DEPLOY_UNGUARDED: {
    severity: 'warning', category: 'reliability',
    impact: 'A deploy job without `rules`/`only` or `when: manual` deploys on every pipeline, including merge requests.',
    recommendation: 'Restrict the job with `rules` (default branch or tags) and consider `when: manual`.',
  },
  GITLAB_ALLOW_FAILURE_DEPLOY: {
    severity: 'warning', category: 'reliability',
    impact: 'A deploy job allowed to fail leaves the pipeline green after a failed deployment.',
    recommendation: 'Remove `allow_failure: true` from deploy jobs.',
  },
  GITLAB_ARTIFACT_NO_EXPIRY: {
    severity: 'information', category: 'performance',
    impact: 'Artifacts without `expire_in` accumulate and consume storage indefinitely.',
    recommendation: 'Set `artifacts:expire_in`, for example `1 week`.',
  },
  GITLAB_CACHE_NO_KEY: {
    severity: 'warning', category: 'reliability',
    impact: 'A cache without `key` is shared by all branches and can be poisoned or stale.',
    recommendation: 'Set `cache:key`, for example `files: [package-lock.json]`.',
  },
  GITLAB_NO_TIMEOUT: {
    severity: 'information', category: 'reliability',
    impact: 'Jobs without a timeout fall back to the project default and can hang for hours.',
    recommendation: 'Set `default: timeout:` or a per-job `timeout`.',
  },
  GITLAB_INCLUDE_UNPINNED: {
    severity: 'warning', category: 'security',
    impact: 'Including a project file or component from a moving branch lets upstream changes alter this pipeline.',
    recommendation: 'Pin `ref` to a tag or commit SHA (or a component version).',
  },
  GITLAB_INCLUDE_INSECURE: {
    severity: 'error', category: 'security',
    impact: 'A plain HTTP include can be tampered with in transit.',
    recommendation: 'Use HTTPS or a `project`/`local` include.',
  },
} as const satisfies RuleCatalog;
export type GitlabRuleCode = keyof typeof GITLAB_RULES;
