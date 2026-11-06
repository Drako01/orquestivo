# GitHub Rulesets — Orquestivo

Source of truth: `.github/rulesets/protect-main.json` and `.github/rulesets/protect-release-tags.json`.

These definitions mirror the **actual active rulesets** read from `Drako01/probato-pr` and `Drako01/indizivo` on November 5, 2026.

## Protection model

| Protection | Orquestivo policy |
| --- | --- |
| Default branch | `Protect main`, active, targets `~DEFAULT_BRANCH` |
| PR process | Requires one approval, fresh reviews after new pushes, CODEOWNERS review, approval of the latest push and resolved conversations |
| Merge strategy | Squash only; linear history; block deletion and force pushes |
| CI required | `Verify (ubuntu-latest)`, `Verify (windows-latest)`, `Verify (macos-latest)`; GitHub Actions App ID `15368` |
| Administrator bypass | **Only through a PR**, matching both reference repos |
| Release tags | `Protect release tags`, active for `refs/tags/v*`; block update, deletion and non-fast-forward |
| Tag bypass | Repository administrator may bypass, matching both reference repos |

`indizivo` does not require status checks in its current `Protect main` ruleset; `probato-pr` requires the three platform checks. We use the **Probato PR** variant because Orquestivo already has the same CI job names.

## Versioned files are not GitHub settings

**GitHub does not activate a ruleset merely because its JSON exists in the repository.** The GitHub integration for this chat currently offers read-only ruleset access; it cannot create or update rulesets using GitHub's Administration:write endpoints.

## Validate without changing settings

```bash
npm ci
npm run rulesets:check
npm run rulesets:status  # requires GH_TOKEN with ruleset administration permissions
```

`rulesets:check` validates versioned definitions offline. `rulesets:status` requires `GH_TOKEN` and compares with the live repository; GitHub omits `bypass_actors` in anonymous responses, which previously caused a false DRIFT. The status checker fails closed when it cannot fully verify permissions.

## Current status

Both `Protect main` and `Protect release tags` were installed and activated on November 5, 2026. Their complete authenticated GitHub API configurations matched the versioned JSON definitions. Re-run `--status` with administrator credentials to check subsequent changes.

## Apply through an authorized local administrator session

Acquire a fine-grained GitHub token scoped **only** to `Drako01/orquestivo` with **Administration: Read and write**. Store it securely as an ephemeral `GH_TOKEN` environment variable in your terminal; **do not commit it or share it in chat**.

```bash
node scripts/rulesets.mjs --apply --confirm=Drako01/orquestivo
npm run rulesets:status  # keep GH_TOKEN set through this command
```

The script creates missing rulesets, updates matching-name rulesets that drifted, never deletes other rulesets, and does not log token values. An explicit `--apply` and matching repository confirmation are required.

Alternative: configure both rulesets in [GitHub Settings → Rulesets](https://github.com/Drako01/orquestivo/settings/rules) using the committed JSON as the authoritative checklist.

### Solo-maintainer consideration

`.github/CODEOWNERS` identifies `@Drako01` as the owner of all files, matching the existing products. GitHub does not count an author's own approval. The repository-admin **PR-only bypass** allows the maintainer to merge a reviewed PR through the visible bypass workflow when there is no independent reviewer. Do not weaken the entire ruleset to accommodate that case.

### Release caveat

The release workflow creates tags `v*`. Test how tag ruleset permissions affect the designated release identity before public publication. Do not assume GitHub Actions' default token can bypass tag protection, even if an administrator can bypass it manually.

GitHub reference: [Creating repository rulesets](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset).
