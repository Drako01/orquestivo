import { COMMON_RULES, type RuleCatalog } from '../shared/rules.js';

export const JENKINS_RULES = {
  SOURCE_TOO_LARGE: COMMON_RULES.SOURCE_TOO_LARGE,
  ANALYZER_FAILURE: COMMON_RULES.ANALYZER_FAILURE,
  JENKINS_UNPARSEABLE_SCRIPTED: {
    severity: 'information', category: 'maintainability',
    impact: 'Scripted pipelines are arbitrary Groovy; Orquestivo does not guess their behavior, so no checks ran.',
    recommendation: 'Migrate to a declarative `pipeline { }` to get static diagnostics.',
  },
  JENKINS_SYNTAX_ERROR: {
    severity: 'error', category: 'syntax',
    impact: 'The Jenkinsfile structure is broken (unbalanced braces or unterminated strings) and will not load.',
    recommendation: 'Fix the syntax error reported at this location.',
  },
  JENKINS_NO_PIPELINE: {
    severity: 'error', category: 'semantic',
    impact: 'An empty Jenkinsfile defines no pipeline.',
    recommendation: 'Add a `pipeline { agent ... stages { ... } }` block.',
  },
  JENKINS_NO_STAGES: {
    severity: 'error', category: 'semantic',
    impact: 'A declarative pipeline requires a `stages` section with at least one stage.',
    recommendation: 'Add `stages { stage("Build") { steps { ... } } }`.',
  },
  JENKINS_STAGE_NO_STEPS: {
    severity: 'error', category: 'semantic',
    impact: 'A stage needs exactly one of `steps`, `stages`, `parallel` or `matrix`.',
    recommendation: 'Add a `steps` block to the stage.',
  },
  JENKINS_DUPLICATE_STAGE: {
    severity: 'error', category: 'semantic',
    impact: 'Stage names must be unique; Jenkins rejects duplicates.',
    recommendation: 'Rename one of the stages.',
  },
  JENKINS_NO_AGENT: {
    severity: 'error', category: 'semantic',
    impact: 'Declarative pipelines require an `agent` at the top level or in every stage.',
    recommendation: 'Add an `agent` directive.',
  },
  JENKINS_AGENT_ANY: {
    severity: 'warning', category: 'reliability',
    impact: '`agent any` can run on any executor, including ones without the required tooling or isolation.',
    recommendation: 'Select agents explicitly with a `label` or a pinned container.',
  },
  JENKINS_NO_TIMEOUT: {
    severity: 'warning', category: 'reliability',
    impact: 'Without a timeout a hung build can hold an executor indefinitely.',
    recommendation: 'Add `options { timeout(time: 30, unit: "MINUTES") }`.',
  },
  JENKINS_NO_BUILD_DISCARDER: {
    severity: 'information', category: 'performance',
    impact: 'Without `buildDiscarder` old builds and artifacts accumulate on the controller.',
    recommendation: 'Add `options { buildDiscarder(logRotator(numToKeepStr: "20")) }`.',
  },
  JENKINS_NO_POST: {
    severity: 'information', category: 'reliability',
    impact: 'Without a `post` section failures are not reported and workspaces are not cleaned.',
    recommendation: 'Add `post { always { ... } failure { ... } }` for notifications and cleanup.',
  },
  JENKINS_DOCKER_IMAGE_UNPINNED: {
    severity: 'warning', category: 'reliability',
    impact: 'Untagged or `latest` agent images change silently and make builds non reproducible.',
    recommendation: 'Pin a version tag, ideally with an `@sha256` digest.',
  },
  JENKINS_SH_INTERPOLATION: {
    severity: 'warning', category: 'security',
    impact: 'Groovy interpolates double-quoted strings before the shell runs, enabling command injection from parameters.',
    recommendation: 'Use single quotes and let the shell expand the variable, for example sh \'echo "$BRANCH"\'.',
  },
  JENKINS_CREDENTIAL_INTERPOLATION: {
    severity: 'warning', category: 'security',
    impact: 'Interpolating a credential into a double-quoted command leaks it into logs and process listings.',
    recommendation: 'Use single quotes so the shell reads the masked environment variable.',
  },
  JENKINS_HARDCODED_SECRET: {
    severity: 'error', category: 'security',
    impact: 'A secret written in the Jenkinsfile is visible to everyone with repository access.',
    recommendation: 'Bind it with `credentials("id")` from the Jenkins credentials store.',
  },
  JENKINS_DEPLOY_NO_APPROVAL: {
    severity: 'warning', category: 'reliability',
    impact: 'A deploy stage without an `input` step releases automatically with no human approval.',
    recommendation: 'Add an `input` step or directive before the deployment.',
  },
  JENKINS_PARALLEL_NO_FAILFAST: {
    severity: 'information', category: 'performance',
    impact: 'Without `failFast`, remaining parallel branches keep running after one fails.',
    recommendation: 'Add `failFast true` to the stage or `parallelsAlwaysFailFast()` to the options.',
  },
  JENKINS_CURL_PIPE_SHELL: {
    severity: 'warning', category: 'security',
    impact: 'Piping a download into a shell executes unverified remote code on the agent.',
    recommendation: 'Download to a file, verify a checksum or signature, then execute it.',
  },
} as const satisfies RuleCatalog;
export type JenkinsRuleCode = keyof typeof JENKINS_RULES;
