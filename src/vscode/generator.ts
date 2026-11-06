import * as vscode from 'vscode';
import {
  GeneratorOptionsError, OPERATING_SYSTEMS, WriteRefusedError, authorizeWrite, createWritePlan, detectStack, generateCI, missingMarkers,
  type OperatingSystem, type Preset, type StackDetection, type WritePlan,
} from '../core/generator.js';
import { githubActionsProvider } from '../core/github/provider.js';
import { parseJsonBounded } from '../security/limits.js';
import { parseUndoRecord, type UndoRecord } from '../ui/undo.js';
import {
  DEFAULT_WORKFLOW_FILE, WIZARD_TRIGGERS, availableSteps, buildGeneratorOptions, orderedPresets, stepDefaults, supportsAudit,
  supportsNonLinux, validateWorkflowFileName, workflowRelativePath, type WizardChoices, type WizardStep, type WizardTrigger,
} from '../ui/wizard.js';
import type { Logger} from './runtime.js';
import { t } from './runtime.js';
import type { TextKey } from '../i18n.js';

const PREVIEW_SCHEME = 'orquestivo-preview';
const UNDO_KEY = 'orquestivo.lastGeneration';
const MAX_PREVIEWS = 8;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

/** Serves the "before" and "after" texts shown in the diff editor. Read-only by construction. */
export class PreviewContent implements vscode.TextDocumentContentProvider {
  static readonly scheme = PREVIEW_SCHEME;
  private readonly texts = new Map<string, string>();
  private counter = 0;

  register(text: string): vscode.Uri {
    const key = `/${++this.counter}`;
    this.texts.set(key, text);
    // Diff editors may be reopened later, so keep a small window of recent texts instead of releasing eagerly.
    for (const old of [...this.texts.keys()].slice(0, Math.max(0, this.texts.size - MAX_PREVIEWS))) this.texts.delete(old);
    return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: key });
  }
  provideTextDocumentContent(uri: vscode.Uri): string { return this.texts.get(uri.path) ?? ''; }
}

interface Pick<T> extends vscode.QuickPickItem { readonly value: T }

async function pickMany<T extends string>(
  values: readonly T[], selected: readonly T[], label: (value: T) => string, placeHolder: string,
): Promise<T[] | undefined> {
  const items: Pick<T>[] = values.map((value) => ({ label: label(value), value, picked: selected.includes(value) }));
  const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder, ignoreFocusOut: true });
  return chosen?.map((c) => c.value);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
    throw error;
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
}

/** Creates or replaces a file through a WorkspaceEdit and saves it so editor and disk agree. */
async function writeWorkspaceFile(uri: vscode.Uri, content: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  if (await exists(uri)) {
    const doc = await vscode.workspace.openTextDocument(uri);
    edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), content);
  } else {
    edit.createFile(uri, { overwrite: false });
    edit.insert(uri, new vscode.Position(0, 0), content);
  }
  if (!await vscode.workspace.applyEdit(edit)) return false;
  return (await vscode.workspace.openTextDocument(uri)).save();
}

const targetUri = (folder: vscode.Uri, relativePath: string): vscode.Uri => vscode.Uri.joinPath(folder, ...relativePath.split('/'));

export class GeneratorWizard {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly previews: PreviewContent,
    private readonly log: Logger,
    /** Called after the workspace changed (write or undo) so views can rescan. */
    private readonly onChanged: () => Promise<void>,
  ) {}

  async generate(): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(t('untrusted')); return; }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { await vscode.window.showWarningMessage(t('noFolder')); return; }
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;

    const detection = await this.detect(folder.uri);
    const choices = await this.ask(detection);
    if (!choices) return;
    if (!await this.checkMarkers(folder.uri, choices.preset)) return;
    const fileName = await vscode.window.showInputBox({
      prompt: t('wizardFileNamePrompt'), value: DEFAULT_WORKFLOW_FILE, ignoreFocusOut: true,
      validateInput: (value) => { const key = validateWorkflowFileName(value); return key ? t(key) : undefined; },
    });
    if (fileName === undefined) return;

    const generated = this.render(choices, detection);
    if (generated === undefined) return;
    const relativePath = workflowRelativePath(fileName);
    const uri = targetUri(folder.uri, relativePath);
    let existing: string | undefined;
    try {
      existing = await exists(uri) ? await readText(uri) : undefined;
    } catch (error) {
      this.log.error('Cannot read the target workflow', error);
      await vscode.window.showErrorMessage(t('writeError'));
      return;
    }
    const plan = createWritePlan(existing, generated, relativePath);
    if (plan.action === 'unchanged') { await vscode.window.showInformationMessage(t('wizardUnchanged')); return; }
    if (!await this.confirm(plan, uri)) return;

    let authorized;
    try {
      authorized = authorizeWrite(plan, { confirmOverwrite: plan.action === 'overwrite' });
    } catch (error) {
      if (error instanceof WriteRefusedError) { await vscode.window.showErrorMessage(t('alreadyExists')); return; }
      throw error;
    }
    if (!authorized.write || authorized.rollback.kind === 'none') return;
    if (!await writeWorkspaceFile(uri, authorized.write.content)) { await vscode.window.showErrorMessage(t('writeError')); return; }
    const record: UndoRecord = { folderUri: folder.uri.toString(), rollback: authorized.rollback, written: authorized.write.content };
    await this.memento.update(UNDO_KEY, record);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await vscode.window.showInformationMessage(t('wizardCreated', { path: relativePath }));
    await this.onChanged();
  }

  async undo(): Promise<void> {
    const record = parseUndoRecord(this.memento.get<unknown>(UNDO_KEY));
    if (!record) { await vscode.window.showInformationMessage(t('undoNothing')); return; }
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(t('untrusted')); return; }
    const folder = vscode.Uri.parse(record.folderUri, true);
    if (!vscode.workspace.getWorkspaceFolder(folder)) { await vscode.window.showWarningMessage(t('undoNothing')); return; }
    const uri = targetUri(folder, record.rollback.path);
    const confirm = t('undoConfirm');
    if (await vscode.window.showWarningMessage(t('undoPrompt', { path: record.rollback.path }), { modal: true }, confirm) !== confirm) return;
    try {
      if (await exists(uri) && await readText(uri) !== record.written) {
        const force = t('undoAnyway');
        if (await vscode.window.showWarningMessage(t('undoModified', { path: record.rollback.path }), { modal: true }, force) !== force) return;
      }
      if (record.rollback.kind === 'delete-file') {
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(uri, { ignoreIfNotExists: true });
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('Delete edit was rejected');
      } else if (!await writeWorkspaceFile(uri, record.rollback.content)) {
        throw new Error('Restore edit was rejected');
      }
    } catch (error) {
      this.log.error('Undo failed', error);
      await vscode.window.showErrorMessage(t('writeError'));
      return;
    }
    await this.memento.update(UNDO_KEY, undefined);
    await vscode.window.showInformationMessage(t('undoDone', { path: record.rollback.path }));
    await this.onChanged();
  }

  private async detect(folder: vscode.Uri): Promise<StackDetection> {
    const names = (await vscode.workspace.fs.readDirectory(folder)).map(([name]) => name);
    let packageJson: unknown;
    if (names.includes('package.json')) {
      try {
        const uri = vscode.Uri.joinPath(folder, 'package.json');
        if ((await vscode.workspace.fs.stat(uri)).size <= MAX_PACKAGE_JSON_BYTES) {
          packageJson = parseJsonBounded(await readText(uri), MAX_PACKAGE_JSON_BYTES, 'package.json');
        }
      } catch (error) {
        this.log.error('Cannot parse package.json for stack detection', error);
      }
    }
    return detectStack(names, packageJson);
  }

  private async ask(detection: StackDetection): Promise<WizardChoices | undefined> {
    const presets = orderedPresets(detection);
    const preset = await vscode.window.showQuickPick(
      presets.map((p): Pick<Preset> => ({
        label: p.label, value: p.preset,
        description: p.reasons.length ? `${t('wizardDetected')}: ${p.reasons.join(', ')}` : '',
      })),
      { placeHolder: t('choosePreset'), ignoreFocusOut: true });
    if (!preset) return undefined;
    const detected = detection.recommendations.find((r) => r.preset === preset.value);

    const triggerLabels: Record<WizardTrigger, TextKey> = { push: 'triggerPush', pullRequest: 'triggerPullRequest', manualDispatch: 'triggerManual' };
    const triggers = await pickMany(WIZARD_TRIGGERS, ['push', 'pullRequest'], (v) => t(triggerLabels[v]), t('chooseTrigger'));
    if (!triggers) return undefined;

    let operatingSystems: OperatingSystem[] | undefined = ['ubuntu'];
    if (supportsNonLinux(preset.value)) {
      operatingSystems = await pickMany(OPERATING_SYSTEMS, ['ubuntu'], (v) => v, t('wizardChooseOs'));
      if (!operatingSystems) return undefined;
    }
    const stepLabels: Record<WizardStep, TextKey> = { lint: 'stepLint', test: 'stepTest', build: 'stepBuild' };
    const steps = await pickMany(availableSteps(preset.value), stepDefaults(preset.value, detected), (v) => t(stepLabels[v]), t('wizardChooseSteps'));
    if (!steps) return undefined;

    let securityScan: WizardChoices['securityScan'] = 'none';
    if (supportsAudit(preset.value)) {
      const scan = await vscode.window.showQuickPick<Pick<WizardChoices['securityScan']>>(
        [{ label: t('scanNone'), value: 'none' }, { label: t('scanAudit'), value: 'audit' }],
        { placeHolder: t('wizardChooseScan'), ignoreFocusOut: true });
      if (!scan) return undefined;
      securityScan = scan.value;
    }
    const deploy = await vscode.window.showQuickPick<Pick<boolean>>(
      [{ label: t('deployNone'), value: false }, { label: t('deployPlaceholder'), value: true }],
      { placeHolder: t('wizardChooseDeploy'), ignoreFocusOut: true });
    if (!deploy) return undefined;
    let deployEnvironment: string | undefined;
    if (deploy.value) {
      deployEnvironment = await vscode.window.showInputBox({ prompt: t('wizardDeployEnvironment'), value: 'production', ignoreFocusOut: true });
      if (deployEnvironment === undefined) return undefined;
    }
    return { preset: preset.value, triggers, operatingSystems, steps, securityScan, deployEnvironment };
  }

  /** Generates and statically validates the workflow; user-facing problems are reported here. */
  private render(choices: WizardChoices, detection: StackDetection): string | undefined {
    const detected = detection.recommendations.find((r) => r.preset === choices.preset);
    let generated: string;
    try {
      generated = generateCI(buildGeneratorOptions(choices, detected));
    } catch (error) {
      if (!(error instanceof GeneratorOptionsError)) throw error;
      const issues = error.issues.map((i) => `${i.field}: ${i.message}`).join('\n');
      void vscode.window.showErrorMessage(t('wizardOptionsInvalid', { issues }));
      return undefined;
    }
    const analysis = githubActionsProvider.analyze(generated);
    if (!analysis.syntaxValid || analysis.findings.some((f) => f.severity === 'error')) {
      void vscode.window.showErrorMessage(t('generatorError'));
      return undefined;
    }
    return generated;
  }

  private async checkMarkers(folder: vscode.Uri, preset: Preset): Promise<boolean> {
    const names = (await vscode.workspace.fs.readDirectory(folder)).map(([name]) => name);
    const missing = missingMarkers(preset, names);
    if (missing.length === 0) return true;
    const proceed = t('continue');
    const answer = await vscode.window.showWarningMessage(
      `${t('missingMarker')} ${missing.map((group) => group.join(' | ')).join(', ')}`, { modal: true }, proceed);
    return answer === proceed;
  }

  /** Shows the diff in an editor and asks for explicit confirmation. */
  private async confirm(plan: WritePlan, target: vscode.Uri): Promise<boolean> {
    const before = this.previews.register(plan.previousContent ?? '');
    const after = this.previews.register(plan.newContent);
    await vscode.commands.executeCommand('vscode.diff', before, after, t('wizardDiffTitle', { path: plan.path }), { preview: true });
    const label = plan.action === 'overwrite' ? t('wizardOverwrite') : t('createFile');
    const message = plan.action === 'overwrite'
      ? t('wizardOverwritePrompt', { path: vscode.workspace.asRelativePath(target, false) }) : t('previewDisclaimer');
    return await vscode.window.showInformationMessage(message, { modal: true }, label) === label;
  }
}
