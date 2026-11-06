# Enterprise AAAA status

Statuses: `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `WARN`, `SKIP`, `INCONCLUSIVE`, `BLOCKED`.
Rule: code written is `IN_PROGRESS`. A phase becomes `PASS` only when the Evidence section links a real, current result.
Plan and criteria: `PLAN_ENTERPRISE_AAAA.md`.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repository audit | IN_PROGRESS | Plan and status created; audit results pending evidence |
| 1 | Enterprise architecture | IN_PROGRESS | Provider-neutral model, findings and provider contracts defined in `src/core`; consumers still migrating |
| 2 | Advanced analysis engine | IN_PROGRESS | Rule expansion and corpus tests in progress |
| 3 | Pipeline design and generation | IN_PROGRESS | Detection and write plan in progress |
| 4 | Intent and evidence | IN_PROGRESS | Evidence and verdict modules in progress |
| 5 | Control Center UX/UI | IN_PROGRESS | Not yet verified in the integration host |
| 6 | i18n and accessibility | IN_PROGRESS | Parity and a11y checks pending |
| 7 | Security | IN_PROGRESS | `docs/THREAT_MODEL.md` and `docs/SECURITY_AUDIT.md` written; implementation items open |
| 8 | Quality gates | IN_PROGRESS | `verify-enterprise`, coverage, mutation, SBOM, license and VSIX audits implemented; no full run recorded yet |
| 9 | Environments and compatibility | IN_PROGRESS | CI covers three OS; WSL, SSH, Dev Containers, multi-root are manual pending (see `docs/COMPATIBILITY.md`) |
| 10 | Advanced integrations | NOT_STARTED | No remote integration is implemented |
| 11 | Documentation and onboarding | IN_PROGRESS | Docs under review against shipped behavior |
| 12 | Release engineering | IN_PROGRESS | Workflows hardened in code, never executed; `private: true` kept until owner approval; no publication performed |

## Release blockers known by construction

- `package.json` has `"private": true`; `publish.yml` fails at `authorize` while it is present. The owner removes it in the approved release commit.
- GitHub Environments `marketplace`, `open-vsx`, `github-release` and the OIDC trusted-publisher registrations are owner-side settings, not verified from the repository.
- No publication, tag or merge has been performed.

## Evidence

_To be completed by the lead with real results. Each entry: command, commit, date, result, link to the report or log._

| Item | Command | Commit | Result | Report |
|---|---|---|---|---|
| Fast gate | `npm run verify:fast` | | | |
| Full enterprise gate | `npm run verify:enterprise` | | | `reports/verify-enterprise.md` |
| Coverage vs thresholds | `npm run test:coverage` | | | `reports/coverage/summary.json` |
| Mutation testing | `npm run mutation` | | | `reports/mutation.json` |
| VSIX audit and SHA-256 | `npm run audit:vsix` | | | |
| SBOM and licenses | `npm run sbom`, `npm run audit:licenses` | | | |
| Integration host | `npm run test:integration` | | | |
| CI on exact head | GitHub Actions run | | | |

## Reused evidence log

_`PASS_REUSED` entries must cite the original run and show unchanged inputs (`inputsHash` in the JSON report)._
