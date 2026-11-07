import { LimitExceededError, readStreamBounded, parseJsonBounded, assertMaxBytes } from '../../security/limits.js';
import { redactSecrets } from '../../security/redact.js';
import type {
  ArtifactEvidence,
  JobEvidence,
  RemoteContext,
  RunEvidence,
  StepEvidence,
} from './run-evidence.js';

/**
 * Opt-in, read-only GitHub Actions REST client. Network access (fetch), credentials (TokenProvider),
 * time (now/sleep) are all injected, so this module is pure and testable. Logs are never downloaded.
 */
export interface TokenProvider {
  getToken(signal?: AbortSignal): Promise<string | undefined>;
}

export interface ResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** When present it is preferred over `text()` so the size limit applies while streaming. */
  readonly body?: AsyncIterable<Uint8Array> | null;
}

export type FetchLike = (
  url: string,
  init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
) => Promise<ResponseLike>;

export type GitHubRunsErrorCode =
  | 'auth'
  | 'not-found'
  | 'rate-limited'
  | 'http'
  | 'timeout'
  | 'network'
  | 'aborted'
  | 'invalid-response'
  | 'too-large'
  | 'invalid-input';

export class GitHubRunsError extends Error {
  constructor(
    readonly code: GitHubRunsErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(redactSecrets(message));
    this.name = 'GitHubRunsError';
  }
}

export interface GitHubRunsOptions {
  readonly fetch: FetchLike;
  readonly tokens: TokenProvider;
  /** Must be https. Default `https://api.github.com`. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxPages?: number;
  readonly perPage?: number;
  readonly maxResponseBytes?: number;
  /** Longest wait honored for rate limits; beyond it the call fails with `rate-limited`. */
  readonly maxRateLimitWaitMs?: number;
  readonly backoffBaseMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

export interface RunFilter {
  readonly branch?: string;
  readonly event?: string;
  readonly status?: string;
  /** Workflow file name, e.g. `ci.yml`. */
  readonly workflowFile?: string;
}

export type RunSummary = Omit<RunEvidence, 'jobs' | 'artifacts'>;

export interface Collected<T> {
  readonly items: readonly T[];
  /** True when more data existed than the page/limit bounds allowed us to read. */
  readonly truncated: boolean;
}

const DEFAULTS = {
  baseUrl: 'https://api.github.com',
  timeoutMs: 15_000,
  maxRetries: 3,
  maxPages: 5,
  perPage: 30,
  maxResponseBytes: 2_000_000,
  maxRateLimitWaitMs: 60_000,
  backoffBaseMs: 500,
} as const;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const NAME_PART = /^[A-Za-z0-9_.-]+$/;
const TOKEN_PART = /^[a-z_]+$/;

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GitHubRunsError('aborted', 'Request aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new GitHubRunsError('aborted', 'Request aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

// ---------------------------------------------------------------- untrusted JSON narrowing

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(what: string, key: string): never {
  throw new GitHubRunsError('invalid-response', `Unexpected GitHub response: ${what}.${key} is missing or has the wrong type`);
}
const asJson = (value: unknown, what: string): Json => (isJson(value) ? value : invalid(what, '(object)'));
const reqStr = (o: Json, key: string, what: string): string => {
  const v = o[key];
  return typeof v === 'string' ? v : invalid(what, key);
};
const optStr = (o: Json, key: string): string | null => {
  const v = o[key];
  return typeof v === 'string' ? v : null;
};
const reqInt = (o: Json, key: string, what: string): number => {
  const v = o[key];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid(what, key);
};
const optBool = (o: Json, key: string): boolean => o[key] === true;

function durationMs(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, b - a);
}

function parseStep(raw: unknown): StepEvidence {
  const o = asJson(raw, 'step');
  return {
    number: reqInt(o, 'number', 'step'),
    name: reqStr(o, 'name', 'step'),
    status: reqStr(o, 'status', 'step'),
    conclusion: optStr(o, 'conclusion'),
    durationMs: durationMs(optStr(o, 'started_at'), optStr(o, 'completed_at')),
  };
}

function parseJob(raw: unknown): JobEvidence {
  const o = asJson(raw, 'job');
  const steps = o['steps'];
  return {
    id: reqInt(o, 'id', 'job'),
    name: reqStr(o, 'name', 'job'),
    status: reqStr(o, 'status', 'job'),
    conclusion: optStr(o, 'conclusion'),
    durationMs: durationMs(optStr(o, 'started_at'), optStr(o, 'completed_at')),
    htmlUrl: optStr(o, 'html_url'),
    steps: Array.isArray(steps) ? steps.map(parseStep) : [],
  };
}

function parseArtifact(raw: unknown): ArtifactEvidence {
  const o = asJson(raw, 'artifact');
  return {
    id: reqInt(o, 'id', 'artifact'),
    name: reqStr(o, 'name', 'artifact'),
    sizeBytes: reqInt(o, 'size_in_bytes', 'artifact'),
    expired: optBool(o, 'expired'),
  };
}

// ---------------------------------------------------------------- client

export class GitHubRunsClient {
  private readonly cfg: Required<Omit<GitHubRunsOptions, 'fetch' | 'tokens' | 'now' | 'sleep'>>;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private blockedUntil = 0;

  constructor(private readonly options: GitHubRunsOptions) {
    this.cfg = {
      baseUrl: (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      maxPages: options.maxPages ?? DEFAULTS.maxPages,
      perPage: Math.min(100, options.perPage ?? DEFAULTS.perPage),
      maxResponseBytes: options.maxResponseBytes ?? DEFAULTS.maxResponseBytes,
      maxRateLimitWaitMs: options.maxRateLimitWaitMs ?? DEFAULTS.maxRateLimitWaitMs,
      backoffBaseMs: options.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
    };
    if (!this.cfg.baseUrl.startsWith('https://')) {
      throw new GitHubRunsError('invalid-input', 'baseUrl must use https');
    }
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Logs are not downloaded; this is only the API URL (needs auth, redirects to storage). */
  logsUrl(repo: RepoRef, runId: number): string {
    return `${this.cfg.baseUrl}/repos/${this.repoPath(repo)}/actions/runs/${this.runIdPart(runId)}/logs`;
  }

  async listWorkflowRuns(
    repo: RepoRef,
    filter: RunFilter = {},
    opts: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  ): Promise<Collected<RunSummary>> {
    const base = `/repos/${this.repoPath(repo)}/actions`;
    const path =
      filter.workflowFile === undefined
        ? `${base}/runs`
        : `${base}/workflows/${this.namePart(filter.workflowFile, 'workflowFile')}/runs`;
    const query: Record<string, string> = {};
    if (filter.branch !== undefined) query['branch'] = filter.branch;
    if (filter.event !== undefined) query['event'] = this.tokenPart(filter.event, 'event');
    if (filter.status !== undefined) query['status'] = this.tokenPart(filter.status, 'status');
    return this.paginate(path, query, 'workflow_runs', (raw) => this.parseRun(raw, repo), opts.limit ?? 30, opts.signal);
  }

  async getRunJobs(repo: RepoRef, runId: number, signal?: AbortSignal): Promise<Collected<JobEvidence>> {
    const path = `/repos/${this.repoPath(repo)}/actions/runs/${this.runIdPart(runId)}/jobs`;
    return this.paginate(path, {}, 'jobs', parseJob, Number.MAX_SAFE_INTEGER, signal);
  }

  async getRunArtifacts(repo: RepoRef, runId: number, signal?: AbortSignal): Promise<Collected<ArtifactEvidence>> {
    const path = `/repos/${this.repoPath(repo)}/actions/runs/${this.runIdPart(runId)}/artifacts`;
    return this.paginate(path, {}, 'artifacts', parseArtifact, Number.MAX_SAFE_INTEGER, signal);
  }

  /** Full normalized evidence for one run: run + jobs/steps + artifacts. */
  async getRunEvidence(repo: RepoRef, runId: number, signal?: AbortSignal): Promise<RunEvidence> {
    const summary = this.parseRun(
      await this.request(`/repos/${this.repoPath(repo)}/actions/runs/${this.runIdPart(runId)}`, {}, signal),
      repo,
    );
    const [jobs, artifacts] = [await this.getRunJobs(repo, runId, signal), await this.getRunArtifacts(repo, runId, signal)];
    return { ...summary, jobs: jobs.items, artifacts: artifacts.items };
  }

  /** Recent runs with details, bounded by `limit` (default 10) to cap request volume. */
  async collectRunEvidence(
    repo: RepoRef,
    filter: RunFilter = {},
    opts: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  ): Promise<Collected<RunEvidence>> {
    const limit = opts.limit ?? 10;
    const listed = await this.listWorkflowRuns(repo, filter, { limit, ...(opts.signal ? { signal: opts.signal } : {}) });
    const runs: RunEvidence[] = [];
    for (const summary of listed.items) {
      const [jobs, artifacts] = [
        await this.getRunJobs(repo, summary.runId, opts.signal),
        await this.getRunArtifacts(repo, summary.runId, opts.signal),
      ];
      runs.push({ ...summary, jobs: jobs.items, artifacts: artifacts.items });
    }
    return { items: runs, truncated: listed.truncated };
  }

  // ------------------------------------------------------------ validation of caller input

  private namePart(value: string, label: string): string {
    if (!NAME_PART.test(value) || value === '.' || value === '..') {
      throw new GitHubRunsError('invalid-input', `Invalid ${label}`);
    }
    return encodeURIComponent(value);
  }
  private tokenPart(value: string, label: string): string {
    if (!TOKEN_PART.test(value)) throw new GitHubRunsError('invalid-input', `Invalid ${label}`);
    return value;
  }
  private repoPath(repo: RepoRef): string {
    return `${this.namePart(repo.owner, 'owner')}/${this.namePart(repo.repo, 'repo')}`;
  }
  private runIdPart(runId: number): string {
    if (!Number.isSafeInteger(runId) || runId < 0) throw new GitHubRunsError('invalid-input', 'Invalid runId');
    return String(runId);
  }

  // ------------------------------------------------------------ parsing

  private parseRun(raw: unknown, repo: RepoRef): RunSummary {
    const o = asJson(raw, 'run');
    const runId = reqInt(o, 'id', 'run');
    const status = reqStr(o, 'status', 'run');
    const createdAt = reqStr(o, 'created_at', 'run');
    return {
      runId,
      workflowName: optStr(o, 'name') ?? '',
      branch: optStr(o, 'head_branch'),
      event: reqStr(o, 'event', 'run'),
      status,
      conclusion: optStr(o, 'conclusion'),
      headSha: reqStr(o, 'head_sha', 'run'),
      createdAt,
      durationMs: status === 'completed' ? durationMs(optStr(o, 'run_started_at') ?? createdAt, optStr(o, 'updated_at')) : null,
      htmlUrl: reqStr(o, 'html_url', 'run'),
      logsUrl: this.logsUrl(repo, runId),
    };
  }

  // ------------------------------------------------------------ transport

  private async paginate<T>(
    path: string,
    query: Record<string, string>,
    key: string,
    parse: (raw: unknown) => T,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Collected<T>> {
    const items: T[] = [];
    let truncated = false;
    for (let page = 1; page <= this.cfg.maxPages; page += 1) {
      const body = asJson(await this.request(path, { ...query, per_page: String(this.cfg.perPage), page: String(page) }, signal), key);
      const list = body[key];
      if (!Array.isArray(list)) invalid(key, '(array)');
      for (const raw of list) items.push(parse(raw));
      if (items.length >= limit) {
        truncated = items.length > limit || list.length === this.cfg.perPage;
        return { items: items.slice(0, limit), truncated };
      }
      if (list.length < this.cfg.perPage) return { items, truncated: false };
      truncated = page === this.cfg.maxPages;
    }
    return { items, truncated };
  }

  private async request(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const token = await this.options.tokens.getToken(signal);
    if (!token) throw new GitHubRunsError('auth', 'No GitHub token available; remote evidence is opt-in and needs a token');
    const url = `${this.cfg.baseUrl}${path}?${new URLSearchParams(query).toString()}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'orquestivo',
    };

    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new GitHubRunsError('aborted', 'Request aborted');
      await this.waitForRateLimit(signal);
      // Explicit timer (not AbortSignal.timeout): it is cleared on every exit path and, unlike the
      // internal unref'd timer, keeps the event loop alive while a request is in flight.
      const timeoutController = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; timeoutController.abort(); }, this.cfg.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
      try {

        let response: ResponseLike;
        try {
          response = await this.options.fetch(url, { headers, signal: combined });
        } catch (error) {
          if (signal?.aborted) throw new GitHubRunsError('aborted', 'Request aborted');
          const code = timedOut ? 'timeout' : 'network';
          if (attempt >= this.cfg.maxRetries) {
            const detail = code === 'timeout' ? `timed out after ${this.cfg.timeoutMs}ms` : (error instanceof Error ? error.message : 'failed');
            throw new GitHubRunsError(code, `GET ${path} ${detail}`);
          }
          await this.sleep(this.backoff(attempt), signal);
          continue;
        }

        this.recordRateLimit(response);
        if (response.status >= 200 && response.status < 300) return await this.readJson(response, path);

        const limitedWait = this.rateLimitWait(response, attempt);
        if (limitedWait !== undefined) {
          if (limitedWait > this.cfg.maxRateLimitWaitMs || attempt >= this.cfg.maxRetries) {
            throw new GitHubRunsError('rate-limited', `GitHub rate limit hit on ${path}; retry in ${Math.ceil(limitedWait / 1000)}s`, response.status);
          }
          this.blockedUntil = 0; // the wait below already honors the reset window
          await this.sleep(limitedWait, signal);
          continue;
        }
        if (RETRYABLE_STATUS.has(response.status) && attempt < this.cfg.maxRetries) {
          await this.sleep(this.backoff(attempt), signal);
          continue;
        }
        throw this.statusError(response.status, path);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private statusError(status: number, path: string): GitHubRunsError {
    if (status === 401 || status === 403) return new GitHubRunsError('auth', `GitHub denied access to ${path} (HTTP ${status})`, status);
    if (status === 404) return new GitHubRunsError('not-found', `GitHub resource not found: ${path}`, status);
    return new GitHubRunsError('http', `GitHub returned HTTP ${status} for ${path}`, status);
  }

  private async readJson(response: ResponseLike, path: string): Promise<unknown> {
    try {
      if (response.body) {
        const text = await readStreamBounded(response.body, this.cfg.maxResponseBytes, 'GitHub response');
        return parseJsonBounded(text, this.cfg.maxResponseBytes);
      }
      const text = await response.text();
      assertMaxBytes(text, this.cfg.maxResponseBytes, 'GitHub response');
      return parseJsonBounded(text, this.cfg.maxResponseBytes);
    } catch (error) {
      if (error instanceof LimitExceededError) throw new GitHubRunsError('too-large', `Response for ${path} is too large`);
      throw new GitHubRunsError('invalid-response', `Response for ${path} is not valid JSON`);
    }
  }

  private backoff(attempt: number): number {
    return this.cfg.backoffBaseMs * 2 ** attempt;
  }

  private recordRateLimit(response: ResponseLike): void {
    if (response.headers.get('x-ratelimit-remaining') !== '0') return;
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) this.blockedUntil = reset * 1000;
  }

  /** Milliseconds to wait if this response is a rate-limit signal, else undefined. */
  private rateLimitWait(response: ResponseLike, attempt: number): number | undefined {
    const retryAfter = response.headers.get('retry-after');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limited = response.status === 429 || (response.status === 403 && (retryAfter !== null || remaining === '0'));
    if (!limited) return undefined;
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) return Math.max(0, date - this.now());
    }
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - this.now());
    return this.backoff(attempt);
  }

  private async waitForRateLimit(signal?: AbortSignal): Promise<void> {
    const wait = this.blockedUntil - this.now();
    if (wait <= 0) return;
    if (wait > this.cfg.maxRateLimitWaitMs) {
      throw new GitHubRunsError('rate-limited', `GitHub rate limit exhausted; retry in ${Math.ceil(wait / 1000)}s`);
    }
    await this.sleep(wait, signal);
    this.blockedUntil = 0;
  }
}

/**
 * Turns connector failures into an explicit `unavailable` context (so criteria become BLOCKED, never PASS).
 * Programming errors (non-GitHubRunsError) propagate.
 */
export async function loadRemoteContext(
  load: () => Promise<readonly RunEvidence[]>,
): Promise<RemoteContext> {
  try {
    return { status: 'available', runs: await load() };
  } catch (error) {
    if (error instanceof GitHubRunsError) return { status: 'unavailable', reason: `${error.code}: ${error.message}` };
    throw error;
  }
}
