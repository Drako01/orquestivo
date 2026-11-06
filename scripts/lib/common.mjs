// Shared helpers for the enterprise verification scripts (single source of truth
// for status vocabulary, hashing, file walking, process execution and step reports).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const REPORTS = join(ROOT, 'reports');
export const STEP_DIR = join(REPORTS, 'steps');

/** Statuses a step can report. PASS_REUSED is assigned only by the orchestrator cache. */
export const STATUS = Object.freeze({
  PASS: 'PASS', PASS_REUSED: 'PASS_REUSED', FAIL: 'FAIL', WARN: 'WARN',
  SKIP: 'SKIP', INCONCLUSIVE: 'INCONCLUSIVE', BLOCKED: 'BLOCKED',
});
export const isPass = (status) => status === STATUS.PASS || status === STATUS.PASS_REUSED;

export const posix = (path) => path.split(sep).join('/');
export const abs = (...parts) => join(ROOT, ...parts);
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });
export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sha256File = (path) => sha256(readFileSync(path));

/** True when the current module is the process entry point (for scripts that are also importable). */
export const isMain = (metaUrl) => resolve(fileURLToPath(metaUrl)) === resolve(process.argv[1] ?? '');

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'reports', 'dist', 'dist-test', '.vscode-test']);
/** Lists repository files under a file or directory (relative POSIX paths), sorted. */
export function listFiles(entry, base = ROOT) {
  const start = join(base, entry);
  let info;
  try { info = statSync(start); } catch { return []; }
  if (!info.isDirectory()) return [posix(relative(base, start))];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!SKIPPED_DIRS.has(name)) walk(full); } else out.push(posix(relative(base, full)));
    }
  };
  walk(start);
  return out.sort();
}

/** Runs a command with captured output so callers keep logs out of the console. */
export function run(command, args, options = {}) {
  const started = Date.now();
  // npm/npx are .cmd shims on Windows and need a shell; arguments here are static literals, never user input.
  const shell = command === 'npm' || command === 'npx';
  const result = spawnSync(shell ? [command, ...args].join(' ') : command, shell ? [] : args, {
    cwd: options.cwd ?? ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell,
    timeout: options.timeoutMs ?? 10 * 60 * 1000, env: { ...process.env, ...options.env },
  });
  return {
    code: result.status ?? (result.error ? 1 : 0), signal: result.signal,
    output: (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''),
    timedOut: result.error?.code === 'ETIMEDOUT', durationMs: Date.now() - started,
  };
}

/** Writes reports/steps/<id>.json and sets the process exit code from the status. */
export function finish(id, status, evidence) {
  const report = { id, status, generatedAt: new Date().toISOString(), evidence };
  writeJson(join(STEP_DIR, `${id}.json`), report);
  console.log(`[${id}] ${status}${evidence.summary ? ' - ' + evidence.summary : ''}`);
  process.exitCode = status === STATUS.FAIL ? 1 : status === STATUS.PASS || status === STATUS.WARN ? 0 : 2;
  return report;
}

export function parseArgs(argv, valued = []) {
  const flags = new Set(), values = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      if (valued.includes(name)) values[name] = inline ?? argv[++i]; else flags.add(name);
    } else rest.push(arg);
  }
  return { flags, values, rest };
}
