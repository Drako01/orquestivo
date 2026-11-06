# Troubleshooting

## Analysis does nothing or says the workspace is not trusted

Analysis and generation require **Workspace Trust**. Use **Workspaces: Manage Workspace Trust** and trust the folder. In an untrusted window the extension runs in limited mode by design.

## "No pipeline files found"

- Check the path: `.github/workflows/*.yml|yaml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `Jenkinsfile`, `Jenkinsfile.*`, `*.jenkinsfile` ([PROVIDERS.md](PROVIDERS.md)).
- Files may exceed `orquestivo.analysis.maxFileBytes` (default 1 MiB) or the workspace may exceed `orquestivo.analysis.maxFiles` (default 150). Oversize files become a warning instead of being read.
- In multi-root or monorepo workspaces behavior is not yet manually verified ([COMPATIBILITY.md](COMPATIBILITY.md)).

## A finding looks wrong (false positive)

Findings are static. Check the rule metadata in [ANALYSIS.md](ANALYSIS.md) and the referenced line. Open an issue with a minimal sanitized snippet and the rule code. Included or templated content (GitLab `include`, Azure templates, Jenkins shared libraries) is not resolved, which can cause `GITLAB_EXTENDS_UNKNOWN`-style findings.

## Findings duplicate those from another YAML or GitHub Actions extension

Both sets appear in **Problems**; Orquestivo diagnostics carry the Orquestivo source and a rule code. This is expected.

## Intent verdict is INCONCLUSIVE

Many facts (branch protection, required reviewers, measured coverage, absence of secret leaks) are not in the pipeline file and cannot be proven statically. Connect GitHub for run evidence where supported, or accept that the criterion needs a manual check ([EVIDENCE.md](EVIDENCE.md)).

## Intent verdict is BLOCKED

Evidence was requested but unavailable: GitHub not connected, token expired or without access, network down, or rate limited. Reconnect, check the token's read access to Actions on that repository, and retry **Fetch runs**. BLOCKED is never shown as PASS.

## `.orquestivo/intent.json` is rejected

The parser is strict: unknown keys are errors, `percent` must be in `(0, 100]`, strings are bounded. The error lists JSON paths of the issues.

## GitHub token problems

- 401/403: token expired, revoked or lacks read access to Actions for the repository. Disconnect and connect again.
- Rate limit: the connector waits only up to a bound, then reports `rate-limited`. Retry later.
- The token is in VS Code SecretStorage. If the OS credential store is locked or unavailable (some Linux or remote setups), VS Code cannot store it; this is not verified in WSL, SSH or Dev Containers yet.

## Generator refuses an option

Options requiring actions without a verified built-in pin (for example upload-artifact, cache, CodeQL, dependency review) need a full 40-character commit SHA, otherwise generation fails closed ([GENERATOR.md](GENERATOR.md)). The target file already existing also blocks writing; nothing is overwritten.

## Undo does not remove a file

Undo reverts only what the last generation created. Files you changed afterwards or created yourself are not touched.

## AI command is unavailable

AI is disabled by default and no provider is bundled. See [AI.md](AI.md).

## Build and test problems (contributors)

- Use Node 22+ and `npm ci`.
- `npm run test:integration` downloads VS Code and needs a display (xvfb on Linux).
- `npm audit` without network reports `BLOCKED`, not a pass.
- A stale `dist-test/` is rebuilt by `npm test`. See [DEVELOPMENT.md](DEVELOPMENT.md).

Still stuck? Read [../SUPPORT.md](../SUPPORT.md) and include OS, VS Code version, extension version and a sanitized reproduction. Never paste tokens.
