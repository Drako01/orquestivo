const SECRET_NAME = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credential)/i;
const CURL_PIPE_SHELL = /\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:ba|z|da)?sh\b/;

export const isSecretName = (name: string): boolean => SECRET_NAME.test(name);
export const hasCurlPipeShell = (script: string): boolean => CURL_PIPE_SHELL.test(script);

/** A literal value (not a variable reference, template expression or placeholder). */
export function isLiteralValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v !== '' && !v.includes('$') && !v.startsWith('<') && !/^(?:\*+|x+|changeme)$/i.test(v);
}

/** True when a container image reference has no tag, or `latest`, and no digest. Unresolvable variables are not flagged. */
export function isUnpinnedImage(reference: string): boolean {
  const ref = reference.trim();
  if (ref === '' || ref.includes('$') || ref.includes('@sha256:')) return false;
  const lastSegment = ref.slice(ref.lastIndexOf('/') + 1);
  const colon = lastSegment.indexOf(':');
  return colon < 0 || lastSegment.slice(colon + 1).toLowerCase() === 'latest';
}

/** Parses simple human durations (`30 minutes`, `1h`, `45m`, `2 hours`) into minutes. */
export function parseDurationMinutes(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(\d+)\s*(h|hours?|m|min|minutes?)\s*$/i.exec(value);
  if (!m) return undefined;
  const amount = Number(m[1]);
  return /^h/i.test(m[2] ?? '') ? amount * 60 : amount;
}
