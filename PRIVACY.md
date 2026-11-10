# Privacy Policy

Orquestivo is local-first. This document describes the behavior of Orquestivo as implemented in this repository.

## Default behavior (nothing configured)

- Reads pipeline files (GitHub Actions, GitLab CI, Azure Pipelines, Jenkinsfile) and `.orquestivo/intent.json` in **trusted** workspaces, with size and count limits.
- Keeps diagnostics in memory. Does not execute pipeline commands, does not read `.env` or secret files, and does not collect **telemetry** or usage metrics.
- Makes **no network requests**.
- Writes files only when you confirm a generation after a diff preview. The last generation can be undone.

## GitHub run evidence (opt-in)

- Disabled until you run **Orquestivo: Connect GitHub**.
- The token you provide is stored in VS Code **SecretStorage** (the operating system credential store behind VS Code), not in settings, files, logs or workspace state. **Disconnect GitHub** deletes it.
- Once connected, **Fetch runs** sends read-only requests to the GitHub API for the repository you choose. Requests carry the token; response bodies are not logged and error messages are redacted. Workflow run logs are not downloaded.
- Use a fine-grained token with the minimum read access to Actions for the specific repository. Revoke it on GitHub if you stop using the feature.
- If GitHub is unreachable, results are `BLOCKED`, not guessed.

## AI (off by default)

- Disabled by default. The repository contains **no AI provider and no network code for AI**; a provider must be supplied by the host and enabled by you.
- Consent is explicit and per provider. Before anything is sent you see a disclosure of exactly what would leave your machine, **after redaction** (tokens, keys, credentials in URLs and similar patterns). What you saw is what is sent.
- AI output is untrusted, validated, and never marked as proof or `PASS`.
- Revoke consent at any time; a different provider has no consent.

## What is never collected

Source code and pipeline contents (except what you explicitly approve for AI), file paths, secrets, personal data and analytics.

## Your data

All state is on your machine. There is no Orquestivo server. Third parties (GitHub, an AI provider you enable) apply their own privacy policies to data you choose to send them.

Contact and vulnerability reporting: see [SECURITY.md](SECURITY.md) and [SUPPORT.md](SUPPORT.md). Technical detail: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/EVIDENCE.md](docs/EVIDENCE.md), [docs/AI.md](docs/AI.md).

> The exact SecretStorage key name, setting names for AI and consent UI were implemented by a parallel change; cross-check `src/extension.ts` before release.
