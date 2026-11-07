# Changelog

Format follows Keep a Changelog; versions follow SemVer. Nothing here has been published.

## Version strategy

- `0.1.0` was uploaded manually to both registries as the first preview. This work is released as **`0.1.1`** (the owner chose a patch-level bump); the registries do not allow re-publishing an existing version.
- Publication is automatic from `main`: a merge that changes `package.json` to a version without a GitHub Release starts [`publish.yml`](.github/workflows/publish.yml), and each registry job waits for approval on its protected Environment ([docs/RELEASE.md](docs/RELEASE.md)).

## [Unreleased]

_Nothing yet._

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
