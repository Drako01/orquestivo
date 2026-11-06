import type { Disclosure } from '../ai/consent.js';
import type { Translate } from '../i18n.js';

/** Plain-text rendering of exactly what an AI provider would receive (already redacted). */
export function formatDisclosure(disclosure: Disclosure, t: Translate): string {
  const lines = [
    t('aiDisclosureHeading'), '',
    t('aiDisclosurePurpose', { purpose: disclosure.purpose }),
    t('aiDisclosureTotals', { bytes: disclosure.totalBytes, redactions: disclosure.redactionCount }), '',
  ];
  for (const item of disclosure.items) {
    lines.push(`--- ${item.label} (${t('aiDisclosureItem', { bytes: item.bytes, redactions: item.redactions })}) ---`, item.text, '');
  }
  return lines.join('\n');
}
