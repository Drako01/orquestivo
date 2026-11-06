# Static analysis (GitHub Actions)

Orquestivo analyses workflows deterministically from their text. A static pass never proves that a workflow runs or passes: every finding carries `evidence: static` and `verification: static-only`, and `Analysis.executionVerified` is always `false`.

## Architecture

- `src/core/analyzer.ts`: `analyzeWorkflow(source)`. Parses defensively, builds a shared `RuleContext` and runs every registered rule. It never throws; a crashing rule becomes an `ANALYZER_INTERNAL_ERROR` finding.
- `src/core/github/rules/*.ts`: one module per concern. Each exports a `Rule` (`id`, `metas`, `check(ctx)`). Severity, category, impact, recommendation and docs live once, in the rule metadata.
- `src/core/github/rules/index.ts`: the registry (`GITHUB_RULES`) and `GITHUB_RULE_CATALOG`. Adding a rule means adding a module and one line here.
- `src/core/github/provider.ts`: `githubActionsProvider` (`CiProvider`), including `model()` which maps a workflow to the provider-neutral `PipelineModel`.
- `src/core/analysis/graph.ts`: `buildJobGraph(model)` (nodes with topological layer, edges) and `renderGraphText(graph)`, a textual alternative to any visual graph. Layering lives in `topology.ts` and is shared with the `NEEDS_CYCLE` rule.

## Hostile input guards

- Sources above 2,000,000 characters are rejected with `YAML_TOO_LARGE`.
- Alias expansion is capped (`maxAliasCount: 50`), so billion-laughs documents yield `YAML_INVALID`.
- Expression discovery stops at depth 40; cycle detection is iterative (no recursion).
- Parser failures, including stack exhaustion, are converted into findings.

## Quality gates

- `test/analyzer-rules.test.cjs`: every rule has positive, negative and boundary cases; a guard fails if a rule has no cases.
- `test/corpus/` + `manifest.json`: realistic good, bad and hostile workflows. `test/analyzer-corpus.test.cjs` asserts precision and recall of at least 0.9 per category and writes `analyzer-metrics.json` when `ORQUESTIVO_REPORT_DIR` is set.
- `test/analyzer-perf.test.cjs`: a 2000-job workflow must analyse, model and graph within budget; timings go to `analyzer-perf.json` in the report directory.

## Rule catalog (68 codes)

| Code | Severity | Category | Why it matters | Docs |
|---|---|---|---|---|
| `ACTION_NOT_PINNED` | warning | security | Tags and branches are mutable; a compromised or moved ref runs new code in your pipeline. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) |
| `ALWAYS_OVERUSE` | information | reliability | always() also runs on cancellation, wasting minutes and blocking cancel-in-progress; it is rarely what you want. | [docs](https://docs.github.com/actions/learn-github-actions/expressions#status-check-functions) |
| `ANALYZER_INTERNAL_ERROR` | warning | maintainability | A rule failed unexpectedly, so its results are missing; the other rules still ran. |  |
| `ARTIFACT_DOWNLOAD_ORPHAN` | warning | reliability | Downloading an artifact that no upstream job uploads fails at runtime. | [docs](https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts) |
| `ARTIFACT_NAME_UNSET` | information | reliability | Unnamed uploads share the default name, which collides across matrix legs and repeated uploads. | [docs](https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts) |
| `ARTIFACT_RETENTION_UNSET` | information | maintainability | Artifacts default to the repository retention (up to 90 days), which inflates storage costs. | [docs](https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts) |
| `BRANCHES_CONFLICT` | error | semantic | branches and branches-ignore cannot be combined for the same event; GitHub rejects the file. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#onpushbranchestagsbranches-ignoretags-ignore) |
| `CACHE_KEY_NO_HASHFILES` | warning | reliability | A cache key that does not hash dependency files is never invalidated, so stale dependencies are restored. | [docs](https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows) |
| `CHECKOUT_PERSIST_CREDENTIALS` | warning | security | checkout stores the token in .git/config; uploading the workspace as an artifact can leak it. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions) |
| `CONTAINER_INVALID` | error | semantic | A job container needs an image; GitHub rejects it otherwise. | [docs](https://docs.github.com/actions/using-jobs/running-jobs-in-a-container) |
| `CONTAINER_MUTABLE_TAG` | warning | security | Mutable image tags can change between runs, breaking reproducibility and trust. | [docs](https://docs.github.com/actions/using-jobs/running-jobs-in-a-container) |
| `CONTINUE_ON_ERROR_GATE` | warning | reliability | A gate job (test, lint, scan, or one other jobs depend on) that cannot fail turns the check into decoration. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontinue-on-error) |
| `CONTINUE_ON_ERROR_REVIEW` | information | reliability | A step that may fail silently can hide a broken quality gate. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontinue-on-error) |
| `CRON_INVALID` | error | semantic | An invalid cron expression makes the scheduled trigger fail or never run. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#onschedule) |
| `CURL_PIPE_SHELL` | warning | security | Piping a download into a shell runs unverified remote code with the job token and secrets. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions) |
| `DEPLOY_CONCURRENCY_MISSING` | warning | reliability | Overlapping deploys can race and leave the target in a mixed state. | [docs](https://docs.github.com/actions/using-jobs/using-concurrency) |
| `DEPLOY_ENVIRONMENT_MISSING` | warning | security | Without an environment the job cannot use required reviewers, wait timers or environment-scoped secrets. | [docs](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment) |
| `DEPRECATED_SET_ENV` | error | security | The set-env and add-path commands are disabled because they enabled environment injection. | [docs](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions) |
| `DEPRECATED_SET_OUTPUT` | warning | maintainability | The set-output and save-state commands are deprecated and may stop working. | [docs](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions) |
| `EVENT_MISSING` | error | semantic | Without an event the workflow never runs. | [docs](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows) |
| `EVENT_UNKNOWN` | error | semantic | An unknown event name never fires, so the workflow silently does nothing. | [docs](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows) |
| `EXPR_CONTEXT_UNAVAILABLE` | error | semantic | This context is not available at this workflow key, so the expression evaluates to empty or fails. | [docs](https://docs.github.com/actions/learn-github-actions/contexts#context-availability) |
| `EXPR_MATRIX_UNDEFINED` | error | semantic | The matrix context is empty in a job that defines no strategy.matrix. | [docs](https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs) |
| `EXPR_SECRETS_IN_IF` | error | semantic | The secrets context is not available in if: conditions, so the condition fails or is always false. | [docs](https://docs.github.com/actions/learn-github-actions/contexts#context-availability) |
| `EXPR_UNBALANCED` | error | syntax | A malformed ${{ }} expression fails at runtime or is passed through as literal text. | [docs](https://docs.github.com/actions/learn-github-actions/expressions) |
| `EXPR_UNKNOWN_CONTEXT` | error | semantic | Unknown contexts make GitHub reject the workflow ("Unrecognized named-value"). | [docs](https://docs.github.com/actions/learn-github-actions/contexts) |
| `EXPR_UNKNOWN_FUNCTION` | error | semantic | Unknown functions make GitHub reject the workflow. | [docs](https://docs.github.com/actions/learn-github-actions/expressions) |
| `EXPRESSION_IN_SCRIPT` | warning | security | Event fields such as titles and branch names are attacker-controlled; interpolating them into a script enables command injection. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections) |
| `ID_TOKEN_WITHOUT_NEED` | warning | security | id-token: write lets the job mint OIDC tokens; granting it without a consumer is needless exposure. | [docs](https://docs.github.com/actions/security-guides/security-hardening-your-deployments/about-security-hardening-with-openid-connect) |
| `JOB_INVALID` | error | syntax | GitHub rejects jobs that are not mappings. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `JOBS_MISSING` | error | semantic | A workflow without jobs has nothing to run. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `MATRIX_EMPTY` | error | semantic | A matrix without values (or with an empty axis) produces zero jobs; GitHub fails the run. | [docs](https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs) |
| `MATRIX_INVALID` | error | syntax | Matrix axes must be lists, and include/exclude must be lists of mappings. | [docs](https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs) |
| `MATRIX_STRATEGY_INVALID` | error | semantic | fail-fast must be a boolean and max-parallel a positive integer (or expressions). | [docs](https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs) |
| `MATRIX_UNKNOWN_KEY` | warning | semantic | An exclude entry that names a key absent from the matrix never matches, so nothing is excluded. | [docs](https://docs.github.com/actions/using-jobs/using-a-matrix-for-your-jobs) |
| `NEEDS_CONTEXT_UNDECLARED` | error | semantic | The needs context only exposes jobs listed in needs; other references evaluate to empty. | [docs](https://docs.github.com/actions/learn-github-actions/contexts) |
| `NEEDS_CYCLE` | error | semantic | Circular dependencies make the workflow invalid; no job in the cycle can start. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds) |
| `NEEDS_INVALID` | error | semantic | needs must be a job id or a non-empty list of job ids. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds) |
| `NEEDS_SELF` | error | semantic | A job that needs itself can never start. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds) |
| `NEEDS_UNKNOWN` | error | semantic | GitHub rejects workflows whose needs point at jobs that do not exist. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds) |
| `PATHS_CONFLICT` | error | semantic | paths and paths-ignore cannot be combined for the same event; GitHub rejects the file. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#onpushpull_requestpull_request_targetpathspaths-ignore) |
| `PERMISSIONS_INVALID_VALUE` | error | semantic | Permission values must be read, write or none; anything else invalidates the workflow. | [docs](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) |
| `PERMISSIONS_UNDECLARED` | information | security | Without explicit permissions the token inherits repository defaults, which may be broader than needed. | [docs](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) |
| `PERMISSIONS_UNKNOWN_SCOPE` | error | semantic | GitHub rejects permission scopes it does not know, invalidating the workflow. | [docs](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) |
| `PERMISSIONS_WRITE_ALL` | warning | security | write-all grants every token scope; a compromised step can modify the repository. | [docs](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) |
| `PERMISSIONS_WRITE_REVIEW` | information | security | Write scopes widen the blast radius of a compromised step. | [docs](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) |
| `PR_TARGET_CHECKOUT_REVIEW` | warning | security | Checking out an explicit ref under pull_request_target can execute attacker-controlled code with secrets. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions) |
| `PR_TARGET_REVIEW` | warning | security | pull_request_target runs with a write token and secrets in the context of the base branch. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions) |
| `REUSABLE_JOB_CONFLICT` | error | semantic | A job that calls a reusable workflow cannot also declare its own runner or steps. | [docs](https://docs.github.com/actions/using-workflows/reusing-workflows) |
| `REUSABLE_USES_FORMAT` | error | syntax | A malformed reusable workflow reference is rejected by GitHub. | [docs](https://docs.github.com/actions/using-workflows/reusing-workflows) |
| `REUSABLE_WORKFLOW_UNPINNED` | warning | security | A reusable workflow referenced by a branch or tag can change under you and run new code with your secrets. | [docs](https://docs.github.com/actions/using-workflows/reusing-workflows) |
| `RUNNER_MISSING` | error | semantic | A job without runs-on cannot be scheduled. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `SECRET_ECHO` | warning | security | Printing a secret writes it to the log; masking is best-effort and defeated by transformations. | [docs](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions) |
| `SECRETS_INHERIT_REVIEW` | warning | security | secrets: inherit hands every secret to the called workflow. | [docs](https://docs.github.com/actions/using-workflows/reusing-workflows) |
| `SELF_HOSTED_PR_TARGET` | error | security | A privileged trigger on a self-hosted runner lets pull-request code persist on your infrastructure. | [docs](https://docs.github.com/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security) |
| `SERVICES_INVALID` | error | semantic | services must be a mapping of name to a definition with an image; ports, when present, must be a list. | [docs](https://docs.github.com/actions/using-containerized-services/about-service-containers) |
| `SETUP_CACHE_MISSING` | information | performance | Reinstalling dependencies on every run slows CI and increases registry traffic. | [docs](https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows) |
| `STEP_ACTION_MISSING` | error | semantic | A step with neither run nor uses does nothing and is rejected by GitHub. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `STEP_INVALID` | error | syntax | GitHub rejects steps that are not mappings. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `STEP_RUN_AND_USES` | error | semantic | A step cannot both run a script and use an action. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `STEPS_MISSING` | error | semantic | A job needs at least one step to do any work. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `TAGS_CONFLICT` | error | semantic | tags and tags-ignore cannot be combined for the same event; GitHub rejects the file. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#onpushbranchestagsbranches-ignoretags-ignore) |
| `TIMEOUT_EXCESSIVE` | information | reliability | GitHub-hosted runners stop jobs after 360 minutes, so a larger value has no effect there. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes) |
| `TIMEOUT_INVALID` | error | semantic | timeout-minutes must be a positive number; other values are rejected by GitHub. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes) |
| `TIMEOUT_UNSET` | information | reliability | Without a timeout a hung job occupies a runner for up to six hours. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes) |
| `WORKFLOW_ROOT_INVALID` | error | syntax | A workflow file must be a YAML mapping with keys such as on and jobs. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `YAML_INVALID` | error | syntax | The file cannot be parsed, so GitHub will reject the workflow and no other check can run. | [docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) |
| `YAML_TOO_LARGE` | error | syntax | Oversized inputs are not analysed to keep the editor responsive. | [docs](https://docs.github.com/actions/using-workflows/reusing-workflows) |
