/** Bounded-read helpers: untrusted input never gets to allocate unbounded memory. */
export class LimitExceededError extends Error {
  constructor(
    readonly what: string,
    readonly limit: number,
  ) {
    super(`${what} exceeds the limit of ${limit} bytes`);
    this.name = 'LimitExceededError';
  }
}

export function assertMaxBytes(text: string, maxBytes: number, what: string): void {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new LimitExceededError(what, maxBytes);
}

/** Reads a byte stream, aborting as soon as `maxBytes` is crossed. */
export async function readStreamBounded(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
  what = 'stream',
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new LimitExceededError(what, maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Parses JSON from untrusted text after a size check; result is `unknown` and must be narrowed. */
export function parseJsonBounded(text: string, maxBytes: number, what = 'JSON document'): unknown {
  assertMaxBytes(text, maxBytes, what);
  return JSON.parse(text) as unknown;
}

export function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}
