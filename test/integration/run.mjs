import { runTests } from '@vscode/test-electron';
import { resolve, dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionDevelopmentPath = process.env.ORQUESTIVO_PACKAGE_DIR || root;
const extensionTestsPath = resolve(root, 'test/integration/suite.cjs');

// Isolated fixture workspace; no real project or developer files are modified.
// The spawned VS Code extension host inherits this flag. Only the E2E test host
// registers deterministic prompts; an ordinary installed extension never does.
process.env.ORQUESTIVO_E2E_MODE = '1';
const workspace = mkdtempSync(join(tmpdir(), 'orquestivo-integration-'));
mkdirSync(join(workspace, '.github', 'workflows'), { recursive: true });
writeFileSync(join(workspace, '.github', 'workflows', 'orquestivo-ci.yml'), '');

const watchdog = setTimeout(() => {
  console.error('E2E_TIMEOUT: VS Code extension host did not finish within 5 minutes');
  process.exit(124);
}, 5 * 60 * 1000);
try {
  console.log('[Orquestivo E2E] Starting packaged VS Code integration suite');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-workspace-trust', '--disable-telemetry', '--skip-welcome', '--skip-release-notes'],
  });
} catch (error) {
  console.error('Orquestivo VS Code extension-host test failed:', error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  rmSync(workspace, { recursive: true, force: true });
}
