import { redactWithCount } from '../security/redact.js';
import type { AiPayload, AiPayloadItem, AiRequest } from './provider.js';

/** Disabled by default; enabling is an explicit, per-provider record. */
export type AiConsent =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly providerId: string; readonly grantedAt: string };

export const AI_DISABLED: AiConsent = { enabled: false };

export function grantConsent(providerId: string, grantedAt: Date): AiConsent {
  if (providerId.trim() === '') throw new Error('providerId is required to grant AI consent');
  return { enabled: true, providerId, grantedAt: grantedAt.toISOString() };
}

export function hasConsent(consent: AiConsent, providerId: string): boolean {
  return consent.enabled && consent.providerId === providerId;
}

export interface DisclosedItem extends AiPayloadItem {
  readonly bytes: number;
  readonly redactions: number;
}

export interface Disclosure {
  readonly purpose: string;
  readonly items: readonly DisclosedItem[];
  readonly totalBytes: number;
  readonly redactionCount: number;
}

/** Lists exactly what would be sent, after redaction. */
export function buildDisclosure(payload: AiPayload): Disclosure {
  const items = payload.items.map((item): DisclosedItem => {
    const { text, count } = redactWithCount(item.text);
    return { label: item.label, text, bytes: Buffer.byteLength(text, 'utf8'), redactions: count };
  });
  return {
    purpose: payload.purpose,
    items,
    totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
    redactionCount: items.reduce((sum, i) => sum + i.redactions, 0),
  };
}

/** The request is derived from the disclosure so what the user saw is what leaves the machine. */
export function disclosureToRequest(disclosure: Disclosure): AiRequest {
  return {
    purpose: disclosure.purpose,
    items: disclosure.items.map(({ label, text }) => ({ label, text })),
  };
}
