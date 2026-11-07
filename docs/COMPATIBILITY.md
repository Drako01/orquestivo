# Compatibility

This page separates what CI executes from what is still manual. No environment is claimed as verified unless it was executed.

## Runtime requirements

- VS Code `^1.99.0` (`engines.vscode`); build target Node 22.
- Static analysis only: no subprocess, no network, so behavior does not depend on installed CLIs.
- Untrusted workspaces: limited (analysis requires trust). Virtual workspaces: declared supported for static analysis.

## Verified by CI

| Environment | What runs | Where |
|---|---|---|
| Linux (ubuntu-latest) | Full gate `npm run verify:enterprise`; preview VSIX installed and exercised in real VS Code under xvfb (`test:integration`) | `.github/workflows/ci.yml` |
| Windows (windows-latest) | `npm run verify:platform`: typecheck, lint, unit/contract tests, rulesets check, production build | `.github/workflows/ci.yml` |
| macOS (macos-latest) | `npm run verify:platform` | `.github/workflows/ci.yml` |

Notes: the integration host and VSIX audit run on Linux only; Windows and macOS do not run the VS Code integration suite in CI.
The developer machine for this repository is Windows, where `npm run verify:fast` is run locally. A CI result is evidence only for the commit it ran on.

## Manual verification pending

| Environment | Status | Notes |
|---|---|---|
| WSL | NOT_STARTED | Extension host in WSL; check path handling (`file://` vs `vscode-remote://`) |
| Remote SSH | NOT_STARTED | Workspace and extension run remotely; verify scan and generation |
| Dev Containers | NOT_STARTED | Verify activation and webview resources |
| Multi-root workspaces | NOT_STARTED | The generator asks for a folder when there are several; scan uses `findFiles` across folders; needs a hands-on run |
| Monorepos | NOT_STARTED | Many workflow directories; performance budgets are defined under `test/perf` once present |
| VS Code themes (light, dark, high contrast) | NOT_STARTED | Webview uses theme variables; visual check pending |
| Small windows and narrow sidebars | NOT_STARTED | Visual check pending |
| Open VSX consumers (VSCodium, Cursor, others) | NOT_STARTED | After a real Open VSX publication |

When one of these is executed, record date, commit, VS Code version, OS and result here and in `ENTERPRISE_AAAA_STATUS.md`.
Automated tests written for these environments (for example path normalization unit tests) are listed in `docs/TESTING.md` and do not replace the manual run.
