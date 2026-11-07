# Orquestivo — Enterprise quality roadmap

Public source repository; the extension is **not released**. Checked items mean implemented in the repository (with tests where noted), not certified for production. Evidence-backed status lives in [`RELEASE_READINESS.md`](RELEASE_READINESS.md).

## Foundation
- [x] Identity and monochrome theme-adaptive Activity Bar icon
- [x] Strict TypeScript baseline and modular analyzer
- [x] Native diagnostics and Control Center
- [x] English/Spanish UI shell and deterministic fixtures
- [x] Manual-only release workflow prepared
- [x] Reproducible npm lockfile and `npm ci` in CI
- [x] SBOM, license audit, VSIX content audit and SHA-256 scripts (`verify:enterprise`)
- [x] Basic extracted-VSIX activation smoke in a real VS Code Extension Host on Linux
- [ ] Packaged VSIX E2E on Windows and macOS
- [ ] Accessibility and full localization acceptance

## Analysis and providers
- [x] GitHub Actions: 68 rule codes, positions, severity, categories ([docs/ANALYSIS.md](docs/ANALYSIS.md))
- [x] GitLab CI, Azure Pipelines and Jenkins (declarative) providers behind a registry ([docs/PROVIDERS.md](docs/PROVIDERS.md))
- [x] Provider-neutral `PipelineModel` and job graph with textual alternative
- [x] Corpus-based precision/recall gate for the GitHub analyzer and a performance budget
- [ ] Resolve GitLab `include`, Azure templates and Jenkins shared libraries
- [ ] Jenkins scripted pipelines
- [ ] Policy/baseline comparisons for introduced vs existing defects
- [ ] Safe, previewable quick fixes
- [ ] Multi-root, monorepo, WSL/remote and multi-OS manual acceptance

## Intent, evidence and generation
- [x] Intent contracts (`.orquestivo/intent.json`) with PASS/FAIL/WARN/SKIP/INCONCLUSIVE/BLOCKED ([docs/EVIDENCE.md](docs/EVIDENCE.md))
- [x] Opt-in read-only GitHub Actions run connector (injected `fetch`/token, bounded, redacted)
- [x] Run metrics: durations, failure rate, slowest jobs, redundant jobs, cache-miss suspicions
- [x] Generator presets: node, typescript, react, next, go, python, java-maven, java-gradle, php, docker ([docs/GENERATOR.md](docs/GENERATOR.md))
- [ ] Real GitHub end-to-end of the connector (BLOCKED: needs credentials and network)
- [ ] Remote evidence for GitLab, Azure Pipelines and Jenkins
- [ ] Local runner compatibility checks with opt-in execution
- [ ] Deployment-specific generation beyond the gated placeholder template

## Optional AI
- [x] Consent, redacted disclosure, success-claim guard and `INCONCLUSIVE`-only suggestions ([docs/AI.md](docs/AI.md))
- [ ] A reference provider adapter (none is bundled by design; needs a privacy and cost review)

## Release
Release gate: explicit owner approval, full test matrix, security review, accessibility, package contents, CI evidence and storefront confirmation. Version transition from 0.1.0 to 0.2.0 is described in [CHANGELOG.md](CHANGELOG.md).

See [`RELEASE_READINESS.md`](RELEASE_READINESS.md), [`docs/RELEASE.md`](docs/RELEASE.md) and [`docs/RULESETS.md`](docs/RULESETS.md).
