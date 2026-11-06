# Plan: Orquestivo Full Enterprise AAAA

"Full Enterprise AAAA" is not a formal certification. It is the engineering standard defined in `TODO` for this
project: a capability counts as done only with verifiable evidence, never because code was written.
Current state is tracked in `ENTERPRISE_AAAA_STATUS.md`; this file defines phases, dependencies and acceptance criteria.

## Operating rules

- Branch `feat/mvp-foundation`, PR #1 preserved. No merge to `main`, no tags, no marketplace publication without explicit owner approval.
- Impact-based verification: run what the diff can break, reuse valid evidence (`PASS_REUSED`), run the full battery only for a release candidate (`npm run verify:release`).
- Status vocabulary (single source: `scripts/lib/common.mjs`): `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE`, `BLOCKED`.
- One responsibility per commit; duplicated code is a defect (extract and migrate callers in the same change).

## Phases

| # | Phase | Depends on | Deliverables | Acceptance criteria |
|---|---|---|---|---|
| 0 | Repository audit | none | This plan, status file, `RELEASE_READINESS.md` | Real state of code, tests, CI, docs and limits recorded, no claim without evidence |
| 1 | Enterprise architecture | 0 | Provider-neutral model, findings, provider contracts, layered modules under `src/core` | Strict TS, no unjustified `any`, domain free of `vscode`, contract tests for providers |
| 2 | Advanced analysis engine | 1 | Rule catalog with positive, negative and boundary cases, semantic coverage documented | Every rule has tests in all three classes; malformed-input corpus passes without crashes |
| 3 | Pipeline design and generation | 1, 2 | Stack detection, write plan, generated workflows validated by the analyzer | Generated pipelines have no `error` findings; generator output is deterministic |
| 4 | Intent and evidence | 1, 2 | Intent contracts, evidence kinds, verdict logic | Static findings are never reported as runtime proof; verdict logic mutation-tested |
| 5 | Control Center UX/UI | 2, 4 | Webview/tree views driven by core results | Keyboard operable, themed, tested in integration host |
| 6 | i18n and accessibility | 5 | EN/ES for all user-visible text; a11y checks | No hardcoded copy; key parity test; documented a11y review |
| 7 | Security | 1 | `docs/THREAT_MODEL.md`, `docs/SECURITY_AUDIT.md`, secret redaction, trust checks | Threat model decisions implemented or tracked; audit checklist reviewed with evidence |
| 8 | Quality gates | 2-4 | `scripts/verify-enterprise.mjs`, coverage on original TS, mutation testing, perf budgets, SBOM, license and VSIX audits | `npm run verify:enterprise` yields per-step status and JSON/Markdown reports; exit code follows results |
| 9 | Environments and compatibility | 8 | `docs/COMPATIBILITY.md`, cross-OS CI | Windows/Linux/macOS verified by CI; WSL/SSH/Dev Containers/multi-root listed as manual pending until run |
| 10 | Advanced integrations | 1, 7 | Additional providers, opt-in remote features | Only real, tested capabilities exposed; consent, limits and revocation documented |
| 11 | Documentation and onboarding | 2-10 | README, ARCHITECTURE, ROADMAP, CHANGELOG, `docs/TESTING.md`, walkthrough | Docs match shipped behavior; no promise without implementation |
| 12 | Release engineering | 8, 9 | Hardened `ci.yml` / `publish.yml`, `docs/RELEASE.md`, `.vscodeignore`, policies | One verified VSIX for both registries, SHA-256 checked, OIDC, protected environments, partial-publish recovery documented; **no publication without owner approval** |

## Dependencies at a glance

```
0 -> 1 -> 2 -> 3
          2 -> 4 -> 5 -> 6
     1 -> 7
2,3,4 -> 8 -> 9
1,7 -> 10
2..10 -> 11
8,9 -> 12
```

## Release candidate gate

All of the following on the exact commit to publish (`npm run verify:release`, strict, no cache):
typecheck, lint, unit/contract tests, rulesets check, coverage thresholds, mutation floor, performance budgets,
production build, VSIX package, VSIX content audit, SHA-256, SBOM, license audit and production `npm audit`.
`BLOCKED` or `INCONCLUSIVE` (for example no network for `npm audit`) is never a pass.

## Versioning

`0.1.0` stays the first public scope. Capabilities that are incomplete at release are documented in the changelog
and roadmap and shipped in later SemVer minors; the scope of a version is never inflated to match the vision.

## Risks

| Risk | Mitigation |
|---|---|
| Parallel work on shared files | Ownership split by path; targeted edits of `package.json` sections |
| Coverage and mutation numbers drive behavior, not quality | Thresholds are floors, survivors are reviewed, exceptions justified in the status file |
| Registry or network outage during release | `npm audit` reports `BLOCKED`; strict mode refuses to release on it |
| Partial publication across registries | Registry-selective dispatch plus reuse of the verified VSIX artifact (see `docs/RELEASE.md`) |
