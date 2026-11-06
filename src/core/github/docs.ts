/** Official GitHub Actions documentation links, referenced by rule metadata. */
const BASE = 'https://docs.github.com/actions';
const SYNTAX = BASE + '/using-workflows/workflow-syntax-for-github-actions';

export const DOCS = {
  syntax: SYNTAX,
  events: BASE + '/using-workflows/events-that-trigger-workflows',
  branchFilters: SYNTAX + '#onpushbranchestagsbranches-ignoretags-ignore',
  pathFilters: SYNTAX + '#onpushpull_requestpull_request_targetpathspaths-ignore',
  schedule: SYNTAX + '#onschedule',
  needs: SYNTAX + '#jobsjob_idneeds',
  permissions: BASE + '/security-guides/automatic-token-authentication#permissions-for-the-github_token',
  hardening: BASE + '/security-guides/security-hardening-for-github-actions',
  scriptInjection: BASE + '/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections',
  pinning: BASE + '/security-guides/security-hardening-for-github-actions#using-third-party-actions',
  expressions: BASE + '/learn-github-actions/expressions',
  contexts: BASE + '/learn-github-actions/contexts',
  contextAvailability: BASE + '/learn-github-actions/contexts#context-availability',
  matrix: BASE + '/using-jobs/using-a-matrix-for-your-jobs',
  reusable: BASE + '/using-workflows/reusing-workflows',
  environments: BASE + '/deployment/targeting-different-environments/using-environments-for-deployment',
  concurrency: BASE + '/using-jobs/using-concurrency',
  artifacts: BASE + '/using-workflows/storing-workflow-data-as-artifacts',
  cache: BASE + '/using-workflows/caching-dependencies-to-speed-up-workflows',
  workflowCommands: BASE + '/using-workflows/workflow-commands-for-github-actions',
  serviceContainers: BASE + '/using-containerized-services/about-service-containers',
  jobContainers: BASE + '/using-jobs/running-jobs-in-a-container',
  oidc: BASE + '/security-guides/security-hardening-your-deployments/about-security-hardening-with-openid-connect',
  selfHosted: BASE + '/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security',
  timeouts: SYNTAX + '#jobsjob_idtimeout-minutes',
  continueOnError: SYNTAX + '#jobsjob_idcontinue-on-error',
  statusFunctions: BASE + '/learn-github-actions/expressions#status-check-functions',
} as const;
