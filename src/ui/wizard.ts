import {
  PRESET_CAPABILITIES, PRESET_REQUIREMENTS,
  type GeneratorOptions, type OperatingSystem, type Preset, type PresetRecommendation, type SecurityScan, type StackDetection,
} from '../core/generator.js';
import { canonicalPreset } from '../core/generation/requirements.js';
import type { TextKey } from '../i18n.js';

/** Pure parts of the generator wizard: the vscode layer only asks questions and applies the result. */
export const DEFAULT_WORKFLOW_FILE = 'orquestivo-ci.yml';
export const WORKFLOWS_DIR = '.github/workflows';
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.ya?ml$/;

export type WizardTrigger = 'push' | 'pullRequest' | 'manualDispatch';
export type WizardStep = 'lint' | 'test' | 'build';
export const WIZARD_TRIGGERS: readonly WizardTrigger[] = ['push', 'pullRequest', 'manualDispatch'];

export interface WizardChoices {
  readonly preset: Preset;
  readonly triggers: readonly WizardTrigger[];
  readonly operatingSystems: readonly OperatingSystem[];
  readonly steps: readonly WizardStep[];
  readonly securityScan: Extract<SecurityScan, 'none' | 'audit'>;
  /** Environment name of a no-op deploy placeholder job, when requested. */
  readonly deployEnvironment?: string | undefined;
}

/** Returns a message key when the file name is unusable, otherwise undefined. */
export function validateWorkflowFileName(name: string): TextKey | undefined {
  return FILE_NAME.test(name) && !name.includes('..') ? undefined : 'wizardFileNameInvalid';
}

export const workflowRelativePath = (fileName: string): string => `${WORKFLOWS_DIR}/${fileName}`;

export function availableSteps(preset: Preset): readonly WizardStep[] {
  const caps = PRESET_CAPABILITIES[canonicalPreset(preset)];
  return (['lint', 'test', 'build'] as const).filter((step) => caps[step]);
}

export const supportsAudit = (preset: Preset): boolean => PRESET_CAPABILITIES[canonicalPreset(preset)].audit;
export const supportsNonLinux = (preset: Preset): boolean => PRESET_CAPABILITIES[canonicalPreset(preset)].nonLinuxRunners;

/** Pre-selected steps: what the project scripts suggest when detected, otherwise the preset defaults. */
export function stepDefaults(preset: Preset, detected: PresetRecommendation | undefined): readonly WizardStep[] {
  const caps = PRESET_CAPABILITIES[canonicalPreset(preset)];
  const fromDetection = detected?.preset === preset ? detected.options : undefined;
  const fallback = { lint: caps.defaultLint, build: caps.defaultBuild, test: caps.test };
  return availableSteps(preset).filter((step) => fromDetection?.[step] ?? fallback[step]);
}

/** Presets ordered so detected ones come first, each with its detection reasons. */
export function orderedPresets(detection: StackDetection): ReadonlyArray<{ readonly preset: Preset; readonly label: string; readonly reasons: readonly string[] }> {
  const detected = new Map<Preset, readonly string[]>(detection.recommendations.map((r) => [r.preset, r.reasons]));
  const all = (Object.keys(PRESET_REQUIREMENTS) as Array<keyof typeof PRESET_REQUIREMENTS>)
    .map((key) => ({ preset: key as Preset, label: PRESET_REQUIREMENTS[key].label, reasons: detected.get(key) ?? [] }));
  return [...all.filter((p) => p.reasons.length > 0), ...all.filter((p) => p.reasons.length === 0)];
}

export function buildGeneratorOptions(choices: WizardChoices, detected: PresetRecommendation | undefined): GeneratorOptions {
  const inherited = detected?.preset === choices.preset ? detected.options : {};
  const stepFlags = Object.fromEntries(availableSteps(choices.preset).map((step) => [step, choices.steps.includes(step)]));
  return {
    ...inherited,
    preset: choices.preset,
    triggers: {
      push: choices.triggers.includes('push'),
      pullRequest: choices.triggers.includes('pullRequest'),
      manualDispatch: choices.triggers.includes('manualDispatch'),
    },
    operatingSystems: choices.operatingSystems,
    // Only steps the preset supports are set; the others stay undefined so the core applies its defaults.
    ...stepFlags,
    securityScan: choices.securityScan,
    ...(choices.deployEnvironment ? { deploy: { environment: choices.deployEnvironment } } : {}),
  };
}
