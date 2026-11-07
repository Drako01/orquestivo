# Development guide

Contributor workflow and conventions: [../CONTRIBUTING.md](../CONTRIBUTING.md). Design: [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Setup

Node.js 22+, npm, VS Code 1.99+, Git.

```bash
npm ci
npm run verify:fast
```

## Repository tour

| Path | Contents |
| --- | --- |
| `src/core/` | Provider-neutral analyzer contracts, `PipelineModel`, job graph, generator, evidence (intent, verdicts, GitHub run connector, metrics) |
| `src/core/github/` | GitHub Actions provider and rule modules |
| `src/providers/` | GitLab CI, Azure Pipelines, Jenkins, registry, shared helpers |
| `src/security/` | Redaction, safe paths, bounded reads |
| `src/ai/` | Consent, disclosure, guard, provider contract |
| `src/extension.ts` | VS Code integration (being split into further modules; check the tree) |
| `test/` | Unit, corpus, provider, evidence, security and integration tests |
| `scripts/` | Verify harness, coverage, mutation, SBOM, license, VSIX audit, rulesets, publish helpers |
| `docs/` | User and engineering documentation |
| `reports/` | Generated, git-ignored harness output |

Rule: code outside the extension layer must not import `vscode`.

## Daily commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Bundle the extension with esbuild into `dist/` |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit`, ESLint with zero warnings |
| `npm test` | Compile tests to `dist-test/` and run `node --test` |
| `npm run verify:fast` | typecheck + lint + unit |
| `npm run verify:platform` | fast + rulesets + production build |
| `npm run verify:enterprise` | Every step with reports in `reports/` |
| `npm run verify:release` | Strict, no cache |
| `npm run test:coverage`, `npm run mutation` | Coverage thresholds, mutation floor |
| `npm run test:integration` | Real VS Code (downloads it) |
| `npm run package` | Verify and build `orquestivo.vsix` |
| `npm run sbom`, `audit:licenses`, `audit:vsix` | Supply-chain checks |
| `npm run rulesets:check` | Offline validation of `.github/rulesets` |

Harness options (`--only`, `--skip`, `--changed`, `--no-cache`, `--strict`, `--list`) and the status vocabulary are in [TESTING.md](TESTING.md). A partial run is `INCONCLUSIVE`; do not report it as passing.

## Running the extension

Build (`npm run build`), then press F5 in VS Code with this folder open (Extension Development Host), or install `orquestivo.vsix` after `npm run package`. Open a trusted folder with pipeline files to try it.

## Where to extend

- New GitHub rule, provider or generator preset: step lists in [../CONTRIBUTING.md](../CONTRIBUTING.md).
- New intent criterion: add the kind to the contract parser and evaluator in `src/core/evidence/intent.ts`, define its verdict mapping in [EVIDENCE.md](EVIDENCE.md) and add tests in `test/evidence/intent.test.cjs`. Static results must never claim runtime facts.
- Anything networked: only the GitHub connector is allowed network access, and it receives `fetch` and the token by injection.

## Conventions

Strict TypeScript, no `any`, single source of truth for metadata (rules, presets, requirements), no duplicated logic, Conventional Commits, English code and comments. Do not edit applied release/ruleset definitions without the maintainer. Do not commit `reports/`, `dist/`, `dist-test/` or VSIX files.
