# Optional AI integration

Disabled by default. This repository contains **no network code and no provider SDK**; a host
supplies an `AiProvider` implementation.

## Contracts (`src/ai`)

- `AiProvider { id, suggest(request, signal) }` returns untrusted `unknown`.
- `AiConsent`: `{enabled:false}` by default; `grantConsent(providerId, date)` records an explicit,
  per-provider grant. A different provider has no consent.
- `buildDisclosure(payload)` lists exactly what would be sent **after redaction** (labels, text,
  bytes, redaction count). The request given to the provider is derived from that disclosure
  (`disclosureToRequest`), so what the user saw is what leaves the machine.
- `requestSuggestions()` flow: consent gate -> disclosure -> provider -> strict parse -> success-claim
  guard -> injected `SuggestionValidator` -> offered.

## Hard rule: AI never produces PASS

- `AiSuggestion` has no verdict field; provider output containing unknown keys (`verdict`,
  `status`, ...) is rejected.
- Offered suggestions are always typed `verdict: 'INCONCLUSIVE'`.
- `claimsExecutionSuccess` / `guardAiText` remove sentences claiming that something works, passes
  or is verified (English and Spanish) unless a **completed, successful remote run** is supplied as
  evidence. Patterns are intentionally broad; false positives are acceptable.
- Nothing is offered unless the injected validator (for example, re-running the static analyzer on
  `proposedChange`) accepts it.
- Provider errors are returned redacted; at most 10 suggestions are considered.
