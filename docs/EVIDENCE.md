# Evidence model

Orquestivo separates what it **infers** from files from what it **observes** in real runs.
A static pass never implies that a pipeline ran or succeeded.

## Verdicts (`src/core/evidence/verdict.ts`)

`PASS | FAIL | WARN | SKIP | INCONCLUSIVE | BLOCKED`

`aggregate()` precedence: `FAIL > BLOCKED > INCONCLUSIVE > WARN > SKIP > PASS`.
The aggregate is `PASS` only when **every** verdict is `PASS`. An empty set is `INCONCLUSIVE`.

Every `CheckResult` carries a `basis`:

| basis | meaning |
| --- | --- |
| `static-inference` | derived from the parsed workflow (`PipelineModel`) only |
| `remote-evidence` | backed by observed runs fetched from the CI provider |

plus `evidence` refs (workflow line, job, step, run, artifact, url).

## Intent contract (`.orquestivo/intent.json`)

```json
{
  "version": 1,
  "criteria": [
    { "kind": "run-tests" },
    { "kind": "min-coverage", "percent": 80 },
    { "kind": "publish-only-from-branch", "branch": "main" },
    { "kind": "deploy-requires-approval", "environment": "production" },
    { "kind": "deploy-confirmed", "job": "deploy", "branch": "main" }
  ]
}
```

Validation is strict and hand-written (`parseIntentContract`, typed `IntentContractError` with
JSON-path issues): unknown keys are rejected, `percent` must be in `(0, 100]`, strings are bounded.

`evaluateIntent(contract, pipelineModel, remote?)` returns one result per criterion.
`remote` is `undefined` (not requested), `{status:'unavailable', reason}` (connector down) or
`{status:'available', runs}`.

| kind | static result | notes |
| --- | --- | --- |
| `run-tests` | PASS if an unconditional recognized test command exists (configuration only); WARN if only conditional; FAIL if none; INCONCLUSIVE if a reusable workflow may hide it | does not prove tests ran |
| `block-merge-on-build-failure` | FAIL if no `pull_request` trigger; otherwise INCONCLUSIVE (BLOCKED if connector unavailable) | branch protection is repository configuration, never in the workflow |
| `produce-artifacts` | PASS/WARN/FAIL on an `upload-artifact` step | existence of the artifact needs a run |
| `publish-only-from-branch` | PASS if triggers or a `github.ref`/`ref_name` condition restrict every publishing step; FAIL if any is unrestricted; INCONCLUSIVE for complex conditions; SKIP if nothing publishes | |
| `deploy-requires-approval` | FAIL if no job targets the environment; else INCONCLUSIVE/BLOCKED | required reviewers are repository settings |
| `min-coverage` | PASS/FAIL against an enforced threshold in the command line; WARN if measured but not enforced; INCONCLUSIVE if invisible | thresholds in tool config files are not visible |
| `security-scan-present` | PASS/WARN/FAIL on known scanner steps | findings need a run |
| `no-secret-exposure` | FAIL on `${{ secrets.* }}` interpolated into scripts or hard-coded secrets; otherwise **INCONCLUSIVE** | absence of runtime leaks cannot be proven statically |
| `deploy-confirmed` | INCONCLUSIVE without remote request; BLOCKED if connector unavailable | PASS (`remote-evidence`) only if the latest matching run shows the job concluded `success` |

## GitHub Actions connector (`github-runs.ts`)

Opt-in and read-only. `fetch`, `TokenProvider`, clock and sleep are injected (no network in tests,
no token storage here). Features: `AbortSignal` cancellation, per-request timeout, bounded retries
with exponential backoff on 5xx/network errors, rate-limit handling (`retry-after`,
`x-ratelimit-remaining/reset`; waits longer than `maxRateLimitWaitMs` fail fast as `rate-limited`),
bounded pagination (`maxPages`, `truncated` flag), bounded response size, and strict narrowing of
untrusted JSON. Logs are never downloaded; only the logs API URL is returned. Error messages are
redacted and never include tokens or response bodies. Use `loadRemoteContext()` to turn connector
failures into `unavailable` (criteria then report `BLOCKED`, never `PASS`).

### Real e2e is BLOCKED

`test/evidence/github-runs.e2e-real.test.cjs` needs network access and credentials
(`ORQUESTIVO_E2E_GITHUB_TOKEN`, `ORQUESTIVO_E2E_GITHUB_REPO`). Without them it is **skipped with an
explicit `BLOCKED` reason** and must be reported as BLOCKED, not as a pass.

## Metrics (`metrics.ts`)

`analyzeRuns(runs)` computes duration p50/p95 (decided runs only), failure rate (cancelled, skipped
and in-progress runs excluded), slowest jobs and steps (matrix legs merged), redundant jobs
(identical step sets in the latest run, matrix legs excluded) and cache-miss *suspicions* (slow
install steps; a heuristic, never a proven miss). `compareMetrics(baseline, current)` gives deltas.

## Security helpers (`src/security`)

`redact.ts` (GitHub/AWS tokens, bearer/basic, JWT, URL credentials, key=value secrets, private key
blocks), `safe-path.ts` (`resolveInside` with injected `realpath`, symlink-escape aware, fails
closed; a TOCTOU gap is inherent), `limits.ts` (bounded stream/JSON reads).
