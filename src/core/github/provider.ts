import { analyzeWorkflow } from '../analyzer.js';
import type { CiProvider } from '../provider.js';
import { createContext, parseWorkflow } from './context.js';
import { buildPipelineModel } from './model.js';

const WORKFLOW_PATH = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;

export const githubActionsProvider: CiProvider = {
  id: 'github-actions',
  displayName: 'GitHub Actions',
  filePatterns: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
  matches: (relativePath) => WORKFLOW_PATH.test(relativePath),
  analyze: analyzeWorkflow,
  model(source) {
    const parsed = parseWorkflow(source);
    return parsed.ok ? buildPipelineModel(createContext(parsed.root, parsed.lineAt, [])) : undefined;
  },
};
