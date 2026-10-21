/**
 * Repository paths in gym (G1, G7). Paths are relative to the repository root, without a
 * leading or trailing slash: `math/linear-algebra/eigenvalues/notes.md`. Directories are
 * written without a trailing slash; the root is ''.
 */

/** Resolves `.` and `..` segments and drops leading, trailing and repeated slashes. */
export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

/** Splits `path#anchor`. */
export function splitAnchor(p: string): { path: string; anchor: string } {
  const i = p.indexOf('#');
  return i < 0 ? { path: p, anchor: '' } : { path: p.slice(0, i), anchor: p.slice(i + 1) };
}

/**
 * Resolves a link target found in the file `fromFile` to a repository path and anchor.
 * Targets starting with `/` are relative to the repository root. Returns null for external
 * links (`https:`, `mailto:`) and bare anchors (`#x`, which stay in the same file: the
 * caller handles them).
 */
export function resolveLink(fromFile: string, href: string): { path: string; anchor: string } | null {
  const h = href.trim();
  if (!h || h.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  const { path: raw, anchor } = splitAnchor(h.split('?')[0]);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep the raw path: a stray % is not worth failing over
  }
  const path = decoded.startsWith('/') ? normalizePath(decoded) : joinPath(dirname(fromFile), decoded);
  return { path, anchor };
}

/** True when `p` is `dir` or lies inside it. */
export function isWithin(p: string, dir: string): boolean {
  return dir === '' || p === dir || p.startsWith(dir + '/');
}

export function isMarkdown(p: string): boolean {
  return /\.md$/i.test(p);
}

const IMAGE = /\.(svg|png|jpe?g|gif|webp|avif)$/i;

export function isImage(p: string): boolean {
  return IMAGE.test(p);
}

/** MIME type by extension, for blobs read from the mirror without a type. */
export function mimeOf(p: string): string {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  return (
    {
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      md: 'text/markdown',
      txt: 'text/plain',
      py: 'text/x-python',
      json: 'application/json',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
}
