# Enterprise AAAA status

Statuses: `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE`, `BLOCKED`.
Rule: code written is `IN_PROGRESS`. A phase becomes `PASS` only when the Evidence section links a real, current result.
Plan and criteria: `PLAN_ENTERPRISE_AAAA.md`.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repository audit | PASS | Plan, status and audit docs written; findings recorded in `docs/SECURITY_AUDIT.md` |
| 1 | Enterprise architecture | PASS | Provider-neutral model, rule registry, pure `src/ui` vs `src/vscode` split enforced by test |
| 2 | Advanced analysis engine | PASS | 69 GitHub Actions rules; untrusted-context detection from one list (`src/core/github/untrusted.ts`); corpus P/R 1.0 on a hand-written corpus of 33 workflow files (caveat: written by the maintainer, not independent) |
| 3 | Pipeline design and generation | WARN | 11 presets; wizard create, undo and refusal through a junction exercised in a real VS Code (`test/integration/scenarios.cjs`); no pinned SHAs for upload-artifact/CodeQL, so those options fail closed |
| 4 | Intent and evidence | WARN | Contracts and verdicts tested; connector driven in a real VS Code with a simulated network; real GitHub E2E is BLOCKED (no credentials) |
| 5 | Control Center UX/UI | WARN | Rendering, CSP, a11y attributes and message schema tested; opening from the Activity Bar verified in a real host; clicks inside the webview are not driven |
| 6 | i18n and accessibility | WARN | EN/ES key parity tested; core-generated texts (graph text, intent errors) are English only; no screen reader/manual WCAG audit done |
| 7 | Security | PASS | Audit refreshed on 2026-11-10 against the code (`docs/SECURITY_AUDIT.md`): redaction, contained writes, CSP, SecretStorage, redirect behavior pinned by a test; residual WARNs listed there |
| 8 | Quality gates | PASS | `verify:enterprise` 15 of 15 steps PASS, including release governance; every measurable source folder has a coverage floor; mutation covers 12 modules |
| 9 | Environments and compatibility | BLOCKED | CI covers three OS; WSL, SSH, Dev Containers, multi-root are manual pending (`docs/COMPATIBILITY.md`) |
| 10 | Advanced integrations | WARN | GitLab/Azure/Jenkins providers, metrics and opt-in GitHub runs implemented with mocks; AI has no bundled provider by design |
| 11 | Documentation and onboarding | PASS | README, guides, architecture, privacy, troubleshooting and the security and release documents updated and kept in sync by tests; screenshots 7 and 8 added (rendered from the product HTML) |
| 12 | Release engineering | WARN | `0.1.1` and `0.1.2` published through `publish.yml`; Environments accept `main` deployments only and publication is automatic after the merge (verified by `scripts/governance-check.mjs`); registry-side OIDC is not verifiable here; rollback never rehearsed on a real registry |

## Open items for the next release

- Registry-side OIDC trusted-publisher registrations are owner settings that cannot be verified from the repository.
- A rollback has not been rehearsed on a real registry (procedure in `docs/RELEASE.md`).
- Pull request review is not independent and publication has no second approval: the project has a single owner and chose automatic publication ([docs/RELEASE.md](docs/RELEASE.md#ownership-model)).
- WSL, Remote SSH, Dev Containers, multi-root and monorepo checks, a manual accessibility pass and the real GitHub end-to-end test are still pending.

## Evidence

Run date: 2026-11-10, on the working tree for `0.2.0` (base HEAD `29c619d`), Windows, Node v24.22.1.

| Item | Command | Result | Report |
|---|---|---|---|
| Full enterprise gate | `npm run verify:enterprise` | PASS, 15 of 15 steps (typecheck, lint, unit, rulesets, coverage, mutation, perf, build-prod, package, vsix-audit, sha256, sbom, licenses, governance, audit) | `reports/verify-enterprise.md` (git-ignored) |
| Unit/contract tests | `npm test` | 763 pass, 0 fail, 1 skipped (real GitHub E2E = BLOCKED) | |
| Coverage | in gate | github-rules L99.81/B98.25; evidence L98.18/B95.78; generation L100/B92.25; analysis L100/B95.83; providers L99.54/B93.07; security L100/B98.67; ai L100/B100; ui L98.77/B89.62 | `reports/coverage/summary.json` |
| Mutation | in gate | 12 modules, scores 85 to 100 percent, floors 85 to 90 (analyzer 6/7, verdict 9/9, redact 3/3, topology 6/6, graph 2/2, untrusted 4/4, scripts 11/13, permissions 36/38, github-runs 34/40, write-plan 38/40, safe-path 33/35, messages 29/29) | `reports/mutation.json` |
| VSIX audit | in gate | 18 files, 0 problems | sha256 `df48c3eccfbfa252caa0085d54672d6643cc8575eb5fac015b106989cd24697b` |
| npm audit | in gate | 0 vulnerabilities (network available) | |
| Release governance | in gate | PASS against the live repository | `reports/steps/governance.json` |
| Integration host | `npm run build` then `npm run test:integration` | PASS in real VS Code: activation, Control Center, injection diagnostics, wizard create and undo, refusal through a junction, connector with simulated network, `openFinding` validation, offline AI helper. Run with `ELECTRON_RUN_AS_NODE`/`VSCODE_*` unset | |
| Scan benchmark | `npm run bench` | 1000 files: p95 0.5 ms per file, 295 ms total, 74 MB peak (analyzer only; i9-9900K) | `reports/bench-scan.json`, `docs/TESTING.md` |
| CI on exact head | GitHub Actions | Pending until this branch is pushed | |
| Real GitHub E2E | `test/evidence/github-runs.e2e-real.test.cjs` | BLOCKED | |

## Reused evidence log

_`PASS_REUSED` entries must cite the original run and show unchanged inputs (`inputsHash` in the JSON report)._
