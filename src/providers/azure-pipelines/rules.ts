import { COMMON_RULES, type RuleCatalog } from '../shared/rules.js';

export const AZURE_RULES = {
  ...COMMON_RULES,
  AZURE_NO_WORK: {
    severity: 'error', category: 'semantic',
    impact: 'A pipeline without stages, jobs, steps or an extends template does nothing.',
    recommendation: 'Define `stages`, `jobs` or `steps`.',
  },
  AZURE_MIXED_STRUCTURE: {
    severity: 'error', category: 'semantic',
    impact: 'Azure Pipelines accepts only one of `stages`, `jobs` or `steps` at the top level.',
    recommendation: 'Keep one form; wrap jobs in a stage or steps in a job.',
  },
  AZURE_DUPLICATE_ID: {
    severity: 'error', category: 'semantic',
    impact: 'Stage and job identifiers must be unique within their scope.',
    recommendation: 'Rename one of the duplicated identifiers.',
  },
  AZURE_STAGE_DEPENDS_UNKNOWN: {
    severity: 'error', category: 'semantic',
    impact: 'Depending on a stage that does not exist makes the pipeline invalid.',
    recommendation: 'Fix the stage name in `dependsOn`.',
  },
  AZURE_STAGE_DEPENDS_CYCLE: {
    severity: 'error', category: 'semantic',
    impact: 'Circular stage dependencies can never be scheduled.',
    recommendation: 'Remove one of the `dependsOn` edges.',
  },
  AZURE_JOB_DEPENDS_UNKNOWN: {
    severity: 'error', category: 'semantic',
    impact: 'Depending on a job that does not exist in the same stage makes the pipeline invalid.',
    recommendation: 'Fix the job name in `dependsOn`.',
  },
  AZURE_JOB_DEPENDS_CYCLE: {
    severity: 'error', category: 'semantic',
    impact: 'Circular job dependencies can never be scheduled.',
    recommendation: 'Remove one of the `dependsOn` edges.',
  },
  AZURE_STEP_INVALID: {
    severity: 'error', category: 'semantic',
    impact: 'A step must be one of script, bash, pwsh, powershell, task, checkout, template, download, publish, ...',
    recommendation: 'Use a recognised step keyword.',
  },
  AZURE_TASK_VERSION_MISSING: {
    severity: 'error', category: 'semantic',
    impact: 'Tasks must declare a major version (`Task@N`); otherwise the pipeline fails validation.',
    recommendation: 'Reference the task as `Name@<major>`, for example `NodeTool@0`.',
  },
  AZURE_POOL_IMAGE_LATEST: {
    severity: 'warning', category: 'reliability',
    impact: '`*-latest` hosted images move to new OS versions without notice and can break builds.',
    recommendation: 'Pin a concrete image such as `ubuntu-24.04`.',
  },
  AZURE_TRIGGER_MISSING: {
    severity: 'information', category: 'configuration',
    impact: 'Without `trigger` the pipeline runs on every push to every branch.',
    recommendation: 'Declare `trigger` with explicit branches, or `trigger: none`.',
  },
  AZURE_TRIGGER_WILDCARD: {
    severity: 'warning', category: 'configuration',
    impact: 'Triggering on every branch wastes capacity and can run deployments from feature branches.',
    recommendation: 'List the branches that should trigger the pipeline.',
  },
  AZURE_PR_TRIGGER_MISSING: {
    severity: 'information', category: 'configuration',
    impact: 'Without a `pr` trigger, validation of pull requests depends on repository defaults.',
    recommendation: 'Declare `pr` explicitly, or `pr: none` when intentional.',
  },
  AZURE_SECRET_IN_VARIABLES: {
    severity: 'error', category: 'security',
    impact: 'Secrets committed in `variables` are visible to everyone with repository access.',
    recommendation: 'Use a secret variable, a variable group linked to Key Vault, or a service connection.',
  },
  AZURE_CURL_PIPE_SHELL: {
    severity: 'warning', category: 'security',
    impact: 'Piping a download into a shell executes unverified remote code in the pipeline.',
    recommendation: 'Download to a file, verify a checksum or signature, then execute it.',
  },
  AZURE_DEPLOYMENT_NO_ENVIRONMENT: {
    severity: 'error', category: 'semantic',
    impact: 'Deployment jobs require an `environment`; it also carries approvals and checks.',
    recommendation: 'Set `environment` on the deployment job.',
  },
  AZURE_DEPLOY_JOB_NOT_DEPLOYMENT: {
    severity: 'information', category: 'reliability',
    impact: 'A plain job named like a deployment gets no environment history, approvals or checks.',
    recommendation: 'Use a `deployment` job targeting an `environment`.',
  },
  AZURE_NO_TIMEOUT: {
    severity: 'information', category: 'reliability',
    impact: 'Jobs without `timeoutInMinutes` fall back to the platform default and can hang for an hour or more.',
    recommendation: 'Set `timeoutInMinutes` on jobs.',
  },
  AZURE_CONDITION_ALWAYS: {
    severity: 'warning', category: 'reliability',
    impact: '`always()` also runs when the pipeline is cancelled, wasting capacity or deploying unintentionally.',
    recommendation: 'Use `succeededOrFailed()` or an explicit status check.',
  },
  AZURE_REPO_RESOURCE_UNPINNED: {
    severity: 'warning', category: 'security',
    impact: 'Template repositories on a moving branch can change this pipeline without review.',
    recommendation: 'Pin `ref` to a tag or release branch.',
  },
  AZURE_CONTAINER_UNPINNED: {
    severity: 'warning', category: 'reliability',
    impact: 'Untagged or `latest` container images change silently and make builds non reproducible.',
    recommendation: 'Pin a version tag, ideally with an `@sha256` digest.',
  },
} as const satisfies RuleCatalog;
export type AzureRuleCode = keyof typeof AZURE_RULES;
