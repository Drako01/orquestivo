# Testing

## Commands

| Command | Purpose | Cost |
|---|---|---|
| `npm run verify:fast` | typecheck, lint, unit tests (daily loop) | seconds |
| `npm run verify:platform` | fast + rulesets check + production build (Windows/macOS CI legs) | seconds |
| `npm run verify:enterprise` | every step below, per-step status, JSON and Markdown reports, evidence reuse | minutes |
| `npm run verify:release` | enterprise gate, strict, no cache; any non-PASS fails | minutes |
| `npm test` | build `dist-test/` and run `test/**/*.test.cjs` | seconds |
| `npm run test:coverage` | coverage on original TypeScript vs thresholds | seconds |
| `npm run mutation` | mutation testing of critical modules | about a minute |
| `npm run test:integration` | tests in a real VS Code (downloads VS Code; xvfb on Linux). Run `npm run build` first: the host loads `dist/extension.js` | minutes |
| `npm run bench` | scan latency (p50/p95/p99), total time and memory for 150 and 1000 files; a measurement, not a gate | seconds |
| `npm run audit:vsix`, `npm run sbom`, `npm run audit:licenses` | package content, SBOM, license checks | seconds |

The harness accepts `--only a,b`, `--skip a,b`, `--changed [--base ref]` (steps impacted by the git diff), `--no-cache`, `--strict` and `--list`:

```text
node scripts/verify-enterprise.mjs --profile enterprise --only coverage,mutation
node scripts/verify-enterprise.mjs --profile fast --changed --base origin/main
```

## Steps and statuses

`typecheck`, `lint`, `unit`, `rulesets`, `coverage`, `mutation`, `perf`, `build-prod`, `package`, `vsix-audit`, `sha256`, `sbom`, `licenses`, `governance`, `audit`.

Each step reports `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE` or `BLOCKED`, plus `PASS_REUSED` when a cached PASS is reused.

- Overall `PASS` requires every required step to pass. A skipped required step makes the run `INCONCLUSIVE` (a partial run proves nothing about the rest).
- `npm audit` and `governance` need the network (the latter also needs `gh` or `GH_TOKEN`): an unreachable service means `BLOCKED`, never `PASS`.
- Exit code is non-zero on any `FAIL`; with `--strict` on anything other than `PASS`.
- Reports: `reports/verify-enterprise.json`, `reports/verify-enterprise.md`, per-step JSON in `reports/steps/`, full logs in `reports/logs/`. `reports/` is git-ignored.

### Evidence reuse

A PASS is cached in `reports/.cache` keyed by the hash of the step's declared input files, the Node version and the platform.
If nothing changed, the next run reports `PASS_REUSED` with the original timestamp and the inputs hash. Release-artifact steps
(`build-prod`, `package`, `vsix-audit`, `sha256`) and `audit` are never reused, since they depend on artifact state or on the registry.

## Test layers

| Layer | Location | Notes |
|---|---|---|
| Unit | `test/*.test.cjs` | Run against `dist-test/` compiled from `src/` with inline source maps (`scripts/build-tests.mjs`); modules importing `vscode` are excluded by design |
| Corpus and malformed input | `test/corpus/` | Workflow samples, including invalid ones |
| Evidence and provider contracts | `test/evidence/`, `test/providers/` | Contract tests for provider-neutral model |
| Security | `test/security/` | Threat-driven cases from `docs/THREAT_MODEL.md` |
| Repository governance | `test/rulesets.test.cjs` | Ruleset JSON consistency |
| Performance | `test/perf/*.test.cjs` | Budgets; the `perf` step is `SKIP` until such tests exist |
| Integration | `test/integration/` | Real VS Code via `@vscode/test-electron`; can target the extracted VSIX with `ORQUESTIVO_PACKAGE_DIR`. `scenarios.cjs` drives the wizard (create, undo, refusal through a junction), analyzer diagnostics, the GitHub connector with a simulated network, `openFinding` argument validation and the offline AI helper. Prompts are answered by a recorded stub; if SecretStorage is unavailable the connector scenario logs `SKIPPED` instead of passing |
| Mutation kill tests | `test/mutation-kill/` | Boundary cases that pin the comparisons of the mutated modules |
| Documentation sync | `test/docs-sync.test.cjs` | The rule catalog in `docs/ANALYSIS.md` and the counts quoted in the README must match the code |
| Architecture guards | `test/architecture-guards.test.cjs` | Security helpers must be wired into the code paths they protect |
| Governance | `test/governance.test.cjs` | The evaluation logic of the release governance check |

New code needs tests for positive, negative and boundary cases; a security-relevant function needs its threat scenarios covered.

## Coverage

`scripts/coverage.mjs` runs the suite with `node --experimental-test-coverage`, takes the lcov report of the compiled files,
and maps lines and branches back to `src/*.ts` through the inline source maps. Thresholds per module group live in
`scripts/coverage-thresholds.json`. The line mapping is approximate (first mapped segment per generated line); it is a
floor to catch erosion, not a substitute for reviewing what tests assert. Target for critical core modules is 90 percent lines and 85 percent branches; floors are raised as coverage grows and never lowered without a recorded reason.

Every source folder that can run outside VS Code is gated, not only the two core facades: `core-critical`, `core-other`,
`github-rules`, `evidence`, `generation`, `analysis`, `providers`, `security`, `ai` and `ui`. Code under `src/vscode/` and
`src/extension.ts` imports `vscode`, cannot be measured this way, and is exercised by the integration suite instead.

## Mutation testing

`scripts/mutation/run.mjs` mutates the TypeScript source of the targets in `scripts/mutation/targets.json` (comparison flips,
logical swaps, boolean flips, arithmetic, removed negation, rule-code string swaps), compiles each mutant in memory with esbuild,
and runs only the relevant test files in an isolated copy. A mutant is killed when those tests fail or time out.
The run is bounded (mutants per target, per-mutant timeout, total budget) and sampled deterministically, so results are
reproducible. Output: `reports/mutation.json` with score, floor and the list of survivors (line, operator, replacement).
The mutator skips string literals inside `type`/`interface` declarations (erased at compile time) and string concatenation (only builds message text), because those mutants cannot change behavior. Targets cover the analyzer, verdicts, redaction, topology, the script and permission rules, the untrusted-context detector, the GitHub connector, the write plan, safe paths and the webview message parser.
Survivors are triage input: add the missing assertion, or document why a mutant is equivalent. A target whose source does not exist yet is `SKIP`.

## Scan benchmark

`npm run bench` analyses the corpus workflows repeatedly (one analysis per file, as a workspace scan does) and writes `reports/bench-scan.json`.
It measures the analyzer only: file discovery, reading and publishing diagnostics in VS Code are not included. Last measurement:
Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz, 16 threads, 32 GB, win32 x64, Node v24.22.1; dataset: 24 corpus workflows cycled; 50 warm-up analyses discarded.

| Files | p50 (ms) | p95 (ms) | p99 (ms) | Total (ms) | Peak RSS (MB) |
|---|---|---|---|---|---|
| 150 | 0.39 | 0.706 | 0.876 | 60.706 | 72 |
| 1000 | 0.281 | 0.502 | 0.65 | 295.093 | 74 |

These numbers describe small, well-formed workflows on one developer machine. They are a baseline for comparison after changes, not a service-level promise.

## Not covered by automation yet

See `docs/COMPATIBILITY.md` for manual environments and `docs/SECURITY_AUDIT.md` for open checks.


### PR CI mutation sharding (full score retained)

The three protected check names remain `Verify (ubuntu-latest)`, `Verify (windows-latest)`, and `Verify (macos-latest)`. The Linux check is now an **aggregate gate**, not a single long-running runner. Ubuntu's strict `enterprise-ci` profile executes all non-mutation enterprise steps, while mutation testing executes as five independent jobs:

- `mutation-rest`: all eleven other critical targets, each with its original 40-mutant cap and minimum score.
- `mutation-write-plan-0` through `mutation-write-plan-3`: four disjoint shards of the same deterministic 40 selected mutants for `src/core/generation/write-plan.ts` (10 mutants each).

`scripts/mutation/aggregate-ci.mjs` requires every shard artifact, each complete mutant sample, the original source/version of the CI run, and every configured target's **full aggregated score floor** (write-plan >= 90%). A partially executed mutation job, a missing slice, or an insufficient combined score fails the required Ubuntu check. The packaging job cannot run until Ubuntu, Windows, and macOS pass. The local `npm run verify:enterprise` and `npm run verify:release` continue to execute their original full mutation suite.

After merging to `main`, `publish.yml` only reuses the verified PR artifact: no CI matrix or mutation suite runs a second time.



### E2E test host reliability (packaged VSIX)

The real VS Code extension-host suite uses a test-only prompt bridge registered inside Orquestivo's own
`vscode` API facade when `ORQUESTIVO_E2E_MODE=1`. Mocking `vscode.window` from the
**test extension** is insufficient: VS Code may provide separate per-extension API facades,
leaving real modal prompts waiting for user input on a headless CI runner.
The bridge is inactive in normal installations, and the test runner sets the flag only in
the isolated VS Code test process. The suite exercises the real generator/undo, symlink
refusal, diagnostics, fake-network evidence, AI privacy, and real VSIX activation.

Each scenario logs START/PASS and fails after 45 seconds if it cannot complete; the entire
VS Code host has a 5-minute watchdog with a distinct `E2E_TIMEOUT` error. This exposes
a stalled dialog or launch instead of silently reaching GitHub's 20-minute job timeout.
