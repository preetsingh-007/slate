/**
 * GitHub implementation of GitRemote over the REST Git Data API (R4, R8), authenticated with a
 * fine-grained personal access token (Contents: read and write, Metadata: read-only, the gym
 * repository only). Adapted from Axiom's `core/sync/git/github.ts`:
 *
 * - a push is a chain of commits (one per scope) published with ONE ref update, never forced
 *   (R8: history is never rewritten);
 * - every write passes the write-scope choke point first (R5);
 * - no repository creation or empty-repository bootstrap: the gym repository exists;
 * - the token's expiry is read from GitHub's response headers (R4).
 */
import { assertWriteScope } from '../scope';
import { EXPIRY_HEADER, parseTokenExpiry } from '../expiry';
import {
  AuthError,
  ConflictError,
  GitRemoteError,
  NotFoundError,
  RemoteFileTooLargeError,
  base64ToBytes,
  bytesToBase64,
  defaultSleep,
  gitBlobSha,
  mapLimit,
  type CommitSpec,
  type FetchLike,
  type GitHead,
  type GitRemote,
  type RepoInfo,
  type TreeEntry,
} from './remote';

export const GITHUB_API = 'https://api.github.com';

export interface GitHubRemoteOptions {
  token: string;
  /** "owner/name" */
  repo: string;
  branch: string;
  /** API base; production always uses https://api.github.com (tests point it at a mock) */
  baseUrl?: string;
  /** parallel blob uploads/downloads. Default 4. */
  concurrency?: number;
  /** retries for 5xx / rate limits. Default 4. */
  maxRetries?: number;
  /** longest rate-limit wait sat through before failing with retryAt. Default 60 s. */
  maxWaitMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** called with the token expiry whenever a response carries it (R4) */
  onTokenExpiry?: (expiry: number) => void;
}

interface Res<T = unknown> {
  status: number;
  data: T;
}

interface RawTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/** "owner/name" from user input (also accepts a github.com URL). */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? { owner: m[1], name: m[2] } : null;
}

export class GitHubRemote implements GitRemote {
  readonly id: string;
  /** last observed rate-limit budget (for the UI) */
  rateLimit: { remaining: number; resetAt: number } | undefined;
  /** last expiry seen in a response header */
  tokenExpiry: number | undefined;
  private owner: string;
  private name: string;
  private base: string;
  private fetchFn: FetchLike;
  private sleep: (ms: number) => Promise<void>;
  private commitTrees = new Map<string, string>();

  constructor(private opts: GitHubRemoteOptions) {
    const parsed = parseRepo(opts.repo);
    if (!parsed) throw new Error('The repository must be "owner/name".');
    this.owner = parsed.owner;
    this.name = parsed.name;
    this.base = (opts.baseUrl ?? GITHUB_API).replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.id = `github:${this.base}/${this.owner}/${this.name}#${opts.branch}`;
  }

  get repoName(): string {
    return `${this.owner}/${this.name}`;
  }

  private get repoPath() {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}`;
  }

  private get branchRef() {
    return this.opts.branch.split('/').map(encodeURIComponent).join('/');
  }

  // ---------------------------------------------------------------- http

  private async req<T = unknown>(method: string, path: string, body?: unknown, allow: number[] = []): Promise<Res<T>> {
    const maxRetries = this.opts.maxRetries ?? 4;
    const maxWait = this.opts.maxWaitMs ?? 60_000;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(this.base + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.opts.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      this.observeHeaders(res);
      const { status } = res;
      if (status >= 200 && status < 300) return { status, data: status === 204 ? (undefined as T) : ((await res.json()) as T) };
      const text = await res.text().catch(() => '');
      if (allow.includes(status)) return { status, data: safeJson(text) as T };

      const wait = retryDelay(res, text, attempt);
      if (wait !== null) {
        const retryAt = Date.now() + wait;
        if (attempt >= maxRetries || wait > maxWait) {
          throw new GitRemoteError(`GitHub rate limit or server error (${status})`, status, retryAt);
        }
        await this.sleep(wait);
        continue;
      }
      if (status === 401) throw new AuthError('GitHub rejected the access token (bad credentials).', 401);
      if (status === 403) throw new AuthError(`GitHub denied access: ${message(text)}`, 403);
      if (status === 404) throw new NotFoundError(`GitHub: ${this.owner}/${this.name} or branch ${this.opts.branch} not found, or the token has no access to it.`);
      throw new GitRemoteError(`GitHub ${method} ${stripQuery(path)} failed (${status}): ${message(text)}`, status);
    }
  }

  private observeHeaders(res: Response) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null && reset !== null) this.rateLimit = { remaining: Number(remaining), resetAt: Number(reset) * 1000 };
    const expiry = parseTokenExpiry(res.headers.get(EXPIRY_HEADER));
    if (expiry !== null && expiry !== this.tokenExpiry) {
      this.tokenExpiry = expiry;
      this.opts.onTokenExpiry?.(expiry);
    }
  }

  // ---------------------------------------------------------------- GitRemote

  async getRepo(): Promise<RepoInfo> {
    const r = await this.req<{ full_name: string; default_branch: string; private: boolean; permissions?: { push?: boolean; pull?: boolean } }>('GET', this.repoPath);
    return {
      fullName: r.data.full_name,
      defaultBranch: r.data.default_branch,
      private: !!r.data.private,
      canPush: !!r.data.permissions?.push,
      canPull: r.data.permissions?.pull !== false,
    };
  }

  async getHead(): Promise<GitHead | null> {
    const r = await this.req<{ object: { sha: string } }>('GET', `${this.repoPath}/git/ref/heads/${this.branchRef}`, undefined, [404, 409]);
    if (r.status === 404 || r.status === 409) return null;
    // GitHub returns an array for a prefix match (ref "heads/main" vs "heads/main-2")
    if (Array.isArray(r.data)) return null;
    const commitSha = r.data.object.sha;
    return { commitSha, treeSha: await this.treeOf(commitSha) };
  }

  async listTree(treeSha: string): Promise<TreeEntry[]> {
    const out: TreeEntry[] = [];
    const r = await this.req<{ tree: RawTreeEntry[]; truncated: boolean }>('GET', `${this.repoPath}/git/trees/${treeSha}?recursive=1`);
    if (!r.data.truncated) {
      for (const e of r.data.tree) if (e.type === 'blob') out.push({ path: e.path, sha: e.sha, size: e.size ?? 0 });
      return out;
    }
    // Too large for one response: walk subtrees one level at a time.
    const walk = async (sha: string, dir: string): Promise<void> => {
      const t = await this.req<{ tree: RawTreeEntry[] }>('GET', `${this.repoPath}/git/trees/${sha}`);
      const subs: RawTreeEntry[] = [];
      for (const e of t.data.tree) {
        if (e.type === 'blob') out.push({ path: dir + e.path, sha: e.sha, size: e.size ?? 0 });
        else if (e.type === 'tree') subs.push(e);
      }
      await mapLimit(subs, this.opts.concurrency ?? 4, (e) => walk(e.sha, dir + e.path + '/'));
    };
    await walk(treeSha, '');
    return out;
  }

  async getBlob(sha: string): Promise<Uint8Array> {
    const r = await this.req<{ content: string; encoding: string }>('GET', `${this.repoPath}/git/blobs/${sha}`);
    if (r.data.encoding === 'base64') return base64ToBytes(r.data.content);
    return new TextEncoder().encode(r.data.content);
  }

  async commit(commits: CommitSpec[], parentSha: string): Promise<GitHead> {
    // R5: nothing outside journal/ and library/ ever leaves the device
    assertWriteScope(commits.flatMap((c) => c.files.map((f) => f.path)));
    if (!commits.length) throw new Error('commit: nothing to commit');
    const concurrency = this.opts.concurrency ?? 4;

    // upload each distinct blob once (the same bytes may appear in several commits)
    const uploads = new Map<string, Uint8Array>();
    const shaOf = new Map<Uint8Array, string>();
    for (const c of commits) {
      for (const f of c.files) {
        if (!f.content) continue;
        const sha = await gitBlobSha(f.content);
        shaOf.set(f.content, sha);
        if (!uploads.has(sha)) uploads.set(sha, f.content);
      }
    }
    const pathOf = new Map<string, string>();
    for (const c of commits) for (const f of c.files) if (f.content) pathOf.set(shaOf.get(f.content)!, f.path);
    await mapLimit([...uploads], concurrency, async ([sha, content]) => {
      const b = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/blobs`, { content: bytesToBase64(content), encoding: 'base64' }, [413, 422]);
      // "Sorry, your input was too large to process"
      if (b.status === 413 || b.status === 422) {
        const msg = (b.data as { message?: string } | null)?.message ?? '';
        if (b.status === 413 || /too large/i.test(msg)) throw new RemoteFileTooLargeError(pathOf.get(sha) ?? '?', b.status);
        throw new GitRemoteError(`GitHub POST git/blobs failed (${b.status}): ${msg}`, b.status);
      }
      if (b.data.sha !== sha) throw new GitRemoteError(`GitHub stored a blob with an unexpected sha (${b.data.sha})`, 500);
    });

    let parent = parentSha;
    let baseTree = await this.treeOf(parentSha);
    for (const c of commits) {
      const tree = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/trees`, {
        base_tree: baseTree,
        tree: c.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.content ? shaOf.get(f.content)! : null })),
      });
      const commit = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/commits`, { message: c.message, tree: tree.data.sha, parents: [parent] });
      parent = commit.data.sha;
      baseTree = tree.data.sha;
      this.commitTrees.set(parent, baseTree);
    }

    // one ref update for the whole push; never forced (R8)
    const r = await this.req('PATCH', `${this.repoPath}/git/refs/heads/${this.branchRef}`, { sha: parent, force: false }, [409, 422]);
    if (r.status === 422 || r.status === 409) throw new ConflictError();
    return { commitSha: parent, treeSha: baseTree };
  }

  // ---------------------------------------------------------------- helpers

  private async treeOf(commitSha: string): Promise<string> {
    const hit = this.commitTrees.get(commitSha);
    if (hit) return hit;
    const c = await this.req<{ tree: { sha: string } }>('GET', `${this.repoPath}/git/commits/${commitSha}`);
    if (this.commitTrees.size > 64) this.commitTrees.clear();
    this.commitTrees.set(commitSha, c.data.tree.sha);
    return c.data.tree.sha;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function message(text: string): string {
  const j = safeJson(text) as { message?: string } | string;
  return (typeof j === 'object' && j?.message) || String(text).slice(0, 200);
}

function stripQuery(p: string) {
  return p.split('?')[0];
}

/** ms to wait before retrying, or null when the response is not retryable. */
function retryDelay(res: Response, text: string, attempt: number): number | null {
  const status = res.status;
  const retryAfter = res.headers.get('retry-after');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  const rateLimited = status === 429 || (status === 403 && (remaining === '0' || retryAfter !== null || /rate limit/i.test(text)));
  if (rateLimited) {
    if (retryAfter !== null && Number.isFinite(Number(retryAfter))) return Number(retryAfter) * 1000;
    if (remaining === '0' && reset !== null) return Math.max(0, Number(reset) * 1000 - Date.now()) + 1000;
    return 60_000; // secondary rate limit without hints: GitHub asks for at least a minute
  }
  if (status >= 500) return Math.min(30_000, 1000 * 2 ** attempt);
  return null;
}
