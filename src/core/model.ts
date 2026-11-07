/** Provider-neutral pipeline model. Every CI provider maps its dialect onto this shape. */
export interface TriggerModel {
  readonly event: string; // e.g. push, pull_request, schedule, workflow_dispatch / provider equivalent
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
  readonly types?: readonly string[];
}
export interface StepModel {
  readonly index: number;
  readonly line: number;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly condition?: string;
}
export interface JobModel {
  readonly id: string;
  readonly line: number;
  readonly name?: string;
  readonly needs: readonly string[];
  readonly runsOn: readonly string[];
  readonly uses?: string; // reusable workflow / template reference
  readonly environment?: string;
  readonly condition?: string;
  readonly timeoutMinutes?: number;
  readonly permissions?: 'read-all' | 'write-all' | Readonly<Record<string, string>>;
  readonly matrix?: Readonly<Record<string, readonly unknown[]>>;
  readonly steps: readonly StepModel[];
}
export interface PipelineModel {
  readonly provider: string;
  readonly name?: string;
  readonly triggers: readonly TriggerModel[];
  readonly permissions?: 'read-all' | 'write-all' | Readonly<Record<string, string>>;
  readonly hasConcurrency: boolean;
  readonly jobs: readonly JobModel[];
}
