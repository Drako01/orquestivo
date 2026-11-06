# Usage guide

Orquestivo is an unreleased preview; install it from a locally built VSIX ([README](../README.md#quick-start)). Everything below assumes a **trusted** workspace. Command names follow the planned surface; if a title differs in your build, search "Orquestivo" in the Command Palette and check `contributes.commands` in `package.json`.

## 1. Analyze your pipelines

1. Open a repository containing pipeline files.
2. Run **Orquestivo: Analyze** (`orquestivo.analyze`).

Supported files:

| Provider | Files |
| --- | --- |
| GitHub Actions | `.github/workflows/*.yml`, `*.yaml` |
| GitLab CI/CD | `.gitlab-ci.yml` |
| Azure Pipelines | `azure-pipelines.yml` |
| Jenkins (declarative) | `Jenkinsfile`, `Jenkinsfile.*`, `*.jenkinsfile` |

Findings appear in **Problems**, in the Activity Bar tree and in the Control Center. Each finding has a rule code, severity, category, impact and recommendation. Limits are configurable with `orquestivo.analysis.maxFiles` (default 150) and `orquestivo.analysis.maxFileBytes` (default 1 MiB).

A clean result means supported static rules found nothing. It does not mean the pipeline runs. See [ANALYSIS.md](ANALYSIS.md) and [PROVIDERS.md](PROVIDERS.md).

## 2. Control Center

Open it from the Activity Bar icon or **Orquestivo: Open Control Center** (`orquestivo.openHome`). It shows counts, findings and the pipeline diagram. The diagram has a textual alternative for keyboard and screen-reader users.

Explanation level (planned: beginner, advanced, expert) changes how much detail each finding shows: beginner favors plain language and the "why it matters"; advanced adds the recommendation and documentation link; expert adds rule code, evidence basis and location. The level is a presentation choice and never changes what is detected.

## 3. Intent contracts

An intent contract states what the pipeline must achieve. Create `.orquestivo/intent.json`:

```json
{
  "version": 1,
  "criteria": [
    { "kind": "run-tests" },
    { "kind": "min-coverage", "percent": 80 },
    { "kind": "publish-only-from-branch", "branch": "main" },
    { "kind": "deploy-requires-approval", "environment": "production" }
  ]
}
```

Unknown keys are rejected; `percent` must be in `(0, 100]`. Criterion kinds and their exact semantics are in [EVIDENCE.md](EVIDENCE.md).

Verdicts:

| Verdict | Meaning |
| --- | --- |
| `PASS` | Evidence supports the criterion |
| `FAIL` | Evidence contradicts it |
| `WARN` | Partially met or a risk remains |
| `SKIP` | Not applicable (for example nothing publishes) |
| `INCONCLUSIVE` | Cannot be decided from available evidence (static analysis often cannot prove runtime facts) |
| `BLOCKED` | Evidence was needed but unavailable (for example GitHub unreachable) |

The overall result is `PASS` only if every criterion passes. Static `PASS` means the configuration looks right, not that it ran.

## 4. Connect GitHub run evidence (optional)

Off by default. Evidence applies to GitHub Actions only.

1. Create a fine-grained token with read-only access to Actions for the one repository.
2. Run **Orquestivo: Connect GitHub** (`orquestivo.connectGitHub`) and paste the token. It is stored in VS Code SecretStorage.
3. Run **Orquestivo: Fetch runs** (`orquestivo.fetchRuns`). Criteria such as `deploy-confirmed` can then be backed by observed runs (`remote-evidence`).
4. Run **Orquestivo: Disconnect GitHub** (`orquestivo.disconnectGitHub`) to delete the token. Also revoke it on GitHub if you no longer need it.

Logs are not downloaded. See [../PRIVACY.md](../PRIVACY.md).

## 5. Generate a CI workflow

1. Run **Orquestivo: Generate CI** (`orquestivo.generateCI`).
2. Pick a preset: `node`, `typescript`, `react`, `next`, `go`, `python`, `java-maven`, `java-gradle`, `php` or `docker`. The wizard shows which marker files were detected and which parts need real execution.
3. Choose options (triggers, package manager, matrix, lint/build/test, cache, security scan, artifacts, deploy). Options a preset does not support are rejected.
4. Review the **diff preview**. Nothing is written until you confirm, and existing files are never overwritten.
5. To revert, run **Orquestivo: Undo last generation** (`orquestivo.undoLastGeneration`).

Generated workflows use SHA-pinned actions, least-privilege permissions, job timeouts and concurrency. Some options need a verified commit SHA you provide; otherwise the wizard refuses rather than guessing. The deploy template is a placeholder that fails until you replace it. Details: [GENERATOR.md](GENERATOR.md).

## 6. Optional AI explanation

Disabled by default and Orquestivo bundles no provider. If your environment supplies one and you enable it, **Orquestivo: Explain finding with AI** (`orquestivo.ai.explainFinding`) first shows exactly what would be sent, after redaction, and asks for consent for that provider. Suggestions are hypotheses typed `INCONCLUSIVE`; re-run the analysis to check them. See [AI.md](AI.md).

## Not covered

Orquestivo does not run pipelines, does not deploy, and does not resolve GitLab `include`, Azure templates or Jenkins shared libraries. Having trouble? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
