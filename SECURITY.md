# Security Policy

Workflow source, filenames, third-party actions, future CI logs and AI responses are untrusted.

Current MVP foundation is local and read-only: no subprocess execution, external requests, telemetry, package installation or credential storage. Scans require a trusted workspace and enforce size/count bounds. The webview has a restrictive CSP, no scripts and escapes repository strings.

Any future execution adapter must declare commands, show exact targets and require permission. Token scopes must be minimal, stored in VS Code SecretStorage, and never written to logs. Keep evidence of execution distinct from static findings.

Report vulnerabilities privately using GitHub Security Advisories or https://armotusitio.com.ar/soporte/. Do not share secret values publicly.

## Supply chain and releases

Releases are manual, built once and published as the same SHA-256-verified VSIX to every registry; publishing uses OIDC trusted publishing through protected environments, and actions are pinned to commit SHAs. Each enterprise verification generates a CycloneDX SBOM, a production license audit and a package content audit. See `docs/RELEASE.md`, `docs/THREAT_MODEL.md` and `docs/SECURITY_AUDIT.md`.
