# Changelog

Format follows Keep a Changelog; versions follow SemVer.

## Version strategy

- `0.1.0` was uploaded manually to both registries as the first preview. This work is released as **`0.1.1`** (the owner chose a patch-level bump); the registries do not allow re-publishing an existing version.
- `0.2.0` is a minor release: it widens what the analyzer reports and tightens release controls, without removing or renaming any command, setting or rule code.
- Publication is automatic from `main`: a merge that changes `package.json` to a version without a GitHub Release starts [`publish.yml`](.github/workflows/publish.yml) and runs to the end without a second approval: the merge is the release decision ([docs/RELEASE.md](docs/RELEASE.md)).

## [Unreleased]

_Nothing yet._

## [0.2.0] — 2026-11-10

### Added
- Script-injection detection now uses one list of untrusted contexts (`src/core/github/untrusted.ts`). `EXPRESSION_IN_SCRIPT` also reports `github.head_ref`, `github.ref_name`, `inputs.*`, `github.event.inputs.*` and the `workflow_run`, `review`, `review_comment`, `discussion`, `pages`, `release` and `client_payload` event objects, including expressions wrapped in `format()` or `fromJSON()` and bracket access, and scans the `script` of `actions/github-script`. Numeric ids and commit hashes are not reported. Limits are documented in [docs/ANALYSIS.md](docs/ANALYSIS.md).
- New rule `SELF_HOSTED_PR_REVIEW` (information): a self-hosted runner under `pull_request`. The catalog now has 69 codes.
- Release governance check (`scripts/governance-check.mjs`, step `governance` of the enterprise gate): fails when a publish Environment has no `main`-only deployment branch policy, or when the `Protect main` ruleset is missing or weakened.
- Integration scenarios in a real VS Code: wizard create and undo, refusal to write through a link that leaves the workspace, analyzer diagnostics, GitHub connector with a simulated network, `openFinding` argument validation and the offline AI helper.
- `npm run bench` scan benchmark and a documented baseline in [docs/TESTING.md](docs/TESTING.md).
- Tests that keep the documentation honest: the rule catalog and counts must match the code (`test/docs-sync.test.cjs`), and security helpers must be wired into the paths they protect (`test/architecture-guards.test.cjs`).

### Changed
- Wizard and undo resolve the target path through symlinks and junctions and refuse to write outside the workspace (`writeOutsideWorkspace` message in English and Spanish).
- Coverage thresholds now gate every source folder that runs outside VS Code (github-rules, evidence, generation, analysis, providers, security, ai, ui), not only the two core facades.
- Mutation testing covers 12 modules instead of 5, skips mutants that cannot change behavior (type-level literals, message concatenation) and reports the real survivors. `verdict.ts` now scores 100 percent on its 9 behavioral mutants.
- CI uploads every per-step report and passes a read-only token to the governance step.
- `docs/SECURITY_AUDIT.md`, `docs/THREAT_MODEL.md`, `docs/RELEASE.md`, `RELEASE_READINESS.md` and `ENTERPRISE_AAAA_STATUS.md` rewritten to match the code; the single-owner approval model and the rollback procedure are now documented.

### Security
- Repository settings: the `marketplace`, `open-vsx` and `github-release` Environments accept deployments from `main` only (publication stays automatic, with no reviewer gate); secret scanning, push protection and Dependabot security updates are enabled.
- A test pins that a redirect to another origin never carries the GitHub token.

### Fixed
- The mutation runner no longer inflates survivors with type-level string literals.

## [0.1.2] — 2026-11-10

### Changed
- Release Orquestivo 0.1.2 as a stable extension by removing the VS Code `preview` manifest flag.
- Update the Marketplace extension icon with transparent rounded corners while preserving the Orquestivo branding.
- No functional code changes.

## [0.1.1] — 2026-11-06

### Added
- Multi-provider analysis behind a `CiProvider` registry: GitLab CI/CD, Azure Pipelines and Jenkins (declarative), next to GitHub Actions ([docs/PROVIDERS.md](docs/PROVIDERS.md)).
- GitHub Actions rule catalog expanded to 68 rule codes with metadata, docs links and per-rule test cases ([docs/ANALYSIS.md](docs/ANALYSIS.md)).
- Provider-neutral `PipelineModel`, job graph with a textual alternative, and hostile-input guards.
- Intent contracts (`.orquestivo/intent.json`) and verdicts PASS/FAIL/WARN/SKIP/INCONCLUSIVE/BLOCKED ([docs/EVIDENCE.md](docs/EVIDENCE.md)).
- Opt-in read-only GitHub Actions run connector and run metrics; token storage via VS Code SecretStorage.
- Generator presets node, typescript, react, next, go, python, java-maven, java-gradle, php, docker, with diff preview and undo of the last generation ([docs/GENERATOR.md](docs/GENERATOR.md)).
- Optional AI contracts: disabled by default, no bundled provider, consent plus redacted disclosure, never PASS ([docs/AI.md](docs/AI.md)).
- Security modules: redaction, symlink-aware safe paths, bounded reads.
- Control Center with accessible pipeline diagram and beginner/advanced/expert levels; commands `orquestivo.connectGitHub`, `disconnectGitHub`, `fetchRuns`, `undoLastGeneration`, `ai.explainFinding`. (UI was in progress when this entry was written; verify against `package.json`.)
- Verification harness: `verify:fast`, `verify:platform`, `verify:enterprise`, `verify:release`, coverage thresholds, mutation testing, SBOM, license audit, VSIX audit and SHA-256 ([docs/TESTING.md](docs/TESTING.md)).
- Hardened manual publish workflow and CI matrix ([docs/RELEASE.md](docs/RELEASE.md)).
- Threat model, security audit and compatibility documents; user guides ([docs/USAGE.md](docs/USAGE.md), [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)).

### Changed
- README, ARCHITECTURE, ROADMAP, PRIVACY, CONTRIBUTING and RELEASE_READINESS rewritten to match the implemented scope and to keep unverified items explicit.

### Known limitations
- Real GitHub end-to-end test is BLOCKED without credentials; WSL, SSH, Dev Containers, multi-root and monorepo checks are not run; environment protection and OIDC are owner-side and unverified; accessibility acceptance is pending.
- **Not published.**

## [0.1.0] — Unreleased (internal foundation milestone)

- Public development foundation (unreleased): Orquestivo brand, Activity Bar icon and CI/CD Control Center.
- Strict TypeScript GitHub Actions YAML static analysis and tests.
- Basic CI templates with explicit review and overwrite prevention.
- Approved full-color brand in README and Marketplace, with improved theme-adaptive Activity Bar mark.
- Versioned repository ruleset policies, CODEOWNERS and drift checker (admin activation pending).
- Reproducible lockfile and cross-platform checks, plus packaged VSIX smoke.
- VS Code-native diagnostic tree and Problems integration.
- English/Spanish UI baseline, security/privacy/release documents.
- **Not published.**
