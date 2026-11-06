# Security Policy

Workflow source, filenames, third-party actions, future CI logs and AI responses are untrusted.

Current MVP foundation is local and read-only: no subprocess execution, external requests, telemetry, package installation or credential storage. Scans require a trusted workspace and enforce size/count bounds. The webview has a restrictive CSP, no scripts and escapes repository strings.

Any future execution adapter must declare commands, show exact targets and require permission. Token scopes must be minimal, stored in VS Code SecretStorage, and never written to logs. Keep evidence of execution distinct from static findings.

Report vulnerabilities privately using GitHub Security Advisories or https://armotusitio.com.ar/soporte/. Do not share secret values publicly.
