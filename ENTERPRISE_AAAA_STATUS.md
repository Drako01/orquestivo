# Enterprise AAAA status

Statuses: `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE`, `BLOCKED`.
Rule: code written is `IN_PROGRESS`. A phase becomes `PASS` only when the Evidence section links a real, current result.
Plan and criteria: `PLAN_ENTERPRISE_AAAA.md`.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repository audit | PASS | Plan, status and audit docs written; findings recorded in `docs/SECURITY_AUDIT.md` |
| 1 | Enterprise architecture | PASS | Provider-neutral model, rule registry, pure `src/ui` vs `src/vscode` split enforced by test |
| 2 | Advanced analysis engine | PASS | 68 GitHub Actions rules, corpus P/R 1.0 on a small hand-written corpus (caveat: small) |
| 3 | Pipeline design and generation | WARN | 11 presets, diff/undo implemented and unit-tested; wizard not exercised in a live VS Code; no pinned SHAs for upload-artifact/CodeQL, so those options fail closed |
| 4 | Intent and evidence | WARN | Contracts and verdicts tested; real GitHub E2E is BLOCKED (no network/credentials) |
| 5 | Control Center UX/UI | WARN | Unit-tested rendering, CSP, a11y attributes; webview interaction not driven in a live host |
| 6 | i18n and accessibility | WARN | EN/ES key parity tested; core-generated texts (graph text, intent errors) are English only; no screen reader/manual WCAG audit done |
| 7 | Security | PASS | Threat model, audit, redaction, safe paths, CSP, SecretStorage; see `docs/SECURITY_AUDIT.md` for residual WARNs |
| 8 | Quality gates | PASS | `verify:enterprise` all 13 steps PASS on the working tree; mutation sample sizes are small |
| 9 | Environments and compatibility | BLOCKED | CI covers three OS; WSL, SSH, Dev Containers, multi-root are manual pending (`docs/COMPATIBILITY.md`) |
| 10 | Advanced integrations | WARN | GitLab/Azure/Jenkins providers, metrics and opt-in GitHub runs implemented with mocks; AI has no bundled provider by design |
| 11 | Documentation and onboarding | PASS | README, guides, architecture, privacy, troubleshooting updated; no new screenshots (none authentic available) |
| 12 | Release engineering | BLOCKED | Workflows hardened but never executed; environments/OIDC are owner-side; `private: true` kept; nothing published |

## Release blockers known by construction

- `package.json` has `"private": true`; `publish.yml` fails at `authorize` while it is present. The owner removes it in the approved release commit.
- GitHub Environments `marketplace`, `open-vsx`, `github-release` and the OIDC trusted-publisher registrations are owner-side settings, not verified from the repository.
- No publication, tag or merge has been performed.

## Evidence

Run date: 2026-11-06, on the working tree immediately before the commit that carries this file (base HEAD `68f8dfd`).

| Item | Command | Result | Report |
|---|---|---|---|
| Full enterprise gate | `npm run verify:enterprise` | PASS (typecheck, lint, unit, rulesets, coverage, mutation, perf, build-prod, package, vsix-audit, sha256, sbom, audit) | `reports/verify-enterprise.md` (git-ignored) |
| Unit/contract tests | `npm test` | 723 pass, 0 fail, 1 skipped (real GitHub E2E = BLOCKED) | |
| VSIX audit | in gate | 20 files, 0 problems | sha256 `846b34b5afb29dda4742e3d5683236f567de4ed6784dbf614b4e165ecb598f94` |
| npm audit | in gate | 0 vulnerabilities (network available) | |
| Integration host | `npm run test:integration` | PASS once, real VS Code 1.145.2, only with host `ELECTRON_RUN_AS_NODE`/`VSCODE_*` unset; does not cover wizard/webview/remote/AI | |
| CI on exact head | GitHub Actions | NOT_STARTED until pushed | |
| Real GitHub E2E | `test/evidence/github-runs.e2e-real.test.cjs` | BLOCKED | |

## Reused evidence log

_`PASS_REUSED` entries must cite the original run and show unchanged inputs (`inputsHash` in the JSON report)._
