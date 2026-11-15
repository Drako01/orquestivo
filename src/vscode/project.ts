import * as vscode from 'vscode';
import { detectSubProjects, projectIdOf, scopeKey, type ProjectRoot, type ProjectScope } from '../core/project.js';
import { discoveryGlob, SCAN_EXCLUDE } from './scanner.js';
import { relativePath, t } from './runtime.js';

const STATE_KEY = 'orquestivo.project.selection';
const MAX_DISCOVERY = 200;

interface SavedSelection { readonly kind: 'project' | 'workspace'; readonly folder?: string; readonly rel?: string }

function isSaved(value: unknown): value is SavedSelection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v['kind'] === 'project' || v['kind'] === 'workspace')
    && (v['folder'] === undefined || typeof v['folder'] === 'string') && (v['rel'] === undefined || typeof v['rel'] === 'string');
}

/** A relative root coming from storage must stay inside its folder: no empty, absolute, `.` or `..` segments. */
const safeRel = (rel: string): boolean => rel === '' || rel.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\\'));

const withIcon = (icon: string, text: string): string => `$(${icon}) ${text}`;

export function rootOf(folder: vscode.WorkspaceFolder, rel = ''): ProjectRoot {
  const uri = rel === '' ? folder.uri : vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
  return {
    id: projectIdOf(uri.toString()), name: rel === '' ? folder.name : `${folder.name}/${rel}`,
    uri: uri.toString(), workspaceFolderUri: folder.uri.toString(), relativeRoot: rel,
  };
}

/** Single source of truth for which project is audited. The choice is stored per workspace (workspaceState). */
export class ProjectSelection implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private scope: ProjectScope | undefined;
  private chosen = false;
  private readonly folderListener: vscode.Disposable;

  constructor(private readonly state: vscode.Memento) {
    this.restore();
    this.folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => { this.reconcile(); });
  }

  get current(): ProjectScope | undefined { return this.scope; }
  /** False until the user picked (or a single folder made the choice obvious). */
  get needsChoice(): boolean { return !this.chosen && (vscode.workspace.workspaceFolders?.length ?? 0) > 1; }
  get folderCount(): number { return vscode.workspace.workspaceFolders?.length ?? 0; }

  /** Folder whose `.orquestivo/intent.json` and git remote apply; undefined for an all-workspace scope. */
  get primaryUri(): vscode.Uri | undefined {
    return this.scope?.kind === 'project' ? vscode.Uri.parse(this.scope.root.uri) : undefined;
  }

  /** Workspace folder of the selected project, where its `.git` directory lives; undefined for all-workspace scope. */
  get repoFolderUri(): vscode.Uri | undefined {
    return this.scope?.kind === 'project' ? vscode.Uri.parse(this.scope.root.workspaceFolderUri) : undefined;
  }

  private restore(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const saved = this.state.get<unknown>(STATE_KEY);
    this.chosen = folders.length === 1;
    this.scope = folders[0] ? { kind: 'project', root: rootOf(folders[0]) } : undefined;
    if (!isSaved(saved) || folders.length === 0) return;
    if (saved.kind === 'workspace' && folders.length > 1) {
      this.scope = { kind: 'workspace', roots: folders.map((f) => rootOf(f)) };
      this.chosen = true;
      return;
    }
    const folder = folders.find((f) => f.uri.toString() === saved.folder);
    if (folder && safeRel(saved.rel ?? '')) {
      this.scope = { kind: 'project', root: rootOf(folder, saved.rel ?? '') };
      this.chosen = true;
    }
  }

  private reconcile(): void {
    const before = scopeKey(this.scope);
    this.restore();
    if (before !== scopeKey(this.scope)) this.emitter.fire();
  }

  private set(scope: ProjectScope): void {
    const changed = scopeKey(this.scope) !== scopeKey(scope);
    this.scope = scope;
    this.chosen = true;
    const saved: SavedSelection = scope.kind === 'workspace' ? { kind: 'workspace' }
      : { kind: 'project', folder: scope.root.workspaceFolderUri, rel: scope.root.relativeRoot };
    void this.state.update(STATE_KEY, saved);
    if (changed) this.emitter.fire();
  }

  /** Nearest-to-root monorepo project folders discovered by bounded CI file discovery. */
  private async discover(folder: vscode.WorkspaceFolder): Promise<readonly string[]> {
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, discoveryGlob()), SCAN_EXCLUDE, MAX_DISCOVERY);
    // asRelativePath(uri, false) is relative to the owning folder, also in multi-root workspaces.
    return detectSubProjects(found.map((uri) => relativePath(uri).replace(/\\/g, '/')));
  }

  /** Native picker: folders, detected monorepo projects and (consciously) the whole workspace. */
  async pick(): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
      return false;
    }
    type Item = vscode.QuickPickItem & { readonly scope: ProjectScope };
    const items: Item[] = [];
    for (const folder of folders) {
      items.push({ label: withIcon('root-folder', folder.name), description: folder.uri.fsPath, scope: { kind: 'project', root: rootOf(folder) } });
      for (const rel of await this.discover(folder)) {
        items.push({ label: withIcon('folder', `${folder.name}/${rel}`), description: t('projectMonorepo'), scope: { kind: 'project', root: rootOf(folder, rel) } });
      }
    }
    if (folders.length > 1) {
      items.push({
        label: withIcon('files', t('projectAll')), description: t('projectAllDetail'),
        scope: { kind: 'workspace', roots: folders.map((f) => rootOf(f)) },
      });
    }
    if (items.length === 1 && items[0]) { this.set(items[0].scope); return true; }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: t('projectPick'), matchOnDescription: true });
    if (!picked) return false;
    this.set(picked.scope);
    return true;
  }

  dispose(): void { this.folderListener.dispose(); this.emitter.dispose(); }
}
