# Orquestivo architecture

## Governing invariant

A syntactically valid pipeline, a static observation, actual execution evidence and proof of the intended outcome are **different states**. Never infer one from another. Every finding carries `evidence: static`; only the opt-in remote connector can produce `remote-evidence`, and AI output is never evidence.

## Layers and boundaries

Dependencies point inward: the VS Code layer depends on the core, never the reverse. Modules under `src/core`, `src/providers`, `src/security` and `src/ai` do not import `vscode` (so they run under plain `node --test`).

| Path | Responsibility |
| --- | --- |
| `src/core/` | Provider-neutral contracts and pure logic: `CiProvider` (`provider.ts`), `PipelineModel` (`model.ts`), findings (`findings.ts`), job graph (`analysis/`), generator (`generation/`, façade `generator.ts`), evidence and intent evaluation (`evidence/`) |
| `src/core/github/` | GitHub Actions provider: rule modules under `rules/` and the registry `GITHUB_RULES` (69 codes, see [docs/ANALYSIS.md](docs/ANALYSIS.md)) |
| `src/providers/` | GitLab CI, Azure Pipelines and Jenkins providers, `registry.ts` (`providerRegistry`, `detectProvider`) and `shared/` building blocks (rule catalog, bounded YAML analysis, cycle detection, text heuristics) |
| `src/security/` | `redact.ts`, `safe-path.ts` (symlink-aware containment), `limits.ts` (bounded reads) |
| `src/ai/` | Consent, disclosure, success-claim guard and provider contract. No network code and no SDK |
| `src/extension.ts` (+ UI modules the extension layer is split into) | Workspace Trust, bounded file reads, Diagnostics API, tree view, webview, SecretStorage, commands |
| `src/i18n.ts`, `package.nls*.json` | UI localization (EN/ES) |
| `media/` | Approved brand and theme-adaptive Activity Bar icon |
| `test/`, `scripts/` | Deterministic tests; verify/coverage/mutation/SBOM/audit harness ([docs/TESTING.md](docs/TESTING.md)) |

> The extension layer was being split into further modules (for example `src/vscode`, `src/ui`) while this document was written. This table describes the intended boundary; verify exact file names in the tree.

## Key design decisions

- **Provider abstraction.** Each CI dialect implements `matches(path)`, `analyze(source)` and `model(source)`. The registry selects a provider by file path; adding a provider does not change the core ([docs/PROVIDERS.md](docs/PROVIDERS.md)). Rules are data plus a `check`; severity, category, impact, recommendation and docs live once in rule metadata (single source of truth, also used to generate the rule catalog).
- **Neutral `PipelineModel`.** Intent evaluation, the job graph and the Control Center consume the model, not provider ASTs. The pipeline diagram has a textual alternative (`renderGraphText`).
- **Never throws on hostile input.** Size caps, alias-expansion caps, depth limits and failure containment turn parser problems into findings (`YAML_INVALID`, `YAML_TOO_LARGE`, `ANALYZER_FAILURE`).
- **Verdict algebra.** `PASS | FAIL | WARN | SKIP | INCONCLUSIVE | BLOCKED` with precedence `FAIL > BLOCKED > INCONCLUSIVE > WARN > SKIP > PASS` ([docs/EVIDENCE.md](docs/EVIDENCE.md)). The same vocabulary is used by the verify harness.
- **Intent contracts.** `.orquestivo/intent.json` is validated with a strict hand-written parser (unknown keys rejected, bounded strings). `evaluateIntent` is pure.
- **Remote evidence is injected.** `fetch`, the token provider, clock and sleep are parameters of the connector, so the core has no network or credential storage. Only the VS Code layer binds a SecretStorage-backed token provider.
- **Generator fails closed.** Options are validated once; actions without a verified SHA pin are never guessed ([docs/GENERATOR.md](docs/GENERATOR.md)). Writing is planned (`write-plan.ts`), previewed as a diff, never overwrites, and the last generation can be undone.
- **AI is a boundary, not a feature of the core.** The host injects an `AiProvider`; the request is derived from the redacted disclosure the user saw; offered suggestions are typed `INCONCLUSIVE` ([docs/AI.md](docs/AI.md)).

## Security model

Repository content is untrusted data, not policy or instructions. UI content is escaped; the webview is restricted by CSP and does not receive repository strings unescaped; no repository commands run. Threats and mitigations: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md); open checks: [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). Privacy behavior: [PRIVACY.md](PRIVACY.md).

## Quality objectives

Strict TypeScript; KISS, DRY, YAGNI and SOLID; accessible VS Code surfaces; cross-platform test coverage; risk-based checks; precise attribution; reproducible releases; complete i18n; secure-by-default operations; explicit inconclusive states.

## Known gaps

- Static analysis covers a subset of each provider's semantics; includes, templates and shared libraries are not resolved.
- Remote evidence exists for GitHub Actions only; its real-network end-to-end test is BLOCKED without credentials.
- No local runner and no runtime execution.
- Accessibility (keyboard/screen reader), full EN/ES rule localization and manual remote-environment verification (WSL, SSH, Dev Containers) are not yet accepted. See [RELEASE_READINESS.md](RELEASE_READINESS.md) and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
