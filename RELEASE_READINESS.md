# Orquestivo — Enterprise AAAA readiness

## Decision

**Not ready for public release.** This is an internal functional preview. A successful static scan, unit test or VSIX build does not establish that a generated workflow executes or achieves its intended outcome.

Last verified against the current repository sources on 2026-11-05 (Argentina local date). This report distinguishes implementation from evidence.

## Product and CI/CD functions

- [x] GitHub Actions `.yml/.yaml` file discovery in trusted workspaces
- [x] YAML parsing with duplicate-key validation and line-based diagnostics for supported findings
- [x] Initial job DAG checks: missing dependencies, self-dependency and cycles
- [x] Static security observations: privileges, mutable action references, dangerous shell interpolation
- [x] Native VS Code Problems and Activity Bar findings
- [x] Conservative Node.js, Go, Python and Maven CI starter templates, preview and explicit file creation
- [ ] Complete GitHub Actions semantic model: expressions, event filters, permissions, matrix, artifacts, conditionals
- [ ] Precise validated quick fixes with preview, rollback and non-regression
- [ ] Explainability: beginner/advanced perspectives, confidence and guided troubleshooting
- [ ] Local runner with explicit consent and compatibility disclosure
- [ ] GitHub Actions remote run/job/log correlation
- [ ] Deterministic verification that the pipeline satisfies explicit user intent
- [ ] Release/deployment generation and validation
- [ ] Other CI providers (GitLab, Azure Pipelines, Jenkins, etc.)

## Engineering and quality

- [x] TypeScript strict mode, separate domain analyzer and VS Code integration
- [x] Dependency lockfile, quality scripts and unit tests
- [x] CI checks in Linux, macOS and Windows on earlier exact commits
- [x] Basic packaged VSIX smoke in a real VS Code Extension Host on Linux in prior CI
- [x] Source/version control and no automatic publication
- [ ] Verify latest PR head's complete CI matrix and packaged smoke — REQUIRED EACH CHANGE
- [ ] Corpus measuring precision, recall and false-positive/negative rates
- [ ] Mutation testing with comparable base/head populations
- [ ] Measured performance, memory and cancellation budgets on large monorepos
- [ ] Comprehensive negative/security/adversarial tests
- [ ] Multi-root, WSL, SSH, Dev Containers and cross-platform packaged E2E
- [ ] Artifact bill of materials, dependency provenance and dependency license/security acceptance

## Security, privacy and governance

- [x] Workspace Trust, bounded reads and no repository commands executed by static scans
- [x] Restricted no-script webview with source escaping
- [x] No mandatory AI, telemetry, credentials or cloud backend
- [x] Versioned `Protect main` / `Protect release tags` definitions and `CODEOWNERS`
- [x] Ruleset drift checker and explicit administrative provisioner
- [x] **GitHub rulesets active**, both installed on 2026-11-05; complete authenticated API objects matched the versioned definitions (re-run authenticated drift check before release)
- [ ] Verified repository environment protection and OIDC Trusted Publishing for Marketplace/Open VSX
- [ ] Secret-safe opt-in authentication, remote access and log redaction
- [ ] Formal security threat-model acceptance and supply-chain hardening
- [ ] Manual audit of repository workflow changes and minimum permissions

## UX, accessibility and internationalization

- [x] Approved original primary brand assets and theme-adaptive monochrome Activity Bar mark
- [x] Native findings surface and readable Control Center
- [x] Basic English/Spanish UI shell
- [ ] All finding descriptions, errors, wizard prompts and reports translated EN/ES
- [ ] Keyboard-only and screen-reader acceptance (WCAG-oriented)
- [ ] Visual QA on themes, contrast, 16/24/48/128 px, Windows/Linux/macOS
- [ ] Guided first-run onboarding and actionable end-user documentation
- [ ] Real-user usability testing across junior/mid/senior/platform engineer cohorts

## Release/publishing

- [x] Manual-only publication workflow prepared from Probato PR approach
- [x] CI-generated preview VSIX from PRs, subject to exact-head checks
- [ ] End-to-end real publication of the **same** verified VSIX in Marketplace and Open VSX
- [ ] Wait for storefront listing and provenance confirmation
- [ ] Version/tag strategy, GitHub release with checksum and tested rollback
- [ ] Maintainer sign-off and local acceptance

### Hard rule

**Enterprise AAAA is our target, not a certification we already earned.** Never mark a skipped, unexecuted or inconclusive check as PASS. No merge or publication until the owner explicitly authorizes it.
