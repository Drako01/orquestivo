/** Optional AI integration contracts. No network code and no provider SDK live in this repository. */
export interface AiPayloadItem {
  readonly label: string;
  readonly text: string;
}

export interface AiPayload {
  readonly purpose: string;
  readonly items: readonly AiPayloadItem[];
}

/** Exactly what is handed to a provider: the redacted, disclosed items and nothing else. */
export interface AiRequest {
  readonly purpose: string;
  readonly items: readonly AiPayloadItem[];
}

/** A suggestion carries no verdict field by design: AI output is advice, never evidence. */
export interface AiSuggestion {
  readonly title: string;
  readonly explanation: string;
  readonly proposedChange?: string;
}

export interface AiProvider {
  readonly id: string;
  /** Returns UNTRUSTED data; it is parsed and validated before anything is offered. */
  suggest(request: AiRequest, signal?: AbortSignal): Promise<unknown>;
}
