/** Public option and result types of the CI generator. Pure: no vscode, no I/O. */
export const PRESETS = [
  'node', 'typescript', 'react', 'next', 'go', 'python',
  'maven', 'java-maven', 'java-gradle', 'php', 'docker',
] as const;
export type Preset = typeof PRESETS[number];
/** `maven` is kept as a backward compatible alias of `java-maven`. */
export type CanonicalPreset = Exclude<Preset, 'maven'>;

export type Trigger = 'push-and-pr' | 'pr-only';
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
export type PackageManager = typeof PACKAGE_MANAGERS[number];
export const OPERATING_SYSTEMS = ['ubuntu', 'windows', 'macos'] as const;
export type OperatingSystem = typeof OPERATING_SYSTEMS[number];
export const SECURITY_SCANS = ['none', 'audit', 'dependency-review', 'codeql'] as const;
export type SecurityScan = typeof SECURITY_SCANS[number];

export interface TriggerOptions {
  readonly push?: boolean;
  readonly pullRequest?: boolean;
  /** Branch filters applied to push and pull_request. */
  readonly branches?: readonly string[];
  /** Five-field cron expression (UTC). */
  readonly schedule?: string;
  readonly manualDispatch?: boolean;
}

export interface ArtifactOptions {
  readonly path: string;
  readonly retentionDays?: number;
}

export interface DeployOptions {
  readonly environment: string;
  /** Only this branch may reach the deploy job. Defaults to `main`. */
  readonly branch?: string;
}

/**
 * Full commit SHAs for actions this tool has no verified pin for. The caller
 * supplies them; the generator never invents one and fails closed without it.
 */
export interface ActionPins {
  readonly uploadArtifact?: string;
  readonly cache?: string;
  readonly dependencyReview?: string;
  readonly codeqlAction?: string;
}

export interface GeneratorOptions {
  readonly preset: Preset;
  /** Legacy shortcut. Mutually exclusive with `triggers`. Defaults to push-and-pr. */
  readonly trigger?: Trigger;
  readonly triggers?: TriggerOptions;
  /** node/typescript/react/next only. Defaults to npm. */
  readonly packageManager?: PackageManager;
  readonly operatingSystems?: readonly OperatingSystem[];
  /** Runtime versions (Node, Go, Python, Java). More than one creates a matrix. */
  readonly runtimeVersions?: readonly string[];
  readonly lint?: boolean;
  readonly build?: boolean;
  readonly test?: boolean;
  readonly cache?: boolean;
  readonly securityScan?: SecurityScan;
  readonly artifacts?: ArtifactOptions;
  readonly deploy?: DeployOptions;
  readonly actionPins?: ActionPins;
  /** When true the security job waits for the verify job (`needs`). */
  readonly sequentialJobs?: boolean;
}

export interface OptionIssue { readonly field: string; readonly message: string; }

/** Thrown at the boundary when generator options are invalid or contradictory. */
export class GeneratorOptionsError extends Error {
  readonly issues: readonly OptionIssue[];
  constructor(issues: readonly OptionIssue[]) {
    super('Invalid generator options: ' + issues.map((i) => i.field + ': ' + i.message).join('; '));
    this.name = 'GeneratorOptionsError';
    this.issues = issues;
  }
}
