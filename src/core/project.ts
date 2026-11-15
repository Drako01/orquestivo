/** Pure project-context helpers (no vscode import): identity, scoping and monorepo project directories. */

export interface ProjectRoot {
  /** Canonical id derived from the URI; stable across sessions. */
  readonly id: string;
  readonly name: string;
  readonly uri: string;
  readonly workspaceFolderUri: string;
  /** '' for the workspace folder itself, POSIX subfolder for a monorepo project. */
  readonly relativeRoot: string;
}

/** What an audit covers: one project, or (consciously chosen) every workspace folder. */
export type ProjectScope =
  | { readonly kind: 'project'; readonly root: ProjectRoot }
  | { readonly kind: 'workspace'; readonly roots: readonly ProjectRoot[] };

export const canonicalUri = (uri: string): string => uri.replace(/\/+$/, '');

export const projectIdOf = (uri: string): string => canonicalUri(uri);

export function scopeKey(scope: ProjectScope | undefined): string {
  if (!scope) return 'none';
  return scope.kind === 'project' ? `project:${scope.root.id}` : `workspace:${scope.roots.map((r) => r.id).sort().join('|')}`;
}

export function scopeLabel(scope: ProjectScope | undefined): string {
  if (!scope) return '';
  return scope.kind === 'project' ? scope.root.name : scope.roots.map((r) => r.name).join(', ');
}

/** True when `candidate` is `root` or lives below it (canonical URI prefix on a path boundary). */
export function isWithin(rootUri: string, candidateUri: string): boolean {
  const root = canonicalUri(rootUri);
  const candidate = canonicalUri(candidateUri);
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** True when a file URI belongs to the scope. */
export function scopeContains(scope: ProjectScope | undefined, fileUri: string): boolean {
  if (!scope) return false;
  const roots = scope.kind === 'project' ? [scope.root] : scope.roots;
  return roots.some((r) => isWithin(r.uri, fileUri));
}

/**
 * Directory that owns a CI file: the folder containing `.github/workflows` for GitHub Actions,
 * otherwise the file's own folder. '' is the workspace folder root.
 */
export function projectDirOf(relativeFilePath: string): string {
  const path = relativeFilePath.replace(/\\/g, '/');
  const marker = '.github/workflows/';
  if (path.startsWith(marker)) return '';
  const nested = path.indexOf(`/${marker}`);
  if (nested >= 0) return path.slice(0, nested);
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Distinct, sorted monorepo project directories (excluding the folder root) from discovered CI file paths. */
export function detectSubProjects(relativeFilePaths: readonly string[], limit = 50): readonly string[] {
  const dirs = new Set<string>();
  for (const file of relativeFilePaths) {
    const dir = projectDirOf(file);
    if (dir !== '') dirs.add(dir);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}
