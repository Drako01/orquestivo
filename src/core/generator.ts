/** Auditable, read-only CI templates. They do not deploy software or prove success. */
import { resolveOptions } from './generation/options.js';
import { renderWorkflow } from './generation/render.js';
import type { GeneratorOptions } from './generation/types.js';

export * from './generation/types.js';
export { PINNED_ACTIONS } from './generation/actions.js';
export { missingMarkers, PRESET_CAPABILITIES, PRESET_REQUIREMENTS, type PresetCapabilities, type PresetRequirement } from './generation/requirements.js';
export { detectStack, type PresetRecommendation, type StackDetection } from './generation/detect.js';
export {
  authorizeWrite, createRollback, createWritePlan, DEFAULT_WORKFLOW_PATH, planWrite, WriteRefusedError,
  type AuthorizedWrite, type DiffLine, type RollbackOperation, type WriteOperation, type WritePlan,
} from './generation/write-plan.js';

/** Validates the options (throws GeneratorOptionsError) and renders the workflow YAML. */
export function generateCI(options: GeneratorOptions): string {
  return renderWorkflow(resolveOptions(options));
}
