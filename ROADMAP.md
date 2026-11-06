# Orquestivo — Enterprise quality roadmap

Private development. Items not checked are **not implemented**.

## Foundation
- [x] Identity and monochrome theme-adaptive Activity Bar icon
- [x] Strict TypeScript baseline and modular static analyzer
- [x] Native diagnostics and read-only Control Center
- [x] English/Spanish UI shell and first deterministic fixtures
- [x] Manual-only release workflow prepared
- [ ] Reproducible lockfile, CI with `npm ci` and precise dependency provenance
- [ ] Packaged VSIX E2E in real VS Code
- [ ] Accessibility and full localization acceptance

## GitHub Actions MVP
- [ ] Complete semantics for triggers, filters, contexts, expressions, matrices and permissions
- [ ] Accurate source positions, severity, rule IDs, and explainable findings
- [ ] Declarative workflow creation from explicit goals and acceptance requirements
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
