# Orquestivo release governance

**Do not merge a release, create tags or publish before explicit maintainer approval.**

The workflow is inspired by Probato PR's Marketplace + Open VSX release design, but Orquestivo is a different app with separate trusted-publishing registrations.

1. Complete feature, security, privacy, accessibility and i18n acceptance.
2. Commit reproducible lockfile and adopt `npm ci`; run typecheck, tests, E2E in VS Code and package smoke.
3. Review exact-head CI and analyze contents/licenses of the packaged VSIX.
4. Configure protected GitHub environments `marketplace` and `open-vsx` with approvals and branch limits.
5. Register OIDC trusted publishing for `Drako01/orquestivo` and this workflow in both registries.
6. Confirm the package version/changelog and get maintainer approval.
7. Only then run the **manual** publication workflow with `PUBLISH_ORQUESTIVO`.
8. Check actual Marketplace visibility; Open VSX may be delayed and is tracked separately. Create GitHub release with verified SHA-256.

The foundation does **not** pass these release requirements yet. Never confuse a successful workflow run with a verified storefront listing.
