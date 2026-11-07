#!/usr/bin/env node
// Offline CycloneDX 1.5 style SBOM generated from package-lock.json only (no network).
// Usage: node scripts/sbom.mjs [--out reports/sbom.cdx.json]
import { join } from 'node:path';
import { ROOT, STATUS, finish, isMain, parseArgs, readJson, writeJson } from './lib/common.mjs';

/** Returns lockfile packages as { name, version, dev, optional, license, integrity, resolved }. */
export function lockPackages(lock = readJson(join(ROOT, 'package-lock.json'))) {
  const marker = 'node_modules/';
  return Object.entries(lock.packages ?? {})
    .filter(([path]) => path.startsWith(marker))
    .map(([path, meta]) => ({
      name: path.slice(path.lastIndexOf(marker) + marker.length),
      version: meta.version, dev: Boolean(meta.dev || meta.devOptional), optional: Boolean(meta.optional),
      license: meta.license, integrity: meta.integrity, resolved: meta.resolved,
    }));
}

const purl = (p) => `pkg:npm/${p.name.startsWith('@') ? '%40' + p.name.slice(1) : p.name}@${p.version}`;
const hashOf = (integrity) => {
  const [algo, b64] = integrity.split('-');
  return { alg: algo === 'sha512' ? 'SHA-512' : algo === 'sha256' ? 'SHA-256' : 'SHA-1', content: Buffer.from(b64 ?? '', 'base64').toString('hex') };
};

export function buildSbom(pkg = readJson(join(ROOT, 'package.json')), packages = lockPackages()) {
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'orquestivo', name: 'scripts/sbom.mjs' }],
      component: { type: 'application', name: pkg.name, version: pkg.version, 'bom-ref': purl(pkg) },
    },
    components: packages.map((p) => ({
      type: 'library', name: p.name, version: p.version, 'bom-ref': purl(p), purl: purl(p),
      scope: p.dev ? 'excluded' : 'required',
      ...(p.license ? { licenses: [{ expression: p.license }] } : {}),
      ...(p.integrity ? { hashes: [hashOf(p.integrity)] } : {}),
      ...(p.resolved ? { externalReferences: [{ type: 'distribution', url: p.resolved }] } : {}),
    })),
  };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs(process.argv.slice(2), ['out']);
  const outRel = values.out ?? 'reports/sbom.cdx.json';
  const bom = buildSbom();
  writeJson(join(ROOT, outRel), bom);
  const runtime = bom.components.filter((c) => c.scope === 'required').length;
  finish('sbom', bom.components.length ? STATUS.PASS : STATUS.INCONCLUSIVE, {
    summary: `${bom.components.length} components (${runtime} runtime) from package-lock.json`, output: outRel,
  });
}
