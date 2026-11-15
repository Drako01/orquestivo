# Upgrade checklist — project-aware CI/CD audit

Baseline: `main` @ `122c1dc`, version `0.2.0`, branch `feat/control-center-ci-audit-ux`. Status: TODO / PASS / PARTIAL / BLOCKED.

| ID | Requirement | Status | Files | Evidence / notes |
|---|---|---|---|---|
| OQ-P0-01 | Project selector, per-workspace persistence, scoped scan | PASS (unit) | `src/core/project.ts`, `src/vscode/project.ts`, `scanner.ts`, `scan-service.ts` | `test/project-audit.test.cjs`; not exercised in a real VS Code window |
| OQ-P0-02 | "Analyze existing CI/CD" primary, "Create new CI" secondary | PASS (render contract) | `render.ts`, `i18n.ts` | render tests |
| OQ-P0-03 | Prioritised plan from real findings | PASS | `src/core/recommendations.ts` | `manual-only` unless a verified fix exists |
| OQ-P0-04 | One project context for scan, intent, remote, generator | PASS (code) | `intent.ts`, `remote.ts`, `generator.ts`, `extension.ts` | no automated multi-root integration test |
| OQ-P0-05 | Safe remediation (diff, confirm, hash guard, undo, re-analysis) | PASS (unit) / integration BLOCKED | `src/providers/remediation.ts`, `src/vscode/remediation.ts` | 7 rules over 4 providers; `test/remediation.test.cjs`; write/undo path needs real VS Code (not run) |
| OQ-P1-06 | Specific empty/error states | PASS (render contract) | `render.ts`, `store.ts` | no CI, no folder, untrusted (+ manage trust), cancelled, unreadable/oversized/failed files, partial |
| OQ-P1-07 | Honest executive summary | PASS | `recommendations.ts`, `render.ts` | never says "perfect" |
| OQ-P1-08 | Preserve UI state on refresh | PASS (unit of markup) / visual BLOCKED | `client-script.ts`, `control-center.ts`, `render.ts` | host posts `<main>` fragment; script restores tab, focus, scroll, open details, level select; shell rebuilt when the panel becomes visible again. Not observed in a real webview |
| OQ-P1-09 | Remote evidence tied to project | PARTIAL | `remote.ts` | repo guess + reset follow selection; copy not reworked |
| OQ-P1-10 | AI honesty | PASS (unchanged) | — | no provider claimed |
| OQ-P1-11 | Docs contradictions | PARTIAL | `README.md`, `docs/USAGE.md`, `CHANGELOG.md` | README/USAGE/CHANGELOG updated; **new screenshots BLOCKED** (see below) |
| OQ-P1-12 | E2E for the main journey | BLOCKED | — | needs real VS Code; not run |
| OQ-P2-13 | Tabs / progressive disclosure | PASS (markup, ARIA, keyboard in script) | `render.ts`, `client-script.ts` | 6 tabs, roving tabindex, arrows/Home/End |
| OQ-P2-14 | Accessibility/theme verification | BLOCKED | — | no graphical session |
| OQ-P2-15 | Stale-result protection | PASS (code) | `scan-service.ts` | generation counter + cancellation |

## Validation log
- `npm run typecheck`, `npm run lint`: PASS.
- `npm test`: 794/795 pass; the failure `safe-path: a real symlink or junction pointing outside the root is rejected` reports `unresolvable` instead of `symlink-escape` on this Windows host. Code untouched (fails closed); not verified on CI.
- Not run: `test:integration`, `verify:enterprise`, `package`.
- Screenshots: `msedge` is not on PATH and the command policy refused the full path, so no PNG was produced; no workaround was attempted. Scenes 09-11 of `scripts/render-readme-media.mjs` are ready to capture.
