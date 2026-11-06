const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('armotusitio.orquestivo');
  assert.ok(extension, 'Orquestivo must be discoverable by its publisher.extension ID');
  await extension.activate();
  assert.equal(extension.isActive, true, 'Extension must activate in VS Code');

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    'orquestivo.openHome',
    'orquestivo.analyze',
    'orquestivo.generateCI',
    'orquestivo.openFinding',
    'orquestivo.undoLastGeneration',
    'orquestivo.connectGitHub',
    'orquestivo.disconnectGitHub',
    'orquestivo.fetchRuns',
    'orquestivo.ai.explainFinding',
  ]) {
    assert.ok(commands.includes(id), 'Missing command: ' + id);
  }

  // Simulate selecting the Activity Bar icon, not the separate Home command.
  // A single view switch must open the Control Center editor tab.
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('workbench.view.extension.orquestivo');

  // The tab title is localized, so identify the Control Center by its webview type.
  const controlCenterOpen = () => vscode.window.tabGroups.all.some(
    group => group.tabs.some(tab => String(tab.input?.viewType ?? '').includes('orquestivo.home')),
  );
  for (let i = 0; i < 100 && !controlCenterOpen(); i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(controlCenterOpen(), true,
    'Clicking Orquestivo in the Activity Bar must open Control Center without another command');

  // Reproduce generator creation: VS Code displays valid, unsaved YAML while
  // the corresponding on-disk file is still empty.
  // The generator is a pure module; load the compiled repo sources (built by `npm test`), not the VSIX.
  const { join } = require('node:path');
  const { generateCI } = require(join(__dirname, '..', '..', 'dist-test', 'core', 'generator.js'));
  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'Integration tests require an isolated test workspace');
  const target = vscode.Uri.joinPath(workspace.uri, '.github', 'workflows', 'orquestivo-ci.yml');
  const source = generateCI({ preset: 'node', trigger: 'push-and-pr' });
  const edit = new vscode.WorkspaceEdit();
  edit.insert(target, new vscode.Position(0, 0), source);
  assert.equal(await vscode.workspace.applyEdit(edit), true, 'Cannot populate the test workflow');
  const unsaved = await vscode.workspace.openTextDocument(target);
  assert.equal(unsaved.isDirty, true, 'Test fixture should contain unsaved changes');
  assert.equal((await vscode.workspace.fs.readFile(target)).byteLength, 0,
    'Test fixture should still be empty on disk');

  await vscode.commands.executeCommand('orquestivo.analyze');
  const diagnostics = vscode.languages.getDiagnostics(target);
  assert.deepEqual(
    diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error).map(item => item.code),
    [],
    'Valid generated YAML in an unsaved editor must not produce WORKFLOW_ROOT_INVALID',
  );
  assert.equal(await unsaved.save(), true, 'Generated workflow should be saveable');
  await vscode.commands.executeCommand('orquestivo.analyze');
  assert.deepEqual(
    vscode.languages.getDiagnostics(target)
      .filter(item => item.severity === vscode.DiagnosticSeverity.Error).map(item => item.code),
    [],
    'Saved generated YAML must not produce errors either',
  );

  await vscode.commands.executeCommand('orquestivo.openHome');
  // Remote evidence and AI must be opt-in.
  const config = vscode.workspace.getConfiguration('orquestivo');
  assert.equal(config.get('remote.enabled'), false, 'Remote evidence must default to disabled');
  assert.equal(config.get('ai.enabled'), false, 'AI must default to disabled');
  assert.equal(config.get('ui.experienceLevel'), 'beginner');

  // No arbitrary file writes, subprocess execution or GitHub calls are required for activation.
};
