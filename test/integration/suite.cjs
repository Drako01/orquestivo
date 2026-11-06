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

  await vscode.commands.executeCommand('orquestivo.openHome');
  // No arbitrary file writes, subprocess execution or GitHub calls are required for activation.
};
