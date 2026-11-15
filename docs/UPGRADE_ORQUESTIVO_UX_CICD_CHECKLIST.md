# Upgrade checklist — project-aware CI/CD audit

Baseline: `main` @ `122c1dc`, version `0.2.0`, branch `feat/control-center-ci-audit-ux`. Status: TODO / PASS / PARTIAL / BLOCKED.

| ID | Requirement | Status | Files | Evidence / notes |
|---|---|---|---|---|
| OQ-P0-01 | Project selector, per-workspace persistence, scoped scan | PASS (unit) / integration BLOCKED | `src/core/project.ts`, `src/vscode/project.ts`, `scanner.ts`, `scan-service.ts`, `control-center.ts`, `render.ts` | `test/project-audit.test.cjs`; not exercised in a real VS Code window |
| OQ-P0-02 | "Analyze existing CI/CD" as primary path, "Create new CI" secondary | PASS (render contract) | `render.ts`, `i18n.ts` | render tests |
| OQ-P0-03 | Prioritised improvement plan from real findings | PARTIAL | `src/core/recommendations.ts` | Guidance only (`manual-only`); no apply/patch |
| OQ-P0-04 | Single project context for scan, intent, remote, generator | PASS (code) | `intent.ts`, `remote.ts`, `generator.ts`, `extension.ts` | Remote runs reset and stale scans discarded on project change; no automated multi-root integration test |
| OQ-P0-05 | Safe remediation (diff, confirm, hash guard, undo, re-analysis) | TODO | — | Not implemented: no autofix is offered |
| OQ-P1-06 | Specific empty states (no folder, no CI, not evaluated, partial) | PARTIAL | `render.ts` | untrusted/cancelled/read-failure messages reuse existing ones |
| OQ-P1-07 | Honest executive summary | PASS | `recommendations.ts`, `render.ts` | never says "perfect" |
| OQ-P1-08 | Preserve UI state on refresh | TODO | — | full `webview.html` replacement unchanged |
| OQ-P1-09 | Remote evidence tied to project | PARTIAL | `remote.ts` | repo guess + reset follow selection; copy not reworked |
| OQ-P1-10 | AI honesty | PASS (unchanged) | — | no provider claimed |
| OQ-P1-11 | Docs contradictions | PARTIAL | `docs/USAGE.md`, `CHANGELOG.md` | README/walkthrough/screenshots not updated |
| OQ-P1-12 | E2E for the main journey | BLOCKED | — | needs real VS Code; not run |
| OQ-P2-13 | Tabs / progressive disclosure | TODO | — | single scrolling page, new summary on top |
| OQ-P2-14 | Accessibility/theme verification | BLOCKED | — | no graphical session |
| OQ-P2-15 | Stale-result protection | PASS (code) | `scan-service.ts` | generation counter + cancellation; not unit-testable without vscode |

## Validation log
- `npm run typecheck`, `npm run lint`: PASS.
- `npm test`: 782/783 pass; the failure `safe-path: a real symlink or junction pointing outside the root is rejected` reports `unresolvable` instead of `symlink-escape` on this Windows host. The safe-path code was not modified (it fails closed); treated as an environment issue, not verified on CI.
- Not run: `test:integration`, `verify:enterprise`, `package`.
