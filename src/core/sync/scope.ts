/**
 * Write scope (R5): the app writes only under `journal/` and `library/` of the gym
 * repository, and never `journal/formalized.md`, which gym writes. This is the one choke
 * point: `GitHubRemote.commit` calls `assertWriteScope` before sending anything, so no code
 * path can write elsewhere.
 */

export const WRITABLE_ROOTS = ['journal/', 'library/'] as const;

/** Files under the writable roots that belong to gym. */
export const GYM_OWNED = new Set(['journal/formalized.md']);

export class WriteScopeError extends Error {
  constructor(readonly path: string) {
    super(`Refusing to write ${JSON.stringify(path)}: Slate writes only under journal/ and library/ (R5)`);
    this.name = 'WriteScopeError';
  }
}

/** True when `path` is a normalised repository path the app may write. */
export function isWritablePath(path: string): boolean {
  if (typeof path !== 'string' || !path || path.length > 4096) return false;
  // normalised form only: no leading slash, backslashes, empty, '.' or '..' segments, control characters
  if (path.startsWith('/') || path.includes('\\') || /[\0-\x1f\x7f]/.test(path)) return false;
  const segs = path.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  if (!WRITABLE_ROOTS.some((root) => path.startsWith(root))) return false;
  if (segs.length < 2) return false;
  return !GYM_OWNED.has(path);
}

export function assertWriteScope(paths: Iterable<string>): void {
  for (const p of paths) if (!isWritablePath(p)) throw new WriteScopeError(p);
}
