# CI providers

Every CI dialect implements `CiProvider` (`src/core/provider.ts`): `matches(path)`, `analyze(source)` and `model(source)`.
All findings are static evidence only; nothing here proves that a pipeline runs.

| Provider | Files | Parser | Rules |
| --- | --- | --- | --- |
| GitHub Actions | `.github/workflows/*.yml` | `yaml` | see `src/core/github` |
| GitLab CI/CD | `.gitlab-ci.yml` | `yaml` (merge keys enabled) | 22 provider rules + 4 common |
| Azure Pipelines | `azure-pipelines.yml` | `yaml` | 21 provider rules + 4 common |
| Jenkins | `Jenkinsfile`, `Jenkinsfile.*`, `*.jenkinsfile` | bounded Groovy tokenizer | 18 rules |

`src/providers/registry.ts` exports `providerRegistry` (`allProviders`, `filePatterns`, `detectProvider`, `getProvider`)
and `createProviderRegistry(providers)` for injection.

## Shared building blocks (`src/providers/shared`)

- `rules.ts`: `RuleCatalog` (severity, category, impact, recommendation per code) and `FindingCollector`.
- `yaml.ts`: `analyzeYamlPipeline` (size guard 1 MB, parse, root check, failure containment) and `parseYamlForModel`.
- `graph.ts`: `findCycleMembers` for `needs`, `extends` and `dependsOn` cycles.
- `text.ts`: secret-like names, `curl | sh`, unpinned images, durations.

Hostile or malformed input never throws: YAML errors become `YAML_INVALID`, unexpected failures become `ANALYZER_FAILURE`.

## GitLab CI rules

`GITLAB_NO_JOBS`, `GITLAB_JOB_NO_SCRIPT`, `GITLAB_STAGE_UNDEFINED`, `GITLAB_STAGE_UNUSED`, `GITLAB_NEEDS_UNKNOWN`,
`GITLAB_NEEDS_CYCLE`, `GITLAB_NEEDS_LATER_STAGE`, `GITLAB_EXTENDS_UNKNOWN`, `GITLAB_EXTENDS_CYCLE`,
`GITLAB_TRIGGER_WITH_SCRIPT`, `GITLAB_RULES_AND_ONLY`, `GITLAB_ONLY_EXCEPT_DEPRECATED`, `GITLAB_IMAGE_UNPINNED`,
`GITLAB_SECRET_IN_VARIABLES`, `GITLAB_CURL_PIPE_SHELL`, `GITLAB_DEPLOY_UNGUARDED`, `GITLAB_ALLOW_FAILURE_DEPLOY`,
`GITLAB_ARTIFACT_NO_EXPIRY`, `GITLAB_CACHE_NO_KEY`, `GITLAB_NO_TIMEOUT`, `GITLAB_INCLUDE_UNPINNED`, `GITLAB_INCLUDE_INSECURE`.

Included files are not resolved: a pipeline whose jobs live in includes may report `GITLAB_NO_JOBS` only when it has no `include`.
`extends` is resolved within the file only; a job extending a template defined elsewhere is reported by `GITLAB_EXTENDS_UNKNOWN`.

## Azure Pipelines rules

`AZURE_NO_WORK`, `AZURE_MIXED_STRUCTURE`, `AZURE_DUPLICATE_ID`, `AZURE_STAGE_DEPENDS_UNKNOWN`, `AZURE_STAGE_DEPENDS_CYCLE`,
`AZURE_JOB_DEPENDS_UNKNOWN`, `AZURE_JOB_DEPENDS_CYCLE`, `AZURE_STEP_INVALID`, `AZURE_TASK_VERSION_MISSING`,
`AZURE_POOL_IMAGE_LATEST`, `AZURE_TRIGGER_MISSING`, `AZURE_TRIGGER_WILDCARD`, `AZURE_PR_TRIGGER_MISSING`,
`AZURE_SECRET_IN_VARIABLES`, `AZURE_CURL_PIPE_SHELL`, `AZURE_DEPLOYMENT_NO_ENVIRONMENT`, `AZURE_DEPLOY_JOB_NOT_DEPLOYMENT`,
`AZURE_NO_TIMEOUT`, `AZURE_CONDITION_ALWAYS`, `AZURE_REPO_RESOURCE_UNPINNED`, `AZURE_CONTAINER_UNPINNED`.

Template expressions (`${{ }}`) are not expanded; template files referenced with `template:` are not resolved.
Job ids in the model are `<stage>.<job>` when `stages` is used.

## Jenkins rules

`JENKINS_UNPARSEABLE_SCRIPTED` (information), `JENKINS_SYNTAX_ERROR`, `JENKINS_NO_PIPELINE`, `JENKINS_NO_STAGES`,
`JENKINS_STAGE_NO_STEPS`, `JENKINS_DUPLICATE_STAGE`, `JENKINS_NO_AGENT`, `JENKINS_AGENT_ANY`, `JENKINS_NO_TIMEOUT`,
`JENKINS_NO_BUILD_DISCARDER`, `JENKINS_NO_POST`, `JENKINS_DOCKER_IMAGE_UNPINNED`, `JENKINS_SH_INTERPOLATION`,
`JENKINS_CREDENTIAL_INTERPOLATION`, `JENKINS_HARDCODED_SECRET`, `JENKINS_DEPLOY_NO_APPROVAL`,
`JENKINS_PARALLEL_NO_FAILFAST`, `JENKINS_CURL_PIPE_SHELL`.

The Jenkins parser recovers structure only (statement heads and `{}` blocks) with caps of 200k tokens and 64 nesting levels.
It never evaluates Groovy. A Jenkinsfile without a `pipeline { }` block is treated as scripted and reported with
`JENKINS_UNPARSEABLE_SCRIPTED` instead of being guessed at; `model()` returns `undefined` for it.
Libraries (`@Library`) and shared-library steps are not resolved.
