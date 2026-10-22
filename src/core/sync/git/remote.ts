/**
 * Minimal abstraction over the GitHub API used by sync (R4, R8): read the branch head, the
 * repository tree and blobs, and write a chain of commits with one ref update. Adapted from
 * Axiom's `core/sync/git/remote.ts`; Slate talks to GitHub only (github.ts).
 */

export interface GitHead {
  commitSha: string;
  treeSha: string;
}

export interface TreeEntry {
  /** repository-relative path, '/'-separated, no leading slash */
  path: string;
  /** git blob sha (sha1 of "blob <len>\0<bytes>", see `gitBlobSha`) */
  sha: string;
  size: number;
}

export interface GitFileChange {
  path: string;
  /** new content, or null to delete the file */
  content: Uint8Array | null;
}

/** One commit of a push. Commits are chained in order and published with one ref update (R8). */
export interface CommitSpec {
  message: string;
  files: GitFileChange[];
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /** from the repository's `permissions` (R4: write access is verified before the first sync) */
  canPush: boolean;
  canPull: boolean;
}

export interface GitRemote {
  /** stable identity (repository + branch), used to key local sync state */
  readonly id: string;
  getRepo(): Promise<RepoInfo>;
  /** Head of the configured branch, or null when the branch does not exist. */
  getHead(): Promise<GitHead | null>;
  /** Every blob reachable from `treeSha` (the whole repository). */
  listTree(treeSha: string): Promise<TreeEntry[]>;
  getBlob(sha: string): Promise<Uint8Array>;
  /**
   * Creates `commits` in order on top of `parentSha` and fast-forwards the branch to the last
   * one with a single ref update. Throws ConflictError when the branch moved meanwhile.
   */
  commit(commits: CommitSpec[], parentSha: string): Promise<GitHead>;
}

/** The branch moved (non-fast-forward): pull, merge and retry. */
export class ConflictError extends Error {
  constructor(message = 'The branch moved on GitHub (not a fast-forward)') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Any other HTTP failure. */
export class GitRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** when rate-limited: epoch ms at which it is worth retrying */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'GitRemoteError';
  }
}

/**
 * The token was rejected (401) or lacks access (403 that is not a rate limit). Sync pauses
 * and asks for a new token; local changes are kept (R4).
 */
export class AuthError extends GitRemoteError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'AuthError';
  }
}

/** The repository or branch does not exist, or the token cannot see it (404). */
export class NotFoundError extends GitRemoteError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/** GitHub refused one file for its size. */
export class RemoteFileTooLargeError extends GitRemoteError {
  constructor(
    readonly path: string,
    status: number,
  ) {
    super(`GitHub refused ${path}: file too large`, status);
    this.name = 'RemoteFileTooLargeError';
  }
}

const enc = new TextEncoder();

/** Git's blob object id: SHA-1 over "blob <byteLength>\0" + content, hex. */
export async function gitBlobSha(content: Uint8Array): Promise<string> {
  const header = enc.encode(`blob ${content.length}\0`);
  const buf = new Uint8Array(header.length + content.length);
  buf.set(header);
  buf.set(content, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf as BufferSource));
  let s = '';
  for (const b of digest) s += b.toString(16).padStart(2, '0');
  return s;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
