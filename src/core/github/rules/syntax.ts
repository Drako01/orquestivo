import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

/** Engine-level findings emitted before (or instead of) the rule pipeline. */
export const YAML_INVALID = meta('YAML_INVALID', 'error', 'syntax',
  'The file cannot be parsed, so GitHub will reject the workflow and no other check can run.',
  'Fix the YAML syntax error at the reported line.', DOCS.syntax);
export const WORKFLOW_ROOT_INVALID = meta('WORKFLOW_ROOT_INVALID', 'error', 'syntax',
  'A workflow file must be a YAML mapping with keys such as on and jobs.',
  'Make the document a mapping with name, on and jobs.', DOCS.syntax);
export const YAML_TOO_LARGE = meta('YAML_TOO_LARGE', 'error', 'syntax',
  'Oversized inputs are not analysed to keep the editor responsive.',
  'Split the workflow into reusable workflows or smaller files.', DOCS.reusable);
export const ANALYZER_INTERNAL_ERROR = meta('ANALYZER_INTERNAL_ERROR', 'warning', 'maintainability',
  'A rule failed unexpectedly, so its results are missing; the other rules still ran.',
  'Report this workflow to the Orquestivo maintainers so the rule can be fixed.');

export const ENGINE_METAS = [YAML_INVALID, WORKFLOW_ROOT_INVALID, YAML_TOO_LARGE, ANALYZER_INTERNAL_ERROR] as const;
