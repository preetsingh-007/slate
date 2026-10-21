/**
 * Git LFS mode for book files (R7, L6; PRD open question "Where book files live").
 *
 * Default: book files stay on each device, matched by content hash (`BookMeta.fileHash`), and
 * are never committed. In LFS mode a book file is uploaded through the Git LFS batch API and
 * committed as an LFS pointer at `library/books/<slug>/book.pdf|epub`. The book's SHA-256 is
 * exactly its LFS object id.
 *
 * Limitation: GitHub serves the LFS API from github.com (`https://github.com/<owner>/<repo>.git/
 * info/lfs`), not api.github.com, and that endpoint does not answer cross-origin (CORS) requests,
 * so a browser cannot reach it; the app's Content Security Policy also allows only api.github.com.
 * The client below implements the protocol and works against any CORS-enabled LFS server (the
 * tests use the in-memory one); against GitHub the upload fails and sync reports that book files
 * stay on the device. A pointer is only committed after its object was uploaded, so the
 * repository never references missing LFS objects.
 */
import { GITHUB_API } from './git/github';
import type { FetchLike } from './git/remote';

export const LFS_LIMITATION =
  "GitHub's Git LFS server (github.com) does not accept requests from web apps, so Slate cannot upload book files there from the browser. In Git LFS mode Slate allows files over 50 MB and tries the upload, but book files stay on each device until GitHub supports it.";

export class LfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LfsError';
  }
}

export function lfsPointer(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}

export function parseLfsPointer(text: string): { oid: string; size: number } | null {
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  return text.startsWith('version https://git-lfs.github.com/spec/') && oid && size ? { oid, size: Number(size) } : null;
}

/** The LFS endpoint for a repository: GitHub's, or the mock's when tests point the API elsewhere. */
export function lfsEndpoint(apiBase: string, repo: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return base === GITHUB_API ? `https://github.com/${repo}.git/info/lfs` : `${base}/lfs/${repo}`;
}

interface BatchObject {
  oid: string;
  size: number;
  actions?: Record<string, { href: string; header?: Record<string, string> }>;
  error?: { code: number; message: string };
}

export class LfsClient {
  private fetchFn: FetchLike;

  constructor(
    private endpoint: string,
    private token: string,
    fetchFn?: FetchLike,
  ) {
    this.fetchFn = fetchFn ?? ((u, i) => fetch(u, i));
  }

  private async batch(operation: 'upload' | 'download', oid: string, size: number): Promise<BatchObject> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.endpoint}/objects/batch`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.git-lfs+json',
          'Content-Type': 'application/vnd.git-lfs+json',
          Authorization: `Basic ${btoa(`slate:${this.token}`)}`,
        },
        body: JSON.stringify({ operation, transfers: ['basic'], objects: [{ oid, size }], hash_algo: 'sha256' }),
      });
    } catch {
      throw new LfsError(LFS_LIMITATION);
    }
    if (!res.ok) throw new LfsError(`Git LFS ${operation} failed (${res.status}).`);
    const data = (await res.json()) as { objects?: BatchObject[] };
    const obj = data.objects?.find((o) => o.oid === oid);
    if (!obj) throw new LfsError('Git LFS: object missing from the batch response.');
    if (obj.error) throw new LfsError(`Git LFS: ${obj.error.message}`);
    return obj;
  }

  /** Uploads an object unless the server already has it. */
  async upload(oid: string, blob: Blob): Promise<void> {
    const obj = await this.batch('upload', oid, blob.size);
    const action = obj.actions?.upload;
    if (!action) return; // already there
    const res = await this.fetchFn(action.href, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(action.header ?? {}) }, body: blob });
    if (!res.ok) throw new LfsError(`Git LFS upload failed (${res.status}).`);
    const verify = obj.actions?.verify;
    if (verify) {
      const v = await this.fetchFn(verify.href, { method: 'POST', headers: { 'Content-Type': 'application/vnd.git-lfs+json', ...(verify.header ?? {}) }, body: JSON.stringify({ oid, size: blob.size }) });
      if (!v.ok) throw new LfsError(`Git LFS verify failed (${v.status}).`);
    }
  }

  async download(oid: string, size: number): Promise<Blob> {
    const obj = await this.batch('download', oid, size);
    const action = obj.actions?.download;
    if (!action) throw new LfsError('Git LFS: no download link.');
    const res = await this.fetchFn(action.href, { headers: action.header ?? {} });
    if (!res.ok) throw new LfsError(`Git LFS download failed (${res.status}).`);
    return new Blob([await res.arrayBuffer()], { type: 'application/octet-stream' });
  }
}
