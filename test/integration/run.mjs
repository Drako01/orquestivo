import { runTests } from '@vscode/test-electron';
import { resolve, dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionDevelopmentPath = process.env.ORQUESTIVO_PACKAGE_DIR || root;
const extensionTestsPath = resolve(root, 'test/integration/suite.cjs');

// Isolated fixture workspace; no real project or developer files are modified.
const workspace = mkdtempSync(join(tmpdir(), 'orquestivo-integration-'));
mkdirSync(join(workspace, '.github', 'workflows'), { recursive: true });
writeFileSync(join(workspace, '.github', 'workflows', 'orquestivo-ci.yml'), '');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-workspace-trust'],
  });
} catch (error) {
  console.error('Orquestivo VS Code extension-host test failed:', error);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
