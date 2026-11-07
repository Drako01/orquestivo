/** Provider-neutral shape of OBSERVED remote execution data. Never produced by static analysis. */
export interface StepEvidence {
  readonly number: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly durationMs: number | null;
}

export interface JobEvidence {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly durationMs: number | null;
  readonly htmlUrl: string | null;
  readonly steps: readonly StepEvidence[];
}

export interface ArtifactEvidence {
  readonly id: number;
  readonly name: string;
  readonly sizeBytes: number;
  readonly expired: boolean;
}

export interface RunEvidence {
  readonly runId: number;
  readonly workflowName: string;
  readonly branch: string | null;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly headSha: string;
  readonly createdAt: string;
  readonly durationMs: number | null;
  readonly htmlUrl: string;
  /** API URL to download logs (requires auth). Logs are NOT downloaded by default. */
  readonly logsUrl: string;
  readonly jobs: readonly JobEvidence[];
  readonly artifacts: readonly ArtifactEvidence[];
}

/** What a caller knows about the remote side when evaluating. `undefined` means "not requested". */
export type RemoteContext =
  | { readonly status: 'available'; readonly runs: readonly RunEvidence[] }
  | { readonly status: 'unavailable'; readonly reason: string };

export function isCompletedRun(run: RunEvidence): boolean {
  return run.status === 'completed';
}
