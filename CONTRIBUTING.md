# Contributing to Orquestivo

**We welcome contributions! ¡Todas las contribuciones son bienvenidas!**

Orquestivo is an open-source VS Code CI/CD workflow studio developed by Alejandro Daniel Di Stefano. It is currently a **pre-release v0.1.0 foundation**, not an enterprise-certified product. We value testable improvements, accessibility, security and documentation as much as new features.

**En español:** Podés contribuir con código, pruebas, documentación, traducciones ES/EN, revisión de seguridad, accesibilidad y experiencia de usuario. Abrí un issue antes de implementar cambios grandes, trabajá en una rama y enviá un PR con evidencia de pruebas. No es necesario tener experiencia avanzada para colaborar.

## Ways to contribute

- **Good first contributions:** fix inaccurate documentation, improve diagnostics wording, add edge-case fixtures, refine ES/EN messages and report accessible UI defects.
- **Engineering:** strengthen YAML analysis, source positions and false-positive handling; add defensive tests; improve performance and cancellation without changing existing behavior.
- **Product and UX:** propose clear beginner-to-expert flows, improve keyboard navigation and report screen-reader or contrast issues.
- **DevOps / QA:** reproduce problematic GitHub Actions constructs using sanitized fixtures; document expected versus observed results.

Read the [roadmap](ROADMAP.md) and [release-readiness gates](RELEASE_READINESS.md) before starting. For larger changes, open a [GitHub issue](https://github.com/Drako01/orquestivo/issues) to agree on scope and acceptance criteria.

## Set up a development environment

Requirements: Node.js **22+**, npm, VS Code **1.99+**, and Git.

```bash
git clone https://github.com/YOUR-USERNAME/orquestivo.git
cd orquestivo
git remote add upstream https://github.com/Drako01/orquestivo.git
# Until the foundation PR is merged, work from the implementation branch:
git fetch upstream feat/mvp-foundation
git switch -c feat/my-first-change FETCH_HEAD
npm ci
npm run verify
```

Choose a descriptive branch such as `feat/workflow-rule-example`, `fix/diagnostic-position`, or `docs/first-run-guide`. Keep PRs focused; do not combine unrelated refactoring with fixes.

For local VS Code smoke testing:

```bash
npm run test:integration
npm run package
```

Install the resulting VSIX through **Extensions → Install from VSIX…** and test the relevant workflow manually where practical.

## Engineering expectations

1. **Correctness before claims:** clearly distinguish YAML parsing, static findings, executed CI evidence and proof of the intended outcome. Do not mark a skipped or inconclusive check as PASS.
2. **Maintainability:** strict TypeScript, SOLID/KISS/DRY/YAGNI, small cohesive units, explicit data contracts and no unnecessary dependencies.
3. **Safety:** repository YAML is untrusted input. Never execute project commands, reveal credentials, send workflow data remotely or weaken Workspace Trust without an explicit, reviewed design.
4. **Regression prevention:** add or update tests for each behavior, including malformed inputs and false-positive cases. Preserve public commands and existing features.
5. **User experience:** actionable error messages, keyboard accessibility, reasonable performance and EN/ES localization when adding user-facing text.
6. **Scope:** proposed features must match the current stage or have explicit design and acceptance criteria. Unsupported providers and runtime execution must not be represented as implemented.

## Pull request checklist

Before submitting a PR:

- [ ] Explain the problem and proposed change, with an issue link when applicable.
- [ ] State **acceptance criteria** and how you verified each one.
- [ ] Include tests covering positive, negative and regression scenarios.
- [ ] Run `npm run verify` and report the result.
- [ ] Run `npm run test:integration` and `npm run package` when VS Code behavior, packaging or extension resources change.
- [ ] Update the README, docs or translations for user-visible changes.
- [ ] Confirm no secrets, tokens, proprietary workflows, private logs or unnecessary generated files are included.
- [ ] Describe any limitations, risks, compatibility impacts and skipped tests.

While the foundation remains in [PR #1](https://github.com/Drako01/orquestivo/pull/1), coordinate with the maintainer and propose implementation changes against **`feat/mvp-foundation`**. Once the foundation is merged, use **`main`** as the base. GitHub rulesets require CI verification and may require a maintainer review; maintainers handle approvals and merges. **Never force-push to protected branches or create release tags as part of a contribution.** Do not publish the extension.

## Reporting bugs and security issues

For bugs, open a [GitHub issue](https://github.com/Drako01/orquestivo/issues) with VS Code / OS versions, steps to reproduce, expected versus actual behavior, and a minimal **sanitized** YAML snippet. Exclude internal project data and credentials.

For security vulnerabilities, **do not post a public issue**. Follow [SECURITY.md](SECURITY.md) and use GitHub Security Advisories or the private support channel specified there.

All participants must follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Thanks for helping make pipeline tooling more precise, accessible and trustworthy.
