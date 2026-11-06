// Compiles every vscode-independent module under src/ to dist-test/ (CJS, unbundled)
// so node:test suites can import the real TypeScript sources via source maps.
// Files that import 'vscode' live in src/extension.ts and src/vscode/ and are excluded.
import { build } from 'esbuild';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const entries = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (relative(root, full).split(sep)[0] === 'vscode') continue;
      walk(full);
    } else if (name.endsWith('.ts') && name !== 'extension.ts') entries.push(full);
  }
};
walk(root);
rmSync(new URL('../dist-test', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: entries, outdir: 'dist-test', outbase: 'src', format: 'cjs', platform: 'node',
  target: 'node22', sourcemap: 'inline', logLevel: 'warning',
});
