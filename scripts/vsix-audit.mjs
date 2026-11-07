#!/usr/bin/env node
// Audits the contents of a packaged VSIX against scripts/vsix-policy.json.
// Usage: node scripts/vsix-audit.mjs [orquestivo.vsix]
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, STATUS, finish, readJson, sha256 } from './lib/common.mjs';
import { readZip } from './lib/zip.mjs';

const vsixPath = join(ROOT, process.argv[2] ?? 'orquestivo.vsix');
if (!existsSync(vsixPath)) {
  finish('vsix-audit', STATUS.INCONCLUSIVE, { summary: `${vsixPath} does not exist; run the package step first` });
} else {
  const policy = readJson(join(ROOT, 'scripts', 'vsix-policy.json'));
  const pkg = readJson(join(ROOT, 'package.json'));
  const entries = readZip(vsixPath);
  const names = entries.map((e) => e.name);
  const problems = [], warnings = [];

  for (const alternatives of policy.required) {
    if (!alternatives.split('|').some((name) => names.some((n) => n.toLowerCase() === name.toLowerCase()))) problems.push(`missing required file: ${alternatives}`);
  }
  const forbidden = policy.forbidden.map((p) => new RegExp(p, 'i'));
  for (const name of names) if (forbidden.some((re) => re.test(name))) problems.push(`forbidden file packaged: ${name}`);

  const size = statSync(vsixPath).size;
  if (size > policy.maxVsixBytes) problems.push(`VSIX is ${size} bytes (budget ${policy.maxVsixBytes})`);
  const secrets = policy.secretPatterns.map((p) => new RegExp(p));
  const seen = new Map();
  for (const entry of entries) {
    if (entry.size > policy.maxFileBytes) warnings.push(`large file ${entry.name} (${entry.size} bytes)`);
    const data = entry.read();
    const digest = sha256(data);
    if (entry.size > 1024 && seen.has(digest)) warnings.push(`duplicate content: ${entry.name} == ${seen.get(digest)}`);
    seen.set(digest, entry.name);
    if (/\.(js|json|md|txt|svg|html|css|yml|yaml)$/i.test(entry.name)) {
      const text = data.toString('utf8');
      for (const re of secrets) if (re.test(text)) problems.push(`possible secret in ${entry.name} (${re.source.slice(0, 24)})`);
    }
  }

  const manifestEntry = entries.find((e) => e.name === 'extension/package.json');
  if (manifestEntry) {
    const manifest = JSON.parse(manifestEntry.read().toString('utf8'));
    for (const key of ['name', 'publisher', 'version']) if (manifest[key] !== pkg[key]) problems.push(`packaged ${key} "${manifest[key]}" differs from package.json "${pkg[key]}"`);
    if (manifest.main && !names.includes('extension/' + manifest.main.replace(/^\.\//, ''))) problems.push(`main entry ${manifest.main} is not packaged`);
  }

  finish('vsix-audit', problems.length ? STATUS.FAIL : warnings.length ? STATUS.WARN : STATUS.PASS, {
    summary: `${entries.length} files, ${size} bytes, ${problems.length} problems, ${warnings.length} warnings`,
    files: entries.length, bytes: size, problems, warnings,
  });
}
