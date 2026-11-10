# Orquestivo — Enterprise AAAA readiness

## Decision

**READY_WITH_RISKS** for the `0.2.0` release. Versions `0.1.0` to `0.1.2` are already published. Open items are recorded as **BLOCKED_BY_EXTERNAL_DEPENDENCY** (real GitHub end-to-end, WSL/SSH/Dev Containers manual runs, registry-side OIDC registration) or listed below as unchecked. This is a decision about the repository, not a certification.

How to read this file: `[x]` means the capability or check exists in the repository **and** a file in the repository (source, test, script or workflow) is cited as evidence. A checked box is not a claim that the latest head passes; run results are dated and quoted separately. `[ ]` means missing, unexecuted, inconclusive or blocked. A skipped or inconclusive check is never counted as a pass.

## Latest recorded local run

2026-11-10, Windows, Node v24.22.1, working tree for `0.2.0`: `npm run verify:enterprise` finished with overall **PASS** (15 of 15 steps, including the release governance check and `npm audit`). Evidence and per-step numbers: [ENTERPRISE_AAAA_STATUS.md](ENTERPRISE_AAAA_STATUS.md). CI on the exact head is pending until the branch is pushed.

## Product and CI/CD functions

- [x] GitHub Actions analysis with 69 rule codes — `src/core/github/rules/`, `docs/ANALYSIS.md`, `test/analyzer-rules.test.cjs`
- [x] GitLab CI, Azure Pipelines and Jenkins (declarative) providers behind a registry — `src/providers/`, `test/providers/`
- [x] Provider-neutral `PipelineModel` and job graph with text alternative — `src/core/model.ts`, `src/core/analysis/`
- [x] Hostile-input handling (size, alias, depth caps) — `test/corpus/hostile-*.yml`, `test/analyzer-corpus.test.cjs`
- [x] Intent contract parser and evaluator with six verdicts — `src/core/evidence/intent.ts`, `verdict.ts`, `test/evidence/`
- [x] Read-only GitHub Actions connector with injected fetch/token, retries, rate limits, redaction — `src/core/evidence/github-runs.ts`, `test/evidence/github-runs.test.cjs`
- [x] Run metrics (percentiles, failure rate, slowest, redundant, cache-miss suspicion) — `src/core/evidence/metrics.ts`, `test/evidence/metrics.test.cjs`
- [x] Generator presets node, typescript, react, next, go, python, java-maven, java-gradle, php, docker with fail-closed pins — `src/core/generation/`, `test/generator*.test.cjs`
- [x] Write plan that never overwrites without a diff and confirmation — `src/core/generation/write-plan.ts`, `test/generator-write-plan.test.cjs`, `test/mutation-kill/write-plan.test.cjs`
- [x] Optional AI contracts: off by default, consent, redacted disclosure, never PASS — `src/ai/`, `test/evidence/ai.test.cjs`
- [x] Control Center with accessible diagram and beginner/advanced/expert levels — `src/vscode/control-center.ts`, `test/ui/render.test.cjs`, `test/integration/suite.cjs`
- [x] Wizard diff preview, undo of the last generation, refusal of links that leave the workspace — `src/vscode/generator.ts`, `wizardCreateAndUndo` and `wizardRefusesLinksOutsideWorkspace` in `test/integration/scenarios.cjs`
- [ ] Real GitHub Actions end-to-end of the connector — **BLOCKED_BY_EXTERNAL_DEPENDENCY**: `test/evidence/github-runs.e2e-real.test.cjs` needs `ORQUESTIVO_E2E_GITHUB_TOKEN` and `ORQUESTIVO_E2E_GITHUB_REPO`
- [ ] Remote evidence for GitLab, Azure Pipelines, Jenkins
- [ ] Resolution of GitLab `include`, Azure templates, Jenkins shared libraries; Jenkins scripted pipelines
- [ ] Precise validated quick fixes with preview and rollback
- [ ] Local runner with explicit consent
- [ ] Deployment generation beyond the gated placeholder template

## Engineering and quality

- [x] Strict TypeScript, domain code free of `vscode` imports — `tsconfig.json`, `ARCHITECTURE.md`
- [x] Lockfile and `npm ci` in CI — `package-lock.json`, `.github/workflows/ci.yml`
- [x] Verify harness with PASS/FAIL/WARN/SKIP/INCONCLUSIVE/BLOCKED and evidence reuse — `scripts/verify-enterprise.mjs`, `docs/TESTING.md`
- [x] Coverage thresholds and mutation testing scripts — `scripts/coverage.mjs`, `scripts/coverage-thresholds.json`, `scripts/mutation/`
- [x] Corpus precision/recall gate and performance budget tests — `test/analyzer-corpus.test.cjs`, `test/analyzer-perf.test.cjs`
- [x] Security unit tests (redaction, safe paths, bounded reads) — `src/security/`, `test/security/security.test.cjs`
- [x] SBOM, license audit, VSIX content audit and SHA-256 scripts — `scripts/sbom.mjs`, `license-audit.mjs`, `vsix-audit.mjs`, `vsix-checksum.mjs`
- [x] CI matrix Linux (full gate + real VS Code smoke), Windows and macOS (platform gate) defined — `.github/workflows/ci.yml`, `docs/COMPATIBILITY.md`
- [ ] Green CI on the exact final head for all three operating systems — REQUIRED EACH CHANGE; pending for `0.2.0` until the pull request runs
- [ ] Green `npm run verify:release` (strict, no cache) on the exact final head — the non-strict enterprise gate is green locally; the strict run happens in the publish workflow
- [x] Mutation score at or above floor on a recorded run — 12 modules, `reports/mutation.json` (2026-11-10)
- [ ] Measured performance and memory on large monorepos
- [ ] Packaged VSIX E2E on Windows and macOS
- [ ] Multi-root, monorepo, **WSL, Remote SSH, Dev Containers** manual verification — `NOT_STARTED` in `docs/COMPATIBILITY.md`; **BLOCKED_BY_EXTERNAL_DEPENDENCY** (needs those environments)
- [ ] Dependency provenance (build attestation) — not enabled

## Security, privacy and governance

- [x] Workspace Trust enforced before scan and generation — `docs/SECURITY_AUDIT.md` E-04 (re-verify after UI changes)
- [x] Static analysis executes no repository commands and makes no network calls — design in `docs/THREAT_MODEL.md`; connector and AI are opt-in
- [x] No telemetry, AI disabled by default, no bundled AI provider — `PRIVACY.md`, `src/ai/`
- [x] Versioned rulesets and CODEOWNERS; drift checker — `.github/rulesets/`, `scripts/rulesets.mjs`, `test/rulesets.test.cjs`
- [x] Publish workflow with SHA-pinned actions, least-privilege permissions, a `private: true` guard and automatic publication after the merge to `main` — `.github/workflows/publish.yml`, `docs/RELEASE.md`
- [x] SecretStorage token handling and webview CSP re-audited on the shipped UI — `docs/SECURITY_AUDIT.md` (2026-11-10), real-host scenarios in `test/integration/scenarios.cjs`
- [x] Rulesets active on the live repository — checked on every release gate by `scripts/governance-check.mjs`; `npm run rulesets:status` reports drift against `.github/rulesets/`
- [x] Protected environments `marketplace`, `open-vsx`, `github-release` (`main`-only deployments, no reviewer gate by design) — `scripts/governance-check.mjs`
- [ ] OIDC trusted publishing registered in both registries — **BLOCKED_BY_EXTERNAL_DEPENDENCY** (registry-side, not visible from the repository; the `0.1.2` publication succeeded with it)
- [ ] `npm audit` result on the final head — needs network; `BLOCKED` when unreachable
- [ ] Formal threat-model acceptance by the maintainer (`docs/THREAT_MODEL.md` is a draft for review)

## UX, accessibility and internationalization

- [x] Approved brand assets and theme-adaptive Activity Bar icon — `media/`
- [x] English/Spanish UI shell — `package.nls*.json`, `src/i18n.ts`
- [ ] All finding descriptions, wizard prompts and reports translated EN/ES (key parity test)
- [ ] Keyboard-only and screen-reader acceptance, high-contrast and narrow-sidebar visual QA
- [ ] Guided first-run onboarding verified by a person in a real VS Code (the activation and Control Center opening are covered by `test/integration/suite.cjs`)
- [ ] Real-user usability testing

## Release and publishing

- [x] Release process, partial-publish recovery and rollback documented — `docs/RELEASE.md`
- [x] Version `0.2.0` decided by the owner and applied — `package.json`, `CHANGELOG.md`
- [x] `"private": true` removed in the `0.1.1` release commit
- [x] The same verified VSIX reached both registries for `0.1.2` (run `42751145007`, checksum re-verified by each job); listing confirmation for `0.2.0` happens after its publication
- [x] GitHub Release with the VSIX, checksum and SBOM — `v0.1.2`
- [ ] Rollback rehearsed on a real registry — procedure in `docs/RELEASE.md`, never exercised
- [ ] Maintainer sign-off and local acceptance

### Hard rule

**Enterprise AAAA is our target, not a certification we already earned.** Never mark a skipped, unexecuted or inconclusive check as PASS. No merge, tag or publication until the owner explicitly authorizes it.
