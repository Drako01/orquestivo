#!/usr/bin/env node
// Coverage on the ORIGINAL TypeScript sources.
// node:test emits lcov for the compiled files in dist-test/. Those carry inline source maps
// (scripts/build-tests.mjs), so every generated line/branch record is mapped back to its
// src/*.ts line and aggregated per module group from scripts/coverage-thresholds.json.
// Line mapping uses the first mapped segment of each generated line (esbuild output is ~1:1);
// a source line counts as covered when any generated line mapped to it was executed.
// Usage: node scripts/coverage.mjs [--no-run]   (--no-run re-reads reports/coverage/lcov.info)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { ROOT, STATUS, finish, isMain, parseArgs, posix, readJson, run, writeJson, ensureDir } from './lib/common.mjs';

const LCOV = join(ROOT, 'reports', 'coverage', 'lcov.info');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes a source map into, per generated line, the first mapped [sourceIndex, sourceLine]. */
export function firstSegmentPerLine(map) {
  const lines = [];
  let source = 0, sourceLine = 0;
  for (const group of map.mappings.split(';')) {
    let first;
    for (const segment of group.split(',')) {
      if (!segment) continue;
      const fields = [];
      let shift = 0, value = 0;
      for (const char of segment) {
        const digit = B64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else { fields.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
      }
      if (fields.length >= 4) {
        source += fields[1]; sourceLine += fields[2];
        first ??= [source, sourceLine];
      }
    }
    lines.push(first);
  }
  return lines;
}

function inlineMap(jsPath) {
  const text = readFileSync(jsPath, 'utf8');
  const match = text.match(/sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/);
  return match ? JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) : undefined;
}

function parseLcov(text) {
  const files = new Map();
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) { current = { da: new Map(), brda: [] }; files.set(line.slice(3), current); }
    else if (line.startsWith('DA:') && current) { const [n, hits] = line.slice(3).split(','); current.da.set(Number(n), Number(hits)); }
    else if (line.startsWith('BRDA:') && current) { const [n, , , taken] = line.slice(5).split(','); current.brda.push([Number(n), taken === '-' ? 0 : Number(taken)]); }
  }
  return files;
}

/** Maps lcov records of dist-test files to original source lines. Returns Map<srcPath, {lines, branches}>. */
export function mapToSources(lcovText) {
  const result = new Map();
  for (const [file, data] of parseLcov(lcovText)) {
    const jsPath = resolve(ROOT, file);
    if (!posix(file).includes('dist-test/') || !existsSync(jsPath)) continue;
    const map = inlineMap(jsPath);
    if (!map) continue;
    const perLine = firstSegmentPerLine(map);
    const sources = map.sources.map((s) => posix(resolve(dirname(jsPath), map.sourceRoot ?? '', s)));
    const entry = (generatedLine) => {
      const hit = perLine[generatedLine - 1];
      if (!hit) return undefined;
      const src = sources[hit[0]];
      const rel = posix(src.startsWith(posix(ROOT)) ? src.slice(posix(ROOT).length + 1) : src);
      if (!result.has(rel)) result.set(rel, { lines: new Map(), branches: new Map() });
      return [result.get(rel), hit[1] + 1];
    };
    for (const [n, hits] of data.da) {
      const mapped = entry(n);
      if (mapped) mapped[0].lines.set(mapped[1], Math.max(mapped[0].lines.get(mapped[1]) ?? 0, hits));
    }
    for (const [n, taken] of data.brda) {
      const mapped = entry(n);
      if (!mapped) continue;
      const key = `${mapped[1]}`;
      const list = mapped[0].branches.get(key) ?? [];
      list.push(taken);
      mapped[0].branches.set(key, list);
    }
  }
  return result;
}

/** Glob to RegExp supporting **, * and {a,b}. */
const glob = (pattern) => new RegExp('^' + [...pattern].map((char, index, chars) => {
  if (char === '*') return chars[index + 1] === '*' ? '.*' : chars[index - 1] === '*' ? '' : '[^/]*';
  if (char === '{') return '(';
  if (char === '}') return ')';
  if (char === ',') return '|';
  return '.+^$()|[]\\'.includes(char) ? '\\' + char : char;
}).join('') + '$');
const pct = (hit, total) => (total ? Math.round((hit / total) * 10000) / 100 : 100);

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const thresholds = readJson(join(ROOT, 'scripts', 'coverage-thresholds.json'));
  let testRun;
  if (!flags.has('no-run')) {
    ensureDir(dirname(LCOV));
    testRun = run('node', [
      join(ROOT, 'scripts', 'build-tests.mjs'),
    ]);
    if (testRun.code === 0) {
      testRun = run(process.execPath, [
        '--experimental-test-coverage', '--test-reporter=lcov', `--test-reporter-destination=${LCOV}`,
        '--test-reporter=spec', '--test-reporter-destination=stdout', '--test', 'test/**/*.test.cjs',
      ]);
    }
    if (testRun.code !== 0) {
      finish('coverage', STATUS.FAIL, { summary: 'tests failed while collecting coverage', exitCode: testRun.code, tail: testRun.output.slice(-1500) });
      process.exit();
    }
  }
  if (!existsSync(LCOV)) {
    finish('coverage', STATUS.INCONCLUSIVE, { summary: 'reports/coverage/lcov.info missing' });
    process.exit();
  }
  const sources = mapToSources(readFileSync(LCOV, 'utf8'));
  if (!sources.size) {
    finish('coverage', STATUS.INCONCLUSIVE, { summary: 'no coverage record could be mapped back to src/*.ts (source maps missing?)' });
    process.exit();
  }
  const groups = thresholds.groups.map((group) => {
    const re = glob(group.pattern);
    const files = [...sources].filter(([path]) => re.test(path));
    let lh = 0, lf = 0, bh = 0, bf = 0;
    for (const [, s] of files) {
      lf += s.lines.size; lh += [...s.lines.values()].filter((h) => h > 0).length;
      for (const taken of s.branches.values()) { bf += taken.length; bh += taken.filter((t) => t > 0).length; }
    }
    return { name: group.name, pattern: group.pattern, files: files.map(([path]) => path), lines: pct(lh, lf), branches: pct(bh, bf), min: { lines: group.lines, branches: group.branches }, matched: files.length > 0 };
  });
  const failures = groups.flatMap((g) => [
    ...(g.matched && g.lines < g.min.lines ? [`${g.name}: lines ${g.lines}% < ${g.min.lines}%`] : []),
    ...(g.matched && g.min.branches !== undefined && g.branches < g.min.branches ? [`${g.name}: branches ${g.branches}% < ${g.min.branches}%`] : []),
  ]);
  const unmatched = groups.filter((g) => !g.matched).map((g) => g.name);
  const perFile = Object.fromEntries([...sources].map(([path, s]) => [path, {
    lines: pct([...s.lines.values()].filter((h) => h > 0).length, s.lines.size),
  }]));
  writeJson(join(ROOT, 'reports', 'coverage', 'summary.json'), { groups, perFile });
  finish('coverage', failures.length ? STATUS.FAIL : unmatched.length ? STATUS.WARN : STATUS.PASS, {
    summary: groups.filter((g) => g.matched).map((g) => `${g.name} L${g.lines}%/B${g.branches}%`).join('; ') + (unmatched.length ? ` (no data: ${unmatched.join(', ')})` : ''),
    failures, groups: groups.map(({ files, ...g }) => ({ ...g, fileCount: files.length })), measuredOn: 'original TypeScript via inline source maps',
  });
}
