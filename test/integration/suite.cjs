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
  ]) {
    assert.ok(commands.includes(id), 'Missing command: ' + id);
  }

  // Reproduce generator creation: VS Code displays valid, unsaved YAML while
  // the corresponding on-disk file is still empty.
  const { join } = require('node:path');
  const { generateCI } = require(join(extension.extensionPath, 'dist', 'generator.cjs'));
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
  // No arbitrary file writes, subprocess execution or GitHub calls are required for activation.
};
