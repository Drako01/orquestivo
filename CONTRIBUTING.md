# Contributing to Orquestivo

**We welcome contributions! ¡Todas las contribuciones son bienvenidas!**

Orquestivo is an open-source VS Code CI/CD studio developed by Alejandro Daniel Di Stefano. It is an **unreleased preview**, not an enterprise-certified product. We value testable improvements, accessibility, security and documentation as much as new features.

**En español:** Podés contribuir con código, pruebas, documentación, traducciones ES/EN, revisión de seguridad, accesibilidad y experiencia de usuario. Abrí un issue antes de implementar cambios grandes, trabajá en una rama y enviá un PR con evidencia de pruebas. No es necesario tener experiencia avanzada para colaborar.

## Ways to contribute

- **Good first contributions:** fix inaccurate documentation, improve diagnostics wording, add edge-case fixtures, refine ES/EN messages and report accessible UI defects.
- **Engineering:** add or sharpen rules, providers and presets; reduce false positives; improve performance and cancellation without changing existing behavior.
- **Product and UX:** propose clear beginner-to-expert flows, improve keyboard navigation and report screen-reader or contrast issues.
- **DevOps / QA:** reproduce problematic pipeline constructs using sanitized fixtures; document expected versus observed results.

Read the [roadmap](ROADMAP.md) and the [release-readiness gates](RELEASE_READINESS.md) first. For larger changes, open a [GitHub issue](https://github.com/Drako01/orquestivo/issues) to agree on scope and acceptance criteria.

## Set up a development environment

Requirements: Node.js **22+**, npm, VS Code **1.99+**, and Git. Details and the repository tour: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
git clone https://github.com/YOUR-USERNAME/orquestivo.git
cd orquestivo
git remote add upstream https://github.com/Drako01/orquestivo.git
# Until the foundation PR is merged, work from the implementation branch:
git fetch upstream feat/mvp-foundation
git switch -c feat/my-first-change FETCH_HEAD
npm ci
npm run verify:fast
```

Choose a descriptive branch such as `feat/gitlab-rule-example`, `fix/diagnostic-position` or `docs/first-run-guide`. Keep PRs focused.

## Verification gates

| Command | When |
| --- | --- |
| `npm run verify:fast` | Every change: typecheck, lint, unit tests |
| `npm run verify:platform` | Adds rulesets check and production build (what Windows/macOS CI run) |
| `npm run verify:enterprise` | Before a PR that touches analysis, security, packaging or the harness: coverage, mutation, perf, package, VSIX audit, SBOM, licenses, audit |
| `npm run verify:release` | Maintainers only: strict, no cache, any non-PASS fails |
| `npm run test:integration` | When VS Code behavior, packaging or resources change (downloads VS Code) |

Report real results. A skipped step is `SKIP`/`INCONCLUSIVE`, an unreachable registry is `BLOCKED`; neither is a pass ([docs/TESTING.md](docs/TESTING.md)).

## Adding a GitHub Actions rule

1. Pick the module under `src/core/github/rules/` that matches the concern (or add one) and define the rule: `id`, `metas` (severity, category, impact, recommendation, docs link) and `check(ctx)`.
2. Register it in `src/core/github/rules/index.ts` (`GITHUB_RULES`).
3. Add positive, negative and boundary cases in `test/analyzer-rules.test.cjs`; a guard fails if a rule has no cases. Add a corpus file under `test/corpus/` (and `manifest.json`) if it matters for precision/recall.
4. Keep the rule catalog in [docs/ANALYSIS.md](docs/ANALYSIS.md) consistent (the catalog is derived from the metadata).
5. Add EN/ES user-facing text through the project's i18n when the message is shown to users.

Do not duplicate metadata between the rule and the docs; the rule metadata is the single source of truth.

## Adding a CI provider

1. Create `src/providers/<id>/` with `provider.ts` implementing `CiProvider` (`id`, `displayName`, `filePatterns`, `matches`, `analyze`, `model`). Reuse `src/providers/shared` (`RuleCatalog`, `FindingCollector`, `analyzeYamlPipeline`, `findCycleMembers`, text heuristics) instead of writing new helpers.
2. Rules live in `rules.ts` with a `RuleCatalog`; `analyze` must never throw on hostile input and must enforce size limits.
3. Return a provider-neutral `PipelineModel` from `model()` so the graph and intent evaluation work unchanged.
4. Register it in `src/providers/registry.ts`.
5. Add tests in `test/providers/` with fixtures under `test/providers/fixtures/` (valid, invalid and hostile). Update [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Adding a generator preset

1. Add the preset to the generation types, its marker files and "needs real execution" notes in `src/core/generation/requirements.ts` (single source of truth for the UI), and its options in the preset capabilities.
2. Render it in `src/core/generation/`. Always pin actions by SHA, set least-privilege `permissions`, job timeouts and concurrency. Never guess a SHA: fail closed unless a verified pin exists.
3. Cover it in `test/generator.test.cjs` and make sure the generated YAML passes the analyzer without errors. Update [docs/GENERATOR.md](docs/GENERATOR.md).

## Test layout

`test/*.test.cjs` hold unit and rule tests; `test/corpus/` the workflow corpus; `test/providers/`, `test/evidence/` (intent, verdicts, connector, AI), `test/security/` and `test/integration/` (real VS Code). The unit suite compiles `src/` to `dist-test/`; modules importing `vscode` are covered by the integration suite. The real GitHub test (`github-runs.e2e-real.test.cjs`) needs credentials and is reported as BLOCKED without them.

## Engineering expectations

1. **Correctness before claims:** distinguish parsing, static findings, executed CI evidence and proof of the intended outcome. Do not mark a skipped or inconclusive check as PASS.
2. **Maintainability:** strict TypeScript, no `any`, SOLID/KISS/DRY/YAGNI, small cohesive units, explicit data contracts and no unnecessary dependencies. No duplicated logic: extend or extract.
3. **Safety:** repository files are untrusted input. Never execute project commands, reveal credentials, send pipeline data remotely or weaken Workspace Trust without a reviewed design. Network access exists only in the opt-in GitHub connector.
4. **Regression prevention:** add or update tests for each behavior, including malformed inputs and false-positive cases. Preserve public commands.
5. **User experience:** actionable messages, keyboard accessibility, reasonable performance and EN/ES localization for new user-facing text.
6. **Scope:** features must match the roadmap or have explicit design and acceptance criteria. Unimplemented capabilities must not be represented as implemented.

## Commit convention

Conventional Commits: `<type>(<scope>): <subject>`, for example `feat(providers): add gitlab include resolution`, `fix(analyzer): correct cron validation`, `docs(readme): update usage`. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `security`, `chore`. Commits and code comments are in English.

## Pull request checklist

- [ ] Explain the problem and proposed change, with an issue link when applicable.
- [ ] State **acceptance criteria** and how you verified each one.
- [ ] Include tests covering positive, negative and regression scenarios.
- [ ] Run `npm run verify:fast` (and `verify:enterprise` where listed above) and report the result.
- [ ] Run `npm run test:integration` and `npm run package` when VS Code behavior, packaging or extension resources change.
- [ ] Update README, docs or translations for user-visible changes.
- [ ] Confirm no secrets, tokens, proprietary workflows, private logs or generated files are included.
- [ ] Describe limitations, risks, compatibility impacts and skipped tests.

While the foundation remains in [PR #1](https://github.com/Drako01/orquestivo/pull/1), coordinate with the maintainer and propose changes against **`feat/mvp-foundation`**. Once merged, use **`main`**. GitHub rulesets require CI verification and may require maintainer review; maintainers handle approvals and merges. **Never force-push to protected branches or create release tags as part of a contribution.** Do not publish the extension.

## Reporting bugs and security issues

For bugs, open a [GitHub issue](https://github.com/Drako01/orquestivo/issues) with VS Code / OS versions, steps to reproduce, expected versus actual behavior, and a minimal **sanitized** pipeline snippet. Exclude internal project data and credentials. See also [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

For security vulnerabilities, **do not post a public issue**. Follow [SECURITY.md](SECURITY.md).

All participants must follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Thanks for helping make pipeline tooling more precise, accessible and trustworthy.
