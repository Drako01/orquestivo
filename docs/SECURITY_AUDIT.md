# Security audit checklist

Last full review: 2026-11-10, against the sources at the commit that carries this file.

Result vocabulary: `PASS` (confirmed in code and, where noted, by a test), `WARN` (a known gap or limit), `INCONCLUSIVE`
(needs runtime proof that is not available yet), `NOT_STARTED`. Every row names the file or test that backs it; re-verify
the row when that file changes. Threat decisions live in [THREAT_MODEL.md](THREAT_MODEL.md).

## A. Extension host and webview

| ID | Check | Result | Evidence |
|---|---|---|---|
| E-01 | No network access except the opt-in GitHub connector | PASS | `fetch` is only used in `src/vscode/remote.ts`; `aiStaysOffline` and `remoteEvidenceWithFakeNetwork` in `test/integration/scenarios.cjs` run in a real VS Code |
| E-02 | No subprocess or command execution | PASS | No `child_process` import anywhere under `src/` |
| E-03 | Secrets only in SecretStorage | PASS | `TOKEN_KEY` in `src/vscode/remote.ts`; the token never reaches settings, logs (`Logger` redacts) or workspace state |
| E-04 | Workspace Trust enforced before scan, generation, undo, remote fetch and intent loading | PASS | `src/vscode/scan-service.ts`, `generator.ts` (generate and undo), `remote.ts`, `intent.ts` |
| E-05 | Scan is bounded and cancellable | PASS | `readSource` and `scanWorkspace` in `src/vscode/scanner.ts`; oversize files become a `FILE_LIMIT` warning |
| E-06 | Webview scripts only through the CSP nonce | PASS | `enableScripts: true` is required by the Control Center; no inline handler or style exists. `test/ui/render.test.cjs`: "no script, style or handler without the nonce" |
| E-07 | Webview CSP | PASS | `default-src 'none'; img-src <cspSource>; style-src 'nonce-…'; script-src 'nonce-…'` in `src/ui/render.ts`, nonce from `randomBytes(16)` |
| E-08 | Repository strings escaped in the webview | PASS | `escapeHtml` in `src/ui/escape.ts`; `test/ui/render.test.cjs` renders hostile findings at all three levels |
| E-09 | Generated files are never replaced silently | PASS | New files use `createFile(..., { overwrite: false })`; an existing file is replaced only after a diff and a modal confirmation (`authorizeWrite`), and the last generation can be undone. `wizardCreateAndUndo` in `test/integration/scenarios.cjs` |
| E-10 | Generated workflow validated before offering it | PASS | `render()` in `src/vscode/generator.ts` runs the analyzer and refuses on `error` findings |
| E-11 | Webview `localResourceRoots` restricted | PASS | `[mediaRoot]` in `src/vscode/control-center.ts` |
| E-12 | `orquestivo.openFinding` argument validation | PASS | `resolveWorkspaceUri` in `src/vscode/runtime.ts` rejects `command:` and out-of-workspace URIs; `openFindingRejectsForeignTargets` in the integration suite |
| E-13 | Errors are not swallowed silently | PASS | Read and analysis failures are logged through the redacting `Logger` and surfaced as findings (`src/vscode/scanner.ts`) |
| E-14 | User-facing copy fully localized | WARN | EN/ES parity is tested (`test/i18n.test.cjs`); texts produced by the core (graph text, intent errors) are English only |
| E-15 | Configuration values validated | PASS | `readSettings` clamps numbers and validates enums (`src/vscode/runtime.ts`, `test/ui/logic.test.cjs`) |
| E-16 | Restricted-mode behavior | INCONCLUSIVE | The integration run starts VS Code with `--disable-workspace-trust`, so restricted mode is not exercised in a real host |
| E-17 | Writes cannot leave the workspace through a symlink or junction | PASS | `isInsideFolder` (uses `resolveInside`) guards generate and undo in `src/vscode/generator.ts`; real-junction test in `test/security/security.test.cjs`; `wizardRefusesLinksOutsideWorkspace` in the integration suite |
| E-18 | Webview messages validated with closed schemas | PASS | `parseWebviewMessage` in `src/ui/messages.ts`; boundary tests in `test/mutation-kill/messages.test.cjs` |
| E-19 | The GitHub token is not forwarded on a cross-origin redirect | PASS | `test/evidence/redirect-token.test.cjs` pins the runtime behavior |

## B. Analyzer and untrusted input

| ID | Check | Result | Evidence |
|---|---|---|---|
| C-01 | Parser limits for oversized, deeply nested and alias-heavy YAML | PASS | `test/corpus/hostile-*.yml`, hostile generators in `test/analyzer-corpus.test.cjs` |
| C-02 | Secret redaction in findings, diagnostics and exported reports | WARN | `src/security/redact.ts` is covered by tests and mutation; its use at every output boundary has not been traced exhaustively |
| C-03 | Path containment for paths derived from repository content | PASS | File names are validated (`src/ui/wizard.ts`) and every write is checked with `resolveInside` (E-17) |
| C-04 | Malformed input never crashes the analyzer | PASS | Corpus and `test/analyzer.test.cjs`; a failing rule becomes `ANALYZER_INTERNAL_ERROR` |
| C-05 | i18n key parity EN/ES | PASS | `test/i18n.test.cjs` |
| C-06 | Webview keyboard and screen-reader behavior | NOT_STARTED | No manual assistive-technology pass has been done |
| C-07 | Untrusted-context detection in scripts | PASS | `src/core/github/untrusted.ts`, rule cases in `test/analyzer-rules.test.cjs`, limits documented in [ANALYSIS.md](ANALYSIS.md) (no data-flow) |

## C. Supply chain and release

| ID | Check | Result | Evidence |
|---|---|---|---|
| S-01 | Lockfile committed, `npm ci` in CI | PASS | `package-lock.json`; `ci.yml` and `publish.yml` use `npm ci` |
| S-02 | Production dependency audit | WARN | `scripts/audit-deps.mjs` runs in the enterprise gate and reports `BLOCKED` offline; findings are advisory under the project's dependency policy |
| S-03 | License allowlist for production dependencies | PASS | `scripts/license-audit.mjs`, `scripts/license-policy.json` |
| S-04 | SBOM generated | PASS | `scripts/sbom.mjs`; attached to every release |
| S-05 | Actions pinned by SHA, minimal permissions | PASS | `ci.yml`, `publish.yml`; `persist-credentials: false` on every checkout |
| S-06 | VSIX content policy and secret scan | PASS | `scripts/vsix-audit.mjs`, `scripts/vsix-policy.json` |
| S-07 | Same VSIX for both registries, SHA-256 verified | PASS | `publish.yml`; exercised by the `0.1.2` release |
| S-08 | Environments restricted to `main` (no reviewer gate by design: publication is automatic after the merge) | PASS | Checked on every `verify:release` by `scripts/governance-check.mjs` through the GitHub API |
| S-09 | OIDC trusted publishing registered in both registries | INCONCLUSIVE | Owner-side registry settings; not visible from the repository |
| S-10 | Secret scanning, push protection and Dependabot security updates | PASS | Enabled on the repository (reported by the governance step when the token can see them) |

## Review cadence

Re-run sections A and B after any change under `src/vscode/`, `src/ui/messages.ts` or `src/ui/render.ts`, and section C
after any change to `.github/` or `scripts/`.
