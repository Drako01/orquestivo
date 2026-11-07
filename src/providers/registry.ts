import type { CiProvider } from '../core/provider.js';
import { githubActionsProvider } from '../core/github/provider.js';
import { azurePipelinesProvider } from './azure-pipelines/provider.js';
import { gitlabCiProvider } from './gitlab-ci/provider.js';
import { jenkinsProvider } from './jenkins/provider.js';

export interface ProviderRegistry {
  readonly allProviders: readonly CiProvider[];
  /** Union of every provider's workspace-relative discovery globs. */
  readonly filePatterns: readonly string[];
  /** Provider owning the (posix, workspace-relative) path, if any. */
  detectProvider(relativePath: string): CiProvider | undefined;
  getProvider(id: string): CiProvider | undefined;
}

/** Builds a registry over an explicit provider list (injectable for tests and extension). */
export function createProviderRegistry(providers: readonly CiProvider[]): ProviderRegistry {
  const byId = new Map(providers.map((p) => [p.id, p]));
  if (byId.size !== providers.length) throw new Error('Duplicate CI provider id in registry.');
  return {
    allProviders: providers,
    filePatterns: [...new Set(providers.flatMap((p) => p.filePatterns))],
    detectProvider: (relativePath) => providers.find((p) => p.matches(relativePath)),
    getProvider: (id) => byId.get(id),
  };
}

export const providerRegistry: ProviderRegistry = createProviderRegistry([
  githubActionsProvider, gitlabCiProvider, azurePipelinesProvider, jenkinsProvider,
]);
export const { allProviders, filePatterns: providerFilePatterns } = providerRegistry;
export const detectProvider = providerRegistry.detectProvider;
export const getProvider = providerRegistry.getProvider;
