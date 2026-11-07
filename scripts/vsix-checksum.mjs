#!/usr/bin/env node
// Cross-platform sha256sum for the release VSIX.
//   node scripts/vsix-checksum.mjs write orquestivo.vsix   -> writes orquestivo.vsix.sha256 (sha256sum format)
//   node scripts/vsix-checksum.mjs check orquestivo.vsix [--expect <hex>]  -> verifies against the .sha256 file
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { STATUS, finish, isMain, parseArgs, sha256File } from './lib/common.mjs';

if (isMain(import.meta.url)) {
  const { values, rest } = parseArgs(process.argv.slice(2), ['expect']);
  const [mode, file = 'orquestivo.vsix'] = rest;
  const sumFile = `${file}.sha256`;
  if (!['write', 'check'].includes(mode) || !existsSync(file)) {
    finish('sha256', STATUS.INCONCLUSIVE, { summary: `usage: vsix-checksum.mjs write|check <file>; ${file} must exist` });
  } else {
    const digest = sha256File(file);
    if (mode === 'write') {
      writeFileSync(sumFile, `${digest}  ${basename(file)}\n`);
      finish('sha256', STATUS.PASS, { summary: `${basename(file)} sha256=${digest}`, sha256: digest, file: sumFile });
    } else {
      const recorded = existsSync(sumFile) ? readFileSync(sumFile, 'utf8').trim().split(/\s+/)[0] : undefined;
      const expected = values.expect ?? recorded;
      const ok = expected && expected.toLowerCase() === digest;
      finish('sha256', ok ? STATUS.PASS : STATUS.FAIL, {
        summary: ok ? `${basename(file)} matches ${digest}` : `checksum mismatch or missing reference for ${basename(file)}`,
        sha256: digest, expected: expected ?? null,
      });
    }
  }
}
