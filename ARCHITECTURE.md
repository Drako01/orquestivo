# Orquestivo architecture

## Governing invariant
A syntactically valid workflow, a static observation, actual execution evidence and proof of the intended outcome are **different states**. Never infer one from another.

## Boundaries
- `src/core/`: side-effect-free, typed YAML AST/job-DAG analyzer and CI template generator. No VS Code imports.
- `src/extension.ts`: workspace trust, bounded file reads, Diagnostics API and webview.
- `src/i18n.ts` and `package.nls*.json`: UI localization.
- `media/`: approved graphic identity and theme-adaptive `currentColor` Activity Bar icon.
- `test/`: deterministic behavior and regression fixtures.

Repository content is untrusted data, not policy or executable instructions. UI content must be escaped; no repository commands run implicitly. Future CI runner adapters require consent, timeouts, process limits, cancellation and secret redaction.

## Quality objectives
Strict TypeScript; KISS, DRY, YAGNI and SOLID; accessible VS Code surfaces; cross-platform test coverage; risk-based checks; precise attribution; reproducible releases; complete i18n; secure-by-default operations; explicit inconclusive states.

## Known gaps
Current implementation is only an early subset of GitHub Actions schema analysis. Most supported rules now carry YAML AST line positions. No runtime execution verification, no deployment generation, no remote API integration and no complete screen-reader certification yet. Basic generation templates and packaged VSIX activation tests are not proof of workflow correctness.
