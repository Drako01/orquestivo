import type { RunEvidence } from '../core/evidence/run-evidence.js';
import { safeErrorMessage } from '../security/redact.js';
import { buildDisclosure, disclosureToRequest, hasConsent, type AiConsent, type Disclosure } from './consent.js';
import { guardAiText } from './guard.js';
import type { AiPayload, AiProvider, AiSuggestion } from './provider.js';

const MAX_SUGGESTIONS = 10;
const MAX_TEXT = 4000;
const ALLOWED_KEYS = new Set(['title', 'explanation', 'proposedChange']);

export type ValidationOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };
/** Injected: e.g. re-run the static analyzer on `proposedChange`. Nothing is offered without passing it. */
export type SuggestionValidator = (suggestion: AiSuggestion) => ValidationOutcome | Promise<ValidationOutcome>;

/** Offered suggestion. Always INCONCLUSIVE: advice is not evidence and can never be PASS. */
export interface OfferedSuggestion extends AiSuggestion {
  readonly verdict: 'INCONCLUSIVE';
  readonly validated: true;
}

export interface RejectedSuggestion {
  readonly reason: string;
}

export type SuggestionOutcome =
  | { readonly status: 'consent-required' }
  | { readonly status: 'provider-error'; readonly message: string; readonly disclosure: Disclosure }
  | {
      readonly status: 'completed';
      readonly disclosure: Disclosure;
      readonly offered: readonly OfferedSuggestion[];
      readonly rejected: readonly RejectedSuggestion[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;

/** Strict parse of untrusted provider output: unknown keys (e.g. verdict, status) are rejected. */
export function parseAiSuggestion(raw: unknown): AiSuggestion | RejectedSuggestion {
  if (!isRecord(raw)) return { reason: 'suggestion is not an object' };
  const extra = Object.keys(raw).find((key) => !ALLOWED_KEYS.has(key));
  if (extra !== undefined) return { reason: `unexpected property "${extra}"` };
  const { title, explanation, proposedChange } = raw;
  if (!boundedString(title) || !boundedString(explanation)) return { reason: 'title and explanation are required strings' };
  if (proposedChange !== undefined && !boundedString(proposedChange)) return { reason: 'proposedChange must be a non-empty string' };
  return proposedChange === undefined ? { title, explanation } : { title, explanation, proposedChange };
}

const isRejected = (value: AiSuggestion | RejectedSuggestion): value is RejectedSuggestion => 'reason' in value;

export interface SuggestRequest {
  readonly provider: AiProvider;
  readonly consent: AiConsent;
  readonly payload: AiPayload;
  readonly validator: SuggestionValidator;
  /** Observed remote runs; only a completed successful run lets success wording through. */
  readonly evidence?: readonly RunEvidence[];
  readonly signal?: AbortSignal;
}

export async function requestSuggestions(request: SuggestRequest): Promise<SuggestionOutcome> {
  if (!hasConsent(request.consent, request.provider.id)) return { status: 'consent-required' };
  const disclosure = buildDisclosure(request.payload);

  let raw: unknown;
  try {
    raw = await request.provider.suggest(disclosureToRequest(disclosure), request.signal);
  } catch (error) {
    return { status: 'provider-error', message: safeErrorMessage(error), disclosure };
  }

  const rejected: RejectedSuggestion[] = [];
  const offered: OfferedSuggestion[] = [];
  if (!Array.isArray(raw)) {
    return { status: 'completed', disclosure, offered, rejected: [{ reason: 'provider output is not an array' }] };
  }

  for (const item of raw.slice(0, MAX_SUGGESTIONS) as unknown[]) {
    const parsed = parseAiSuggestion(item);
    if (isRejected(parsed)) {
      rejected.push(parsed);
      continue;
    }
    const title = guardAiText(parsed.title, request.evidence);
    const explanation = guardAiText(parsed.explanation, request.evidence);
    if (title.text === '' || explanation.text === '') {
      rejected.push({ reason: 'text consisted of unverifiable success claims' });
      continue;
    }
    const cleaned: AiSuggestion =
      parsed.proposedChange === undefined
        ? { title: title.text, explanation: explanation.text }
        : { title: title.text, explanation: explanation.text, proposedChange: parsed.proposedChange };
    const outcome = await request.validator(cleaned);
    if (!outcome.ok) {
      rejected.push({ reason: `validation failed: ${outcome.reason}` });
      continue;
    }
    offered.push({ ...cleaned, verdict: 'INCONCLUSIVE', validated: true });
  }
  return { status: 'completed', disclosure, offered, rejected };
}
