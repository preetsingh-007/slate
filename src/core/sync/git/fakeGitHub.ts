/**
 * In-memory GitHub for tests: the repos, Git Data (refs, commits, trees, blobs) and contents
 * endpoints the sync engine uses, with real git blob shas, fast-forward checks on ref updates,
 * token checks and the token-expiry header (R4). Unit tests call `fetch` directly; the e2e
 * server (`tests/e2e/routes/20-github.mjs`) serves it over HTTP.
 *
 * Written in erasable TypeScript only (no enums, no parameter properties, type-only imports)
 * so Node can load it without a build step. Not part of the app bundle.
 */

export interface FakeRepoInit {
  /** accepted tokens */
  tokens: string[];
  /** initial files on the default branch */
  files?: Record<string, string | Uint8Array>;
  branch?: string;
  /** `permissions.push` of the repository (R4 verification). Default true. */
  push?: boolean;
  /** value of the `github-authentication-token-expiration` header, e.g. "2026-11-01 10:00:00 UTC" */
  tokenExpiry?: string;
}

interface FakeCommit {
  tree: string;
  parents: string[];
  message: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

async function blobSha(content: Uint8Array): Promise<string> {
  const header = enc.encode(`blob ${content.length}\0`);
  const buf = new Uint8Array(header.length + content.length);
  buf.set(header);
  buf.set(content, header.length);
  return sha1Hex(buf);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class FakeRepo {
  readonly fullName: string;
  tokens: Set<string>;
  push: boolean;
  tokenExpiry: string | undefined;
  readonly defaultBranch: string;
  readonly blobs = new Map<string, Uint8Array>();
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, FakeCommit>();
  readonly refs = new Map<string, string>();
  /** LFS objects by oid (sha256) */
  readonly lfs = new Map<string, Uint8Array>();
  /** run once before the next ref update (simulates another device pushing first) */
  beforeRefUpdate: (() => Promise<void> | void) | undefined;
  /** reject this many ref updates as non-fast-forward regardless of state */
  rejectRefUpdates = 0;
  refUpdates = 0;
  conflicts = 0;
  blobsCreated = 0;
  private counter = 0;

  constructor(fullName: string, init: FakeRepoInit) {
    this.fullName = fullName;
    this.tokens = new Set(init.tokens);
    this.push = init.push ?? true;
    this.tokenExpiry = init.tokenExpiry;
    this.defaultBranch = init.branch ?? 'main';
  }

  async putBlob(content: Uint8Array): Promise<string> {
    const sha = await blobSha(content);
    if (!this.blobs.has(sha)) this.blobs.set(sha, content.slice());
    return sha;
  }

  async putTree(entries: Map<string, string>): Promise<string> {
    const lines = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, s]) => `${p} ${s}`);
    const sha = await sha1Hex(enc.encode('tree\n' + lines.join('\n')));
    if (!this.trees.has(sha)) this.trees.set(sha, new Map(entries));
    return sha;
  }

  async putCommit(c: FakeCommit): Promise<string> {
    const sha = await sha1Hex(enc.encode(`commit ${c.tree} ${c.parents.join(',')} ${++this.counter}\n${c.message}`));
    this.commits.set(sha, c);
    return sha;
  }

  /** Files of a branch as path → bytes. */
  files(branch = this.defaultBranch): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    const head = this.refs.get(branch);
    if (!head) return out;
    for (const [p, sha] of this.trees.get(this.commits.get(head)!.tree)!) out.set(p, this.blobs.get(sha)!);
    return out;
  }

  text(path: string, branch = this.defaultBranch): string | undefined {
    const b = this.files(branch).get(path);
    return b ? dec.decode(b) : undefined;
  }

  /** Commit messages from head to root. */
  log(branch = this.defaultBranch): string[] {
    const out: string[] = [];
    for (let sha = this.refs.get(branch); sha; ) {
      const c = this.commits.get(sha)!;
      out.push(c.message);
      sha = c.parents[0];
    }
    return out;
  }

  /** Changed paths of each commit, head first (for asserting what a push wrote). */
  commitPaths(branch = this.defaultBranch): { message: string; paths: string[] }[] {
    const out: { message: string; paths: string[] }[] = [];
    for (let sha = this.refs.get(branch); sha; ) {
      const c = this.commits.get(sha)!;
      const tree = this.trees.get(c.tree)!;
      const parent = c.parents[0] ? this.trees.get(this.commits.get(c.parents[0])!.tree)! : new Map<string, string>();
      const paths = new Set<string>();
      for (const [p, s] of tree) if (parent.get(p) !== s) paths.add(p);
      for (const p of parent.keys()) if (!tree.has(p)) paths.add(p);
      out.push({ message: c.message, paths: [...paths].sort() });
      sha = c.parents[0];
    }
    return out;
  }

  /** Commits directly on the branch (e.g. gym appending to formalized.md). null deletes. */
  async commitFiles(files: Record<string, string | Uint8Array | null>, message = 'external', branch = this.defaultBranch): Promise<string> {
    const head = this.refs.get(branch);
    const base = head ? this.trees.get(this.commits.get(head)!.tree)! : new Map<string, string>();
    const next = new Map(base);
    for (const [p, v] of Object.entries(files)) {
      if (v === null) next.delete(p);
      else next.set(p, await this.putBlob(typeof v === 'string' ? enc.encode(v) : v));
    }
    const tree = await this.putTree(next);
    const sha = await this.putCommit({ tree, parents: head ? [head] : [], message });
    this.refs.set(branch, sha);
    return sha;
  }

  isAncestor(ancestor: string, sha: string): boolean {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop()!;
      if (s === ancestor) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      const c = this.commits.get(s);
      if (c) stack.push(...c.parents);
    }
    return false;
  }
}

export interface FakeRequest {
  method: string;
  path: string;
}

export class FakeGitHub {
  readonly repos = new Map<string, FakeRepo>();
  readonly requests: FakeRequest[] = [];
  /** path prefix the API is served under (e.g. "/github" in the e2e server) */
  readonly prefix: string;
  /** make the next N requests fail as if the network were down */
  networkDown = false;

  constructor(opts: { prefix?: string } = {}) {
    this.prefix = (opts.prefix ?? '').replace(/\/+$/, '');
  }

  async createRepo(fullName: string, init: FakeRepoInit): Promise<FakeRepo> {
    const repo = new FakeRepo(fullName, init);
    this.repos.set(fullName.toLowerCase(), repo);
    await repo.commitFiles(init.files ?? { 'README.md': '# gym\n' }, 'Initial commit');
    return repo;
  }

  repo(fullName: string): FakeRepo | undefined {
    return this.repos.get(fullName.toLowerCase());
  }

  /** fetch-compatible entry point. */
  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (this.networkDown) throw new TypeError('Failed to fetch');
    const headers: Record<string, string> = {};
    const h = init.headers;
    if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    else if (Array.isArray(h)) for (const [k, v] of h) headers[k.toLowerCase()] = v;
    else if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    const b = init.body;
    let body: string | Uint8Array | undefined;
    if (typeof b === 'string') body = b;
    else if (b instanceof Uint8Array) body = b;
    else if (b instanceof ArrayBuffer) body = new Uint8Array(b);
    else if (b instanceof Blob) body = new Uint8Array(await b.arrayBuffer());
    return this.handle(init.method ?? 'GET', input, headers, body);
  };

  async handle(method: string, url: string, headers: Record<string, string>, rawBody?: string | Uint8Array): Promise<Response> {
    const u = new URL(url, 'http://fake.local');
    let path = u.pathname;
    if (this.prefix && path.startsWith(this.prefix)) path = path.slice(this.prefix.length);
    this.requests.push({ method, path: path + u.search });

    const m = /^\/(repos|lfs)\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) return json(404, { message: 'Not Found' });
    const repo = this.repo(`${decodeURIComponent(m[2])}/${decodeURIComponent(m[3])}`);
    if (!repo) return json(404, { message: 'Not Found' });
    const extra: Record<string, string> = { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) };
    if (repo.tokenExpiry) extra['github-authentication-token-expiration'] = repo.tokenExpiry;
    const auth = headers['authorization'] ?? '';
    const token = auth.replace(/^(Bearer|token|Basic)\s+/i, '');
    const basicToken = /^Basic /i.test(auth) ? safeAtob(token).split(':').pop() ?? '' : token;
    if (!repo.tokens.has(basicToken)) return json(401, { message: 'Bad credentials' });
    const rest = m[4] ?? '';
    const bytes = typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody;
    const isJson = !(m[1] === 'lfs' && method === 'PUT');
    const body = isJson && bytes?.length ? (JSON.parse(dec.decode(bytes)) as Record<string, unknown>) : {};
    try {
      if (m[1] === 'lfs') return await this.lfs(repo, method, rest, body, extra, bytes, u.origin + this.prefix);
      return await this.route(repo, method, rest, u.searchParams, body, extra);
    } catch (err) {
      return json(500, { message: String((err as Error)?.message ?? err) }, extra);
    }
  }

  private async route(repo: FakeRepo, method: string, rest: string, q: URLSearchParams, body: Record<string, unknown>, extra: Record<string, string>): Promise<Response> {
    const ok = (data: unknown, status = 200) => json(status, data, extra);
    const writable = () => repo.push;
    if (method === 'GET' && rest === '') {
      return ok({
        full_name: repo.fullName,
        default_branch: repo.defaultBranch,
        private: true,
        permissions: { admin: false, maintain: false, push: repo.push, triage: repo.push, pull: true },
      });
    }
    let r: RegExpExecArray | null;
    if (method === 'GET' && (r = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      const sha = repo.refs.get(decodeURIComponent(r[1]));
      if (!sha) return json(404, { message: 'Not Found' }, extra);
      return ok({ ref: `refs/heads/${decodeURIComponent(r[1])}`, object: { sha, type: 'commit' } });
    }
    if (method === 'GET' && (r = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest))) {
      const c = repo.commits.get(r[1]);
      if (!c) return json(404, { message: 'Not Found' }, extra);
      return ok({ sha: r[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message });
    }
    if (method === 'GET' && (r = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest))) {
      const t = repo.trees.get(r[1]);
      if (!t) return json(404, { message: 'Not Found' }, extra);
      const dirs = new Set<string>();
      const tree: { path: string; mode: string; type: string; sha: string; size?: number }[] = [];
      for (const [p, sha] of t) {
        const segs = p.split('/');
        for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
        tree.push({ path: p, mode: '100644', type: 'blob', sha, size: repo.blobs.get(sha)!.length });
      }
      for (const d of dirs) tree.push({ path: d, mode: '040000', type: 'tree', sha: 'dir' });
      if (q.get('recursive') !== '1') {
        return ok({ sha: r[1], truncated: false, tree: tree.filter((e) => !e.path.includes('/')) });
      }
      return ok({ sha: r[1], truncated: false, tree: tree.sort((a, b) => (a.path < b.path ? -1 : 1)) });
    }
    if (method === 'GET' && (r = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest))) {
      const b = repo.blobs.get(r[1]);
      if (!b) return json(404, { message: 'Not Found' }, extra);
      return ok({ sha: r[1], size: b.length, encoding: 'base64', content: toBase64(b).replace(/(.{60})/g, '$1\n') });
    }
    if (method === 'GET' && (r = /^\/contents\/(.+)$/.exec(rest))) {
      const path = r[1].split('/').map(decodeURIComponent).join('/');
      const b = repo.files(q.get('ref') ?? repo.defaultBranch).get(path);
      if (!b) return json(404, { message: 'Not Found' }, extra);
      return ok({ type: 'file', path, sha: await blobSha(b), size: b.length, encoding: 'base64', content: toBase64(b) });
    }
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      if (!writable()) return json(403, { message: 'Resource not accessible by personal access token' }, extra);
    }
    if (method === 'POST' && rest === '/git/blobs') {
      const content = body.encoding === 'base64' ? fromBase64(String(body.content)) : enc.encode(String(body.content));
      repo.blobsCreated++;
      return ok({ sha: await repo.putBlob(content) }, 201);
    }
    if (method === 'POST' && rest === '/git/trees') {
      const base = body.base_tree ? repo.trees.get(String(body.base_tree)) : new Map<string, string>();
      if (!base) return json(422, { message: 'Invalid tree info' }, extra);
      const next = new Map(base);
      for (const e of (body.tree as { path: string; sha: string | null }[]) ?? []) {
        if (e.sha === null) {
          if (!next.has(e.path)) return json(422, { message: `GitRPC::BadObjectState: ${e.path} does not exist` }, extra);
          next.delete(e.path);
        } else {
          if (!repo.blobs.has(e.sha)) return json(422, { message: `Invalid sha for ${e.path}` }, extra);
          next.set(e.path, e.sha);
        }
      }
      return ok({ sha: await repo.putTree(next) }, 201);
    }
    if (method === 'POST' && rest === '/git/commits') {
      const tree = String(body.tree);
      const parents = (body.parents as string[]) ?? [];
      if (!repo.trees.has(tree) || parents.some((p) => !repo.commits.has(p))) return json(422, { message: 'Invalid commit' }, extra);
      return ok({ sha: await repo.putCommit({ tree, parents, message: String(body.message) }) }, 201);
    }
    if (method === 'PATCH' && (r = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      const branch = decodeURIComponent(r[1]);
      if (repo.beforeRefUpdate) {
        const hook = repo.beforeRefUpdate;
        repo.beforeRefUpdate = undefined;
        await hook();
      }
      const cur = repo.refs.get(branch);
      const sha = String(body.sha);
      if (!cur) return json(422, { message: 'Reference does not exist' }, extra);
      if (!repo.commits.has(sha)) return json(422, { message: 'Object does not exist' }, extra);
      if (repo.rejectRefUpdates > 0 || (!body.force && !repo.isAncestor(cur, sha))) {
        if (repo.rejectRefUpdates > 0) repo.rejectRefUpdates--;
        repo.conflicts++;
        return json(422, { message: 'Update is not a fast forward' }, extra);
      }
      repo.refs.set(branch, sha);
      repo.refUpdates++;
      return ok({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
    }
    return json(404, { message: 'Not Found' }, extra);
  }

  /** Minimal Git LFS batch API (for the LFS client's unit tests). */
  private async lfs(repo: FakeRepo, method: string, rest: string, body: Record<string, unknown>, extra: Record<string, string>, bytes: Uint8Array | undefined, base: string): Promise<Response> {
    const href = (oid: string) => `${base}/lfs/${repo.fullName}/objects/${oid}`;
    if (method === 'POST' && rest === '/objects/batch') {
      const op = String(body.operation);
      const objects = ((body.objects as { oid: string; size: number }[]) ?? []).map((o) => {
        const have = repo.lfs.has(o.oid);
        if (op === 'upload') return have ? { oid: o.oid, size: o.size } : { oid: o.oid, size: o.size, actions: { upload: { href: href(o.oid) } } };
        return have ? { oid: o.oid, size: o.size, actions: { download: { href: href(o.oid) } } } : { oid: o.oid, size: o.size, error: { code: 404, message: 'Object does not exist' } };
      });
      return json(200, { transfer: 'basic', objects }, { ...extra, 'content-type': 'application/vnd.git-lfs+json' });
    }
    const r = /^\/objects\/([0-9a-f]{64})$/.exec(rest);
    if (r && method === 'PUT') {
      repo.lfs.set(r[1], bytes ? bytes.slice() : new Uint8Array());
      return json(200, {}, extra);
    }
    if (r && method === 'GET') {
      const b = repo.lfs.get(r[1]);
      if (!b) return json(404, { message: 'Not Found' }, extra);
      return new Response(b as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    return json(404, { message: 'Not Found' }, extra);
  }
}

function safeAtob(s: string): string {
  try {
    return atob(s);
  } catch {
    return '';
  }
}

function json(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
