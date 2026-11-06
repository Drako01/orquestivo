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
| `npm run test:integration` | tests in a real VS Code (downloads VS Code; xvfb on Linux) | minutes |
| `npm run audit:vsix`, `npm run sbom`, `npm run audit:licenses` | package content, SBOM, license checks | seconds |

The harness accepts `--only a,b`, `--skip a,b`, `--changed [--base ref]` (steps impacted by the git diff), `--no-cache`, `--strict` and `--list`:

```text
node scripts/verify-enterprise.mjs --profile enterprise --only coverage,mutation
node scripts/verify-enterprise.mjs --profile fast --changed --base origin/main
```

## Steps and statuses

`typecheck`, `lint`, `unit`, `rulesets`, `coverage`, `mutation`, `perf`, `build-prod`, `package`, `vsix-audit`, `sha256`, `sbom`, `licenses`, `audit`.

Each step reports `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE` or `BLOCKED`, plus `PASS_REUSED` when a cached PASS is reused.

- Overall `PASS` requires every required step to pass. A skipped required step makes the run `INCONCLUSIVE` (a partial run proves nothing about the rest).
- `npm audit` needs the network: unreachable registry means `BLOCKED`, never `PASS`.
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
| Integration | `test/integration/` | Real VS Code via `@vscode/test-electron`; can target the extracted VSIX with `ORQUESTIVO_PACKAGE_DIR` |

New code needs tests for positive, negative and boundary cases; a security-relevant function needs its threat scenarios covered.

## Coverage

`scripts/coverage.mjs` runs the suite with `node --experimental-test-coverage`, takes the lcov report of the compiled files,
and maps lines and branches back to `src/*.ts` through the inline source maps. Thresholds per module group live in
`scripts/coverage-thresholds.json`. The line mapping is approximate (first mapped segment per generated line); it is a
floor to catch erosion, not a substitute for reviewing what tests assert. Target for critical core modules is 90 percent lines and 85 percent branches; floors are raised as coverage grows and never lowered without a recorded reason.

## Mutation testing

`scripts/mutation/run.mjs` mutates the TypeScript source of the targets in `scripts/mutation/targets.json` (comparison flips,
logical swaps, boolean flips, arithmetic, removed negation, rule-code string swaps), compiles each mutant in memory with esbuild,
and runs only the relevant test files in an isolated copy. A mutant is killed when those tests fail or time out.
The run is bounded (mutants per target, per-mutant timeout, total budget) and sampled deterministically, so results are
reproducible. Output: `reports/mutation.json` with score, floor and the list of survivors (line, operator, replacement).
Survivors are triage input: add the missing assertion, or document why a mutant is equivalent. A target whose source does not exist yet is `SKIP`.

## Not covered by automation yet

See `docs/COMPATIBILITY.md` for manual environments and `docs/SECURITY_AUDIT.md` for open checks.
