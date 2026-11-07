# CI generator

`src/core/generator.ts` re-exports the pure modules in `src/core/generation/`
(no `vscode` imports). `generateCI(options)` validates the options once
(`GeneratorOptionsError` with a list of `issues`) and renders workflow YAML.

Always emitted: SHA-pinned actions, `permissions: contents: read` at workflow
level, a timeout on every job, a workflow `concurrency` group, and a header
stating that static validation is not proof that CI passes.

## Presets

`node`, `typescript`, `react`, `next`, `go`, `python`, `java-maven` (`maven` is
an alias), `java-gradle`, `php`, `docker`. Marker files and "needs real
execution" notes live in `PRESET_REQUIREMENTS` (`generation/requirements.ts`),
the single source of truth for the UI. `PRESET_CAPABILITIES` defines which
options each preset accepts; anything else is rejected.

## Options

| Option | Notes |
| --- | --- |
| `trigger` / `triggers` | Legacy shortcut or `{ push, pullRequest, branches, schedule, manualDispatch }` (mutually exclusive). |
| `packageManager` | npm (default), pnpm, yarn for node/typescript/react/next. |
| `operatingSystems`, `runtimeVersions` | More than one value creates a matrix (`fail-fast: false`). |
| `lint`, `build`, `test`, `cache` | Defaults come from the preset capabilities. |
| `securityScan` | `audit` (npm/pnpm/yarn/composer), `dependency-review`, `codeql`; always a separate job. |
| `artifacts` | Upload of build output. |
| `deploy` | Environment-gated template job. |
| `sequentialJobs` | Security job `needs: verify`. |
| `actionPins` | Verified commit SHAs for actions without a built-in pin. |

Actions without a verified built-in pin (`upload-artifact`, `cache`,
`dependency-review-action`, `codeql-action`) are never guessed: the feature
fails closed with a `GeneratorOptionsError` unless the caller supplies a full
40-character SHA in `actionPins`. The Next.js `.next/cache` step is skipped
(with a header note) without `actionPins.cache`. PHP uses the runner's PHP and
Composer; Gradle wrapper validation is not added.

## Deploy template

Runs only from the configured branch (default `main`) and never on pull
requests, uses a GitHub `environment` (configure required reviewers there),
and is the only job with `id-token: write`. Its single step is a placeholder
that exits 1: replace it with your real deploy command.

## Write plan and rollback

`createWritePlan(existing | undefined, generated, path?)` (alias `planWrite`)
returns the action (`create`, `overwrite`, `unchanged`), a line diff and a
unified diff. `authorizeWrite(plan, { confirmOverwrite })` throws
`WriteRefusedError` for an unconfirmed overwrite and returns the write
operation plus the inverse `RollbackOperation` (`delete-file`,
`restore-content` or `none`). Both are data; the UI layer performs the I/O.

## Stack detection

`detectStack(rootFileNames, packageJson?)` returns recommended presets with
partial options (package manager from `packageManager` or lockfiles, scripts
mapped to lint/build/test) and warnings (several lockfiles, no lockfile,
Gradle without wrapper). Only root-level names are considered.
