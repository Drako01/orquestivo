# Orquestivo — Enterprise quality roadmap

Public source repository; extension is **not released**. Checked items mean implemented, not automatically certified for production.

## Foundation
- [x] Identity and monochrome theme-adaptive Activity Bar icon
- [x] Strict TypeScript baseline and modular static analyzer
- [x] Native diagnostics and read-only Control Center
- [x] English/Spanish UI shell and first deterministic fixtures
- [x] Manual-only release workflow prepared
- [x] Reproducible npm lockfile and `npm ci` in CI
- [ ] Dependency provenance and SBOM acceptance
- [x] Basic extracted-VSIX activation smoke in a real VS Code Extension Host on Linux
- [ ] Expanded packaged VSIX E2E across all supported operating systems
- [ ] Accessibility and full localization acceptance

## GitHub Actions MVP
- [ ] Complete semantics for triggers, filters, contexts, expressions, matrices and permissions
- [x] Initial source positions, severity and rule IDs for supported YAML constructs
- [ ] Full schema/expression semantics, localization and precision corpus
- [x] Basic CI templates for Node.js, Go, Python and Maven with preview/confirmation
- [ ] Intent contracts, acceptance criteria and deployment-specific generation
- [ ] Policy/baseline comparisons for introduced vs existing defects
- [ ] Safe, previewable fixes and opt-in external validation
- [ ] Representative precision/recall corpus and performance limits
- [ ] Multi-root, monorepo, WSL/remote and multi-OS acceptance

## Evidence and enterprise
- [ ] Local runner compatibility checks with opt-in execution
- [ ] Remote GitHub Actions run/job/log correlation
- [ ] Independent PASS/FAIL/WARN/SKIP/INCONCLUSIVE states
- [ ] Secret-safe credential and permission diagnostics
- [ ] AI suggestions as hypotheses, never execution proof
- [ ] CI optimization based on observed costs and timing
- [ ] Additional CI providers after GitHub Actions maturity

Release gate: explicit owner approval, full test matrix, security review, accessibility, package contents, CI evidence and storefront confirmation.

See [`RELEASE_READINESS.md`](RELEASE_READINESS.md) for the current evidence-backed checklist and [`docs/RULESETS.md`](docs/RULESETS.md) for governance activation.
