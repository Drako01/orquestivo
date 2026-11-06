import { runTests } from '@vscode/test-electron';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionDevelopmentPath = process.env.ORQUESTIVO_PACKAGE_DIR || root;
const extensionTestsPath = resolve(root, 'test/integration/suite.cjs');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-workspace-trust'],
  });
} catch (error) {
  console.error('Orquestivo VS Code extension-host test failed:', error);
  process.exitCode = 1;
}
