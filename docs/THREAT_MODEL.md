# Threat model

Scope: the Orquestivo VS Code extension, its build and its distribution. Status of each decision is tracked in
`ENTERPRISE_AAAA_STATUS.md`; "Decision" below states the rule the code and releases must follow.

## Assets

- Source code and secrets in the analyzed workspace (including `.env` files and CI configuration).
- Credentials the user may later grant (GitHub, AI providers).
- The user's machine and VS Code session.
- Integrity of the published package and the publisher identity.

## Trust boundaries and actors

| Boundary | Untrusted side |
|---|---|
| Workspace content | Workflow YAML, file names, comments, `uses:` references, repository scripts |
| Remote services (future) | GitHub API responses, CI logs, run metadata |
| AI providers (future) | Model output and anything echoed from prompts |
| Supply chain | npm dependencies, GitHub Actions, build tools, registries |
| Distribution | The VSIX between build and the user |

Actors: a malicious repository author, a compromised dependency or action, a network attacker, a malicious or confused AI response, a user making a mistake.

## 1. Extension host

| Threat | Decision |
|---|---|
| Executing code from an untrusted workspace | Analysis and generation require a trusted workspace (`workspace.isTrusted`); `untrustedWorkspaces.supported = limited`. |
| Execution of repository scripts or pipeline commands | Never executed automatically. The extension spawns no subprocess today. A future execution adapter must declare the command, show the exact target, require explicit per-action consent, bound time and output, and be traceable. |
| Webview injection (XSS) | CSP `default-src 'none'` with nonce-only scripts and styles (no inline handlers), every repository-derived string HTML-escaped, restricted `localResourceRoots`, closed message schema between webview and host. |
| Resource exhaustion by huge repositories | Bounded by `maxFiles` and `maxFileBytes`, cancellable scan; parser limits tested with malformed and oversized input. |
| Command argument abuse | Internal commands that take arguments validate them (scheme, workspace containment, numeric range) before acting; covered in a real VS Code host. |
| Overwriting user files | A new file is created with `overwrite: false`; an existing file is replaced only after a diff and a modal confirmation, and the last generation can be undone. Every write target is resolved through symlinks and junctions and refused if it leaves the workspace. |

## 2. Untrusted repositories

- File content is data. YAML is parsed as data with size limits enforced by the caller; the analyzer never evaluates expressions (alias-expansion limits must be confirmed by a test before this is relied upon).
- Paths derived from repository content are never joined to the filesystem without containment checks.
- Findings quote repository text only after escaping at the output boundary (webview, diagnostics, reports).
- Secrets found in files are reported by location and rule, not echoed in full; evidence is redacted before display or export.

## 3. Remote integrations (opt-in)

| Threat | Decision |
|---|---|
| Token theft or over-scoping | Minimal scopes, tokens in VS Code `SecretStorage` only, never in settings, logs, telemetry or reports. Revocation is a first-class command. |
| SSRF / redirect abuse | The base URL must be HTTPS and the path parts are validated before use. The token is not forwarded when a redirect leaves the origin (pinned by `test/evidence/redirect-token.test.cjs`). |
| Unbounded or hanging requests | Timeouts through `AbortController`, size caps, rate limiting and backoff, cancellation propagated from the UI. |
| Untrusted API/log content | Responses validated against schemas at the boundary; logs treated as hostile text (escaped, size-capped, secret-redacted). |
| Silent data egress | The GitHub connector is the only network code; it needs the `orquestivo.remote.enabled` setting, a stored token and an explicit command. Disclosed in `PRIVACY.md`. |
| Evidence confusion | Static findings and remotely verified results are different evidence kinds and never merged into one claim. |

## 4. AI integrations (opt-in, no bundled provider)

- Disabled by default; the user sees what leaves the machine before it is sent; content is minimized and redacted first.
- Model output is untrusted: it is never executed, never applied without a preview and confirmation, and is validated by the same analyzer as hand-written workflows.
- Prompt injection from repository content cannot widen permissions: the AI path has no tool access to files, network or commands.
- Provider keys follow the token rules above; no training-data retention assumptions are made, the provider's terms are linked in the UI.

## 5. Supply chain

| Threat | Decision / control |
|---|---|
| Malicious or vulnerable dependency | Exact versions, committed `package-lock.json`, `npm ci`, `npm audit --omit=dev` in the gate (offline outage = BLOCKED, not PASS), single runtime dependency bundled by esbuild, license allowlist (`scripts/license-policy.json`). |
| Compromised action | Third-party actions pinned to full commit SHAs, `persist-credentials: false`, least-privilege `permissions`. |
| Tampered package | One VSIX built and verified once; SHA-256 recorded and re-verified by each publish job and after the GitHub Release upload; content audit blocks sources, tests, secrets and dev files (`scripts/vsix-policy.json`). |
| Stolen publish credentials | OIDC trusted publishing, no long-lived tokens by default, protected environments with the owner as required reviewer and a `main`-only deployment policy (verified on every release gate by `scripts/governance-check.mjs`), manual dispatch with explicit confirmation. |
| Unknown composition | CycloneDX SBOM generated from the lockfile for every enterprise run and attached to the release. |
| Unverifiable provenance | Build provenance attestation is not yet enabled; tracked as a roadmap item and not claimed. |

## 6. Residual risks and non-goals

- The project has a single owner, so pull request review is not independent; the compensating controls are the three required status checks, the full gate re-run on `main` before publishing, and a separate approval per registry ([docs/RELEASE.md](RELEASE.md#ownership-model)).
- Script injection detection is textual: values copied through `steps.*.outputs` or `needs.*.outputs` are not tracked.

- A user who explicitly approves a future execution adapter accepts the risk of running that command.
- The extension cannot defend against a compromised VS Code, OS or marketplace account.
- Findings are static analysis: they do not prove that a pipeline is safe at runtime.

## Review triggers

Update this document when adding a network call, a subprocess, a new provider, a new webview, secret handling, or a new publish path.
