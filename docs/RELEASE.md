# Orquestivo release governance

**Do not merge a release, create tags or publish before explicit maintainer approval.** Nothing in this repository publishes automatically.

The pipeline follows the Marketplace + Open VSX design used for Probato PR, with separate trusted-publishing registrations for Orquestivo.

## Principles

- Triggers: `.github/workflows/publish.yml` runs on a push to `main` (it publishes only when `package.json` holds a version with no GitHub Release yet) or on a manual `workflow_dispatch` (recovery). No PR, tag or schedule triggers. Each registry job still waits for approval on its protected Environment.
- Confirmation: a manual dispatch needs `confirmation = PUBLISH_ORQUESTIVO`, the exact `version`, and must run from `main`. A push to `main` relies on the Environment reviewers as the human gate.
- One artifact: a single VSIX is built and verified once (`package` job), uploaded as artifact `vsix`, and both registries and the GitHub Release receive that same file. Every consumer re-checks its SHA-256 against the value produced by the `package` job.
- Least privilege: workflow-level `permissions: {}`; each job declares only what it needs. `id-token: write` exists only in the two publish jobs, `contents: write` only in `release`.
- Protected environments gate every side effect: `marketplace`, `open-vsx`, `github-release`.
- No long-lived registry tokens in the workflow. Publishing uses OIDC trusted publishing (`vsce publish --oidc`, `ovsx publish --trusted-publishing`). If a registry does not support OIDC for this publisher, the fallback is a token stored as an **environment** secret (never repository-wide), added deliberately in a reviewed change.
- Third-party actions are pinned to full commit SHAs; do not change a pin without verifying the new SHA upstream.

## `private: true` in `package.json`

The flag was removed in the `0.1.1` release commit. `publish.yml` still fails in `authorize` if it is ever present again, so a private package can never be published by accident.

## One-time owner setup (not verifiable from the repository)

1. Environments `marketplace`, `open-vsx`, `github-release`: required reviewers, deployment branches limited to `main`, no self-review.
2. Register OIDC trusted publishing for `Drako01/orquestivo`, workflow `publish.yml`, and the matching environment, in both registries. The Open VSX namespace must exist.
3. Apply the rulesets in `.github/rulesets` (`npm run rulesets:check` validates them offline, `rulesets:status` reads the live state).

## Release checklist

1. Feature, security, privacy, accessibility and i18n acceptance complete (`ENTERPRISE_AAAA_STATUS.md`).
2. Version bumped (SemVer) and `CHANGELOG.md` has a `## [x.y.z]` entry.
3. `npm run verify:release` is green locally or in CI on the exact head: typecheck, lint, tests, rulesets, coverage thresholds, mutation floor, performance budgets, production build, VSIX package + content audit + SHA-256, SBOM, license audit, `npm audit`. `BLOCKED` or `INCONCLUSIVE` is not a pass.
4. CI is green on the exact head for Linux, Windows and macOS, and the preview VSIX was exercised in a real VS Code.
5. Maintainer approval recorded; `"private": true` removed in the release commit; merged to `main` by the owner.
6. Merging to `main` starts **publish** by itself; approve the `marketplace`, `open-vsx` and `github-release` Environments when prompted. To recover a partial publish, use `Actions > publish > Run workflow`: `confirmation`, `version`, a single `registries` value and the `vsix_run_id` of the earlier run.
7. Approve the `marketplace` and `open-vsx` deployments.
8. Check actual visibility: the workflow polls the Marketplace gallery (`scripts/check-marketplace.mjs`); Open VSX activation can lag and is reported separately. A green workflow is not proof of a live listing; open both listings.
9. The `release` job creates tag `vX.Y.Z` and the GitHub Release with the VSIX, its `.sha256`, the SBOM and the verification report, then downloads the released asset and re-verifies the checksum.

## Post-publish verification

- Marketplace: `check-marketplace.mjs` fails the job if the version is not visible within its polling window.
- Open VSX: `open-vsx-publish.mjs` polls the registry API; if the version is not active it emits a warning, so confirm manually.
- GitHub Release: asset downloaded back and compared with the SHA-256 of the verified VSIX.
- Users can verify a download with `node scripts/vsix-checksum.mjs check orquestivo.vsix` next to the `.sha256` file (or `sha256sum -c`).

## Partial publish recovery

The two registries are independent jobs, so one can succeed while the other fails. The GitHub Release is created only when every requested registry succeeded.

1. Do not delete or re-version what was already published (registry versions are immutable).
2. Note the run id of the failed run (it holds the `vsix` artifact, retention 90 days).
3. Re-dispatch with `registries` set to the failed registry only and `vsix_run_id` set to that run id. The workflow downloads the original VSIX, re-audits it and re-checks its SHA-256 instead of rebuilding, so both registries end up with byte-identical packages.
4. `--skip-duplicate` makes a repeated Marketplace publish idempotent; the Open VSX script tolerates "already published".
5. When the retry succeeds, the `release` job creates the GitHub Release (it only requires at least one successful registry and no failed one).
6. If the defect is in the package itself, publish a new patch version through the full process.

## Rollback

Registry versions cannot be overwritten. Unpublish or deprecate in the registry UI if needed, then ship a fixed patch version. Mark the GitHub Release as pre-release or edit its notes; tags are protected by `protect-release-tags.json` and must not be moved.

## Local dry run (no publication)

```text
npm ci
npm run verify:release     # full strict gate, produces orquestivo.vsix and reports/
npm run audit:vsix
```

Provenance attestations (build provenance for the VSIX) are not enabled yet; adding them requires pinning a verified action SHA and is tracked in the roadmap.
