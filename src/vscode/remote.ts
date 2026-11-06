import * as vscode from 'vscode';
import {
  GitHubRunsClient, loadRemoteContext, type FetchLike, type RepoRef,
} from '../core/evidence/github-runs.js';
import type { RemoteContext } from '../core/evidence/run-evidence.js';
import { safeErrorMessage } from '../security/redact.js';
import { isPlausibleToken, parseGitHubRemote, parseRepoSlug } from '../ui/remote.js';
import type { Logger} from './runtime.js';
import { readSettings, t } from './runtime.js';

const TOKEN_KEY = 'orquestivo.github.token';
const RUN_LIMIT = 10;
const MAX_GIT_CONFIG_BYTES = 64 * 1024;

/** Real network access for the injected client; the abort signal comes from the caller. */
const fetchLike: FetchLike = async (url, init) => {
  const response = await fetch(url, { headers: init.headers, signal: init.signal });
  return { status: response.status, headers: response.headers, text: () => response.text(), body: response.body };
};

/** Opt-in remote GitHub evidence. The token lives only in SecretStorage and is never logged. */
export class RemoteEvidence implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private current: RemoteContext | undefined;
  private connected = false;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly secrets: vscode.SecretStorage, private readonly log: Logger) {
    this.subscription = secrets.onDidChange((e) => { if (e.key === TOKEN_KEY) void this.refreshConnection(); });
  }

  get context(): RemoteContext | undefined { return this.current; }
  get isConnected(): boolean { return this.connected; }

  async refreshConnection(): Promise<void> {
    this.connected = (await this.secrets.get(TOKEN_KEY)) !== undefined;
    this.emitter.fire();
  }

  async connect(): Promise<void> {
    const consent = await vscode.window.showWarningMessage(t('remoteConsent'), { modal: true }, t('remoteConsentAccept'));
    if (consent !== t('remoteConsentAccept')) return;
    const token = await vscode.window.showInputBox({
      prompt: t('tokenPrompt'), password: true, ignoreFocusOut: true,
      validateInput: (value) => (isPlausibleToken(value.trim()) ? undefined : t('tokenInvalid')),
    });
    if (token === undefined) return;
    await this.secrets.store(TOKEN_KEY, token.trim());
    await this.refreshConnection();
    await vscode.window.showInformationMessage(t('remoteConnected'));
  }

  async disconnect(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
    this.current = undefined;
    await this.refreshConnection();
    await vscode.window.showInformationMessage(t('remoteDisconnected'));
  }

  async fetchRuns(): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(t('untrusted')); return; }
    if (!readSettings().remoteEnabled) {
      const open = await vscode.window.showInformationMessage(t('remoteNotEnabled'), t('actionOpenSettings'));
      if (open) await vscode.commands.executeCommand('workbench.action.openSettings', 'orquestivo.remote.enabled');
      return;
    }
    if (!(await this.secrets.get(TOKEN_KEY))) {
      const connect = await vscode.window.showWarningMessage(t('remoteNoToken'), t('actionConnect'));
      if (connect) await this.connect();
      return;
    }
    const repo = await this.askRepo();
    if (!repo) return;
    const client = new GitHubRunsClient({ fetch: fetchLike, tokens: { getToken: async () => this.secrets.get(TOKEN_KEY) } });
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('remoteFetching', { repo: `${repo.owner}/${repo.repo}` }), cancellable: true },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          this.current = await loadRemoteContext(async () =>
            (await client.collectRunEvidence(repo, {}, { limit: RUN_LIMIT, signal: controller.signal })).items);
        } catch (error) {
          // loadRemoteContext already absorbs GitHubRunsError; reaching here means an unexpected failure.
          this.log.error('Remote evidence fetch failed', error);
          this.current = { status: 'unavailable', reason: safeErrorMessage(error) };
        }
        this.emitter.fire();
      });
    if (this.current?.status === 'unavailable') await vscode.window.showWarningMessage(t('remoteUnavailable') + ' ' + this.current.reason);
  }

  private async askRepo(): Promise<RepoRef | undefined> {
    const answer = await vscode.window.showInputBox({
      prompt: t('repoPrompt'), value: await this.guessRepo(), ignoreFocusOut: true,
      validateInput: (value) => (parseRepoSlug(value) ? undefined : t('repoInvalid')),
    });
    return answer === undefined ? undefined : parseRepoSlug(answer);
  }

  private async guessRepo(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return '';
    try {
      const uri = vscode.Uri.joinPath(folder.uri, '.git', 'config');
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_GIT_CONFIG_BYTES) return '';
      const remote = parseGitHubRemote(new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri)));
      return remote ? `${remote.owner}/${remote.repo}` : '';
    } catch {
      return ''; // No readable git config: the user simply types the repository.
    }
  }

  dispose(): void { this.subscription.dispose(); this.emitter.dispose(); }
}
