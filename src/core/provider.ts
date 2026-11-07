import type { Analysis } from './types.js';
import type { PipelineModel } from './model.js';

/** Contract implemented by every CI/CD dialect (GitHub Actions, GitLab CI, Azure Pipelines, Jenkins). */
export interface CiProvider {
  readonly id: string; // 'github-actions' | 'gitlab-ci' | 'azure-pipelines' | 'jenkins'
  readonly displayName: string;
  /** Workspace-relative glob patterns that locate this provider's files. */
  readonly filePatterns: readonly string[];
  /** True when the (posix, workspace-relative) path belongs to this provider. */
  matches(relativePath: string): boolean;
  analyze(source: string): Analysis;
  /** Returns undefined when the source cannot be parsed into a model. */
  model(source: string): PipelineModel | undefined;
}
