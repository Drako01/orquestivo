# Security audit checklist

Result column uses the project status vocabulary. "Verified" means confirmed by reading `src/extension.ts` at the time of writing
(re-verify after changes); items needing tests or runtime proof stay `IN_PROGRESS` or `INCONCLUSIVE` until evidence is linked.
Threat decisions: `docs/THREAT_MODEL.md`.

## A. Findings verified in `src/extension.ts`

| ID | Check | Result | Evidence / finding |
|---|---|---|---|
| E-01 | No network access | PASS | No `fetch`, `http`, `https` or `openExternal` usage in the file |
| E-02 | No subprocess or command execution | PASS | No `child_process` or `exec` usage; commands registered are UI actions only |
| E-03 | No secrets or persistent state handling | PASS | No `SecretStorage`, `globalState` or `process.env` use |
| E-04 | Workspace Trust enforced before scan and generation | PASS | `scan()` and `generate()` return with a warning when `!vscode.workspace.isTrusted` |
| E-05 | Scan is bounded and cancellable | PASS | `maxFiles` / `maxFileBytes` settings, cancellation token checked per file; oversize file becomes a `FILE_LIMIT` warning |
| E-06 | Webview scripts disabled | PASS | `enableScripts: false` |
| E-07 | Webview CSP | PASS | `default-src 'none'; img-src <cspSource>; style-src 'nonce-...'`, nonce from `randomBytes(16)` |
| E-08 | Repository strings escaped in webview | PASS | `code`, `message`, `path` and logo URI go through `htmlEscape`; counters are numeric |
| E-09 | File generation cannot overwrite | PASS | Existing target is rejected (`alreadyExists`); `createFile(..., { overwrite: false })`; modal confirmation after preview |
| E-10 | Generated workflow validated before offering it | PASS | `analyzeWorkflow(generated)` must have no `error` finding |
| E-11 | Webview `localResourceRoots` restricted | WARN | Not set in `createWebviewPanel`; defaults allow workspace folders in addition to the extension. Restrict to `media/` |
| E-12 | `orquestivo.openFinding` argument validation | WARN | Accepts any `uri` string and `line` from the caller (`Uri.parse(uri)`), no scheme or workspace containment check. Impact is limited to opening a document, but validate before relying on it |
| E-13 | Errors not swallowed silently | WARN | The read/analyze `catch {}` converts any error into a generic `FILE_READ` warning and drops the cause; log the error class to an output channel without paths or content |
| E-14 | User-facing copy fully localized | WARN | The "scanned N of M" message, QuickPick labels, tree tooltip title and panel title are hardcoded English |
| E-15 | Configuration values validated | WARN | `maxFiles` and `maxFileBytes` are read with `get<number>`; clamp to sane integer ranges at the boundary |
| E-16 | Untrusted workspace declaration consistent | INCONCLUSIVE | `package.json` declares `untrustedWorkspaces: limited` and the code refuses analysis; confirm in the integration host that no command stays enabled in restricted mode |

## B. Checklist requiring tests or other files (not verified by this document)

| ID | Check | Result |
|---|---|---|
| C-01 | Parser limits for oversized, deeply nested and alias-heavy YAML | IN_PROGRESS |
| C-02 | Secret redaction in findings, diagnostics and exported reports | IN_PROGRESS |
| C-03 | Path containment for any path derived from repository content | IN_PROGRESS |
| C-04 | Malformed-input and corpus tests do not crash the analyzer | IN_PROGRESS |
| C-05 | i18n key parity EN/ES | IN_PROGRESS |
| C-06 | Webview keyboard and screen-reader behavior | NOT_STARTED |

## D. Supply chain and release

| ID | Check | Result | Evidence |
|---|---|---|---|
| S-01 | Lockfile committed, `npm ci` in CI | IN_PROGRESS | Workflows use `npm ci`; link CI run |
| S-02 | Production dependency audit | INCONCLUSIVE | `scripts/audit-deps.mjs`; needs network, reports BLOCKED when unreachable |
| S-03 | License allowlist for production dependencies | IN_PROGRESS | `scripts/license-audit.mjs`; link a run |
| S-04 | SBOM generated | IN_PROGRESS | `scripts/sbom.mjs` |
| S-05 | Actions pinned by SHA, minimal permissions | IN_PROGRESS | `ci.yml`, `publish.yml`; verify with the project's own analyzer |
| S-06 | VSIX content policy and secret scan | IN_PROGRESS | `scripts/vsix-audit.mjs`, `scripts/vsix-policy.json` |
| S-07 | Same VSIX for both registries, SHA-256 verified | IN_PROGRESS | `publish.yml`; never executed |
| S-08 | OIDC publishing and protected environments configured | NOT_STARTED | Owner-side settings, not verifiable from the repository |

## Review cadence

Re-run section A after any change to `src/extension.ts`; update section B/D from the lead's evidence table in `ENTERPRISE_AAAA_STATUS.md`.
