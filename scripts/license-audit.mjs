#!/usr/bin/env node
// Audits licenses of production dependencies (from package-lock.json) against scripts/license-policy.json.
// The extension bundles its runtime dependencies with esbuild, so these are the licenses shipped in dist/.
import { join } from 'node:path';
import { ROOT, STATUS, finish, readJson } from './lib/common.mjs';
import { lockPackages } from './sbom.mjs';

const policy = readJson(join(ROOT, 'scripts', 'license-policy.json'));
const allowed = new Set(policy.allow);
/** An SPDX expression passes when every AND-term has at least one allowed OR-alternative. */
const expressionAllowed = (expression) => expression
  .replace(/[()]/g, ' ').split(/\s+AND\s+/i)
  .every((term) => term.split(/\s+OR\s+/i).some((id) => allowed.has(id.trim())));

const runtime = lockPackages().filter((p) => !p.dev);
const unknown = [], denied = [];
for (const p of runtime) {
  const key = `${p.name}@${p.version}`;
  if (policy.exceptions[key]) continue;
  if (!p.license) unknown.push(key);
  else if (!expressionAllowed(p.license)) denied.push(`${key} (${p.license})`);
}
const status = denied.length ? STATUS.FAIL : unknown.length ? STATUS.INCONCLUSIVE : STATUS.PASS;
finish('licenses', status, {
  summary: `${runtime.length} production packages; ${denied.length} denied, ${unknown.length} without license metadata`,
  scanned: runtime.length, denied, unknown,
});
