import { canonicalPreset, isPreset, PRESET_CAPABILITIES, type PresetCapabilities } from './requirements.js';
import {
  type ActionPins, type ArtifactOptions, type CanonicalPreset, type DeployOptions, type GeneratorOptions,
  GeneratorOptionsError, type OperatingSystem, OPERATING_SYSTEMS, type OptionIssue, PACKAGE_MANAGERS,
  type PackageManager, type SecurityScan, SECURITY_SCANS,
} from './types.js';

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/*-]+$/;
const DEPLOY_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;
const PATH_PATTERN = /^[A-Za-z0-9._/*-]+$/;
const CRON_FIELD = '[0-9*/,-]+';
const CRON_PATTERN = new RegExp('^' + CRON_FIELD + '( ' + CRON_FIELD + '){4}$');
const MAX_MATRIX = 6;

export interface ResolvedTriggers {
  /** True when the compact `trigger` shortcut was used (renders the flow-style `on:`). */
  readonly legacy: boolean;
  readonly push: boolean;
  readonly pullRequest: boolean;
  readonly branches: readonly string[];
  readonly schedule?: string | undefined;
  readonly manualDispatch: boolean;
}

/** Validated, fully defaulted options. Renderers only ever see this shape. */
export interface ResolvedOptions {
  readonly preset: CanonicalPreset;
  readonly capabilities: PresetCapabilities;
  readonly triggers: ResolvedTriggers;
  readonly packageManager: PackageManager;
  readonly operatingSystems: readonly OperatingSystem[];
  readonly runtimeVersions: readonly string[];
  readonly lint: boolean;
  readonly build: boolean;
  readonly test: boolean;
  readonly cache: boolean;
  readonly securityScan: SecurityScan;
  readonly artifacts?: ArtifactOptions | undefined;
  readonly deploy?: Required<DeployOptions> | undefined;
  readonly actionPins: ActionPins;
  readonly sequentialJobs: boolean;
}

const hasDuplicates = (values: readonly string[]): boolean => new Set(values).size !== values.length;

function resolveTriggers(options: GeneratorOptions, issues: OptionIssue[]): ResolvedTriggers {
  const fail = (message: string): void => { issues.push({ field: 'triggers', message }); };
  const { trigger, triggers } = options;
  if (trigger !== undefined && triggers !== undefined) fail('Use either "trigger" or "triggers", not both.');
  if (triggers === undefined) {
    if (trigger !== undefined && trigger !== 'push-and-pr' && trigger !== 'pr-only') fail('Unknown trigger "' + String(trigger) + '".');
    const push = trigger !== 'pr-only';
    return { legacy: true, push, pullRequest: true, branches: [], manualDispatch: false };
  }
  const branches = triggers.branches ?? [];
  const resolved: ResolvedTriggers = {
    legacy: false, push: triggers.push ?? false, pullRequest: triggers.pullRequest ?? false, branches,
    schedule: triggers.schedule, manualDispatch: triggers.manualDispatch ?? false,
  };
  if (!resolved.push && !resolved.pullRequest && resolved.schedule === undefined && !resolved.manualDispatch) {
    fail('Enable at least one of push, pullRequest, schedule or manualDispatch.');
  }
  if (branches.some((b) => typeof b !== 'string' || !BRANCH_PATTERN.test(b) || b.includes('..'))) fail('Branch filters contain unsupported characters.');
  if (branches.length > 0 && !resolved.push && !resolved.pullRequest) fail('Branch filters need push or pullRequest enabled.');
  if (resolved.schedule !== undefined && !CRON_PATTERN.test(resolved.schedule)) fail('Schedule must be a five-field cron expression.');
  return resolved;
}

function resolveMatrix(options: GeneratorOptions, caps: PresetCapabilities, issues: OptionIssue[]) {
  const operatingSystems = options.operatingSystems ?? ['ubuntu'];
  const operatingSystemsIssue = (message: string): void => { issues.push({ field: 'operatingSystems', message }); };
  if (operatingSystems.length === 0) operatingSystemsIssue('Select at least one operating system.');
  if (operatingSystems.some((os) => !(OPERATING_SYSTEMS as readonly string[]).includes(os))) operatingSystemsIssue('Unknown operating system.');
  if (hasDuplicates(operatingSystems)) operatingSystemsIssue('Duplicate operating systems.');
  if (!caps.nonLinuxRunners && operatingSystems.some((os) => os !== 'ubuntu')) operatingSystemsIssue('This preset only supports ubuntu runners.');

  const requested = options.runtimeVersions;
  if (requested !== undefined && !caps.runtimeVersions) issues.push({ field: 'runtimeVersions', message: 'This preset has no runtime version to select.' });
  const runtimeVersions = requested ?? (caps.defaultVersion === undefined ? [] : [caps.defaultVersion]);
  if (requested !== undefined && requested.length === 0) issues.push({ field: 'runtimeVersions', message: 'Provide at least one version or omit the option.' });
  if (runtimeVersions.some((v) => typeof v !== 'string' || !VERSION_PATTERN.test(v))) issues.push({ field: 'runtimeVersions', message: 'Versions may only contain letters, digits, dots, underscores and dashes.' });
  if (hasDuplicates(runtimeVersions)) issues.push({ field: 'runtimeVersions', message: 'Duplicate runtime versions.' });
  if (operatingSystems.length * Math.max(runtimeVersions.length, 1) > MAX_MATRIX * MAX_MATRIX) issues.push({ field: 'operatingSystems', message: 'Matrix is too large.' });
  if (runtimeVersions.length > MAX_MATRIX) issues.push({ field: 'runtimeVersions', message: 'At most ' + MAX_MATRIX + ' versions.' });
  return { operatingSystems, runtimeVersions };
}

function checkPins(options: GeneratorOptions, preset: CanonicalPreset, caps: PresetCapabilities, issues: OptionIssue[]): void {
  const pins = options.actionPins ?? {};
  for (const [name, value] of Object.entries(pins)) {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) issues.push({ field: 'actionPins.' + name, message: 'Must be a full 40-character lowercase commit SHA.' });
  }
  const needPin = (field: string, pin: string | undefined, why: string): void => {
    if (pin === undefined) issues.push({ field, message: why + ' requires a verified commit SHA in actionPins (the generator never guesses one).' });
  };
  if (options.artifacts) needPin('actionPins.uploadArtifact', pins.uploadArtifact, 'Artifact upload');
  if (options.securityScan === 'dependency-review') needPin('actionPins.dependencyReview', pins.dependencyReview, 'Dependency review');
  if (options.securityScan === 'codeql') {
    needPin('actionPins.codeqlAction', pins.codeqlAction, 'CodeQL');
    if (caps.codeqlLanguage === undefined) issues.push({ field: 'securityScan', message: 'CodeQL has no language mapping for preset "' + preset + '".' });
  }
  if (options.securityScan === 'audit' && !caps.audit) issues.push({ field: 'securityScan', message: 'Dependency audit is not available for preset "' + preset + '".' });
}

function validateArtifactsAndDeploy(options: GeneratorOptions, triggers: ResolvedTriggers, issues: OptionIssue[]): void {
  const { artifacts, deploy } = options;
  if (artifacts) {
    const bad = typeof artifacts.path !== 'string' || !PATH_PATTERN.test(artifacts.path) || artifacts.path.startsWith('/') || artifacts.path.includes('..');
    if (bad) issues.push({ field: 'artifacts.path', message: 'Use a relative path without "..".' });
    const days = artifacts.retentionDays;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 90)) issues.push({ field: 'artifacts.retentionDays', message: 'Must be an integer from 1 to 90.' });
  }
  if (deploy) {
    if (typeof deploy.environment !== 'string' || !NAME_PATTERN.test(deploy.environment)) issues.push({ field: 'deploy.environment', message: 'Use letters, digits, dots, underscores and dashes.' });
    if (deploy.branch !== undefined && (typeof deploy.branch !== 'string' || !DEPLOY_BRANCH_PATTERN.test(deploy.branch))) issues.push({ field: 'deploy.branch', message: 'Use a literal branch name (no wildcards).' });
    if (!triggers.push && !triggers.manualDispatch) issues.push({ field: 'deploy', message: 'A deploy job needs push or manualDispatch enabled.' });
  }
}

/** Validates the options once at the boundary and applies defaults. Throws GeneratorOptionsError. */
export function resolveOptions(options: GeneratorOptions): ResolvedOptions {
  const issues: OptionIssue[] = [];
  if (!isPreset(options.preset)) throw new GeneratorOptionsError([{ field: 'preset', message: 'Unknown preset "' + String(options.preset) + '".' }]);
  const preset = canonicalPreset(options.preset);
  const caps = PRESET_CAPABILITIES[preset];

  const triggers = resolveTriggers(options, issues);
  const { operatingSystems, runtimeVersions } = resolveMatrix(options, caps, issues);

  if (options.packageManager !== undefined) {
    if (!(PACKAGE_MANAGERS as readonly string[]).includes(options.packageManager)) issues.push({ field: 'packageManager', message: 'Unknown package manager.' });
    else if (!caps.packageManagers) issues.push({ field: 'packageManager', message: 'Package managers apply to node, typescript, react and next only.' });
  }
  if (options.securityScan !== undefined && !(SECURITY_SCANS as readonly string[]).includes(options.securityScan)) issues.push({ field: 'securityScan', message: 'Unknown security scan.' });
  for (const step of ['lint', 'build', 'test'] as const) {
    if (options[step] === true && !caps[step]) issues.push({ field: step, message: 'Preset "' + preset + '" has no ' + step + ' step.' });
  }
  const lint = options.lint ?? caps.defaultLint;
  const build = options.build ?? caps.defaultBuild;
  const test = options.test ?? caps.test;
  if (!lint && !build && !test) issues.push({ field: 'test', message: 'Enable at least one of lint, build or test.' });

  const securityScan = options.securityScan ?? 'none';
  checkPins(options, preset, caps, issues);
  if (securityScan === 'dependency-review' && !triggers.pullRequest) issues.push({ field: 'securityScan', message: 'Dependency review runs on pull requests; enable pullRequest.' });
  validateArtifactsAndDeploy(options, triggers, issues);

  if (issues.length > 0) throw new GeneratorOptionsError(issues);
  return {
    preset, capabilities: caps, triggers, packageManager: options.packageManager ?? 'npm',
    operatingSystems, runtimeVersions, lint, build, test, cache: options.cache ?? caps.defaultCache,
    securityScan, artifacts: options.artifacts,
    deploy: options.deploy && { environment: options.deploy.environment, branch: options.deploy.branch ?? 'main' },
    actionPins: options.actionPins ?? {}, sequentialJobs: options.sequentialJobs ?? false,
  };
}
