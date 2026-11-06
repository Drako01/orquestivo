import * as path from 'node:path';

/** Injected so the resolver stays pure and testable (`fs.realpathSync` in production). */
export type RealpathFn = (candidate: string) => string;

export type PathRejection =
  | 'invalid'
  | 'null-byte'
  | 'device-path'
  | 'outside-root'
  | 'symlink-escape'
  | 'root-unresolvable'
  | 'unresolvable';

export type SafePathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: PathRejection };

const DEVICE_PREFIX = /^[\\/]{2}[?.][\\/]/;

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Real path of the deepest existing ancestor plus the not-yet-existing remainder. */
function realWithRemainder(target: string, realpath: RealpathFn): string | undefined {
  const remainder: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(realpath(current), ...remainder.reverse());
    } catch (error) {
      if (!isMissing(error)) return undefined; // fail closed on EACCES, ELOOP, ...
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `candidate` against `root` and guarantees the result, after following symlinks,
 * is still inside `root`. Rejects traversal, absolute escapes, device paths and null bytes.
 * Note: a check-then-use gap (TOCTOU) remains inherent to path checks; open the returned path promptly.
 */
export function resolveInside(root: string, candidate: string, realpath: RealpathFn): SafePathResult {
  if (typeof root !== 'string' || typeof candidate !== 'string' || root === '' || candidate === '') {
    return { ok: false, reason: 'invalid' };
  }
  if (candidate.includes('\0') || root.includes('\0')) return { ok: false, reason: 'null-byte' };
  if (DEVICE_PREFIX.test(candidate)) return { ok: false, reason: 'device-path' };

  let realRoot: string;
  try {
    realRoot = realpath(path.resolve(root));
  } catch {
    return { ok: false, reason: 'root-unresolvable' };
  }

  const lexical = path.resolve(realRoot, candidate);
  if (!isInside(realRoot, lexical)) return { ok: false, reason: 'outside-root' };

  const real = realWithRemainder(lexical, realpath);
  if (real === undefined) return { ok: false, reason: 'unresolvable' };
  if (!isInside(realRoot, real)) return { ok: false, reason: 'symlink-escape' };
  return { ok: true, path: real };
}
