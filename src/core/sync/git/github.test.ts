import { describe, expect, it } from 'vitest';
import { GitHubRemote, parseRepo } from './github';
import { AuthError, ConflictError, GitRemoteError, NotFoundError, RemoteFileTooLargeError, base64ToBytes, bytesToBase64, gitBlobSha } from './remote';
import { mockFetch, type MockReply } from './testFetch';
import { FakeGitHub } from './fakeGitHub';
import { WriteScopeError } from '../scope';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const R = '/repos/me/gym';

describe('GitHubRemote (R4, R8)', () => {
  it('reads head, tree and blobs with the right headers (custom base URL)', async () => {
    const { fetch, calls } = mockFetch([
      ['GET', '/api/v3/repos/me/gym/git/ref/heads/main', () => ({ json: { object: { sha: 'c1' } } })],
      ['GET', '/api/v3/repos/me/gym/git/commits/c1', () => ({ json: { tree: { sha: 't1' } } })],
      [
        'GET',
        '/api/v3/repos/me/gym/git/trees/t1?recursive=1',
        () => ({ json: { truncated: false, tree: [{ path: 'journal', type: 'tree', sha: 'td' }, { path: 'journal/todo.yjs', type: 'blob', sha: 'b1', size: 5 }, { path: 'README.md', type: 'blob', sha: 'b2', size: 7 }] } }),
      ],
      ['GET', '/api/v3/repos/me/gym/git/blobs/b1', () => ({ json: { encoding: 'base64', content: bytesToBase64(bytes('hello')).replace(/(.{2})/g, '$1\n') } })],
    ]);
    const gh = new GitHubRemote({ token: 'github_pat_TOKEN', repo: 'me/gym', branch: 'main', baseUrl: 'https://ghe.example/api/v3/', fetch });
    expect(await gh.getHead()).toEqual({ commitSha: 'c1', treeSha: 't1' });
    expect(calls[0].url).toBe('https://ghe.example/api/v3/repos/me/gym/git/ref/heads/main');
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer github_pat_TOKEN', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    expect(await gh.listTree('t1')).toEqual([
      { path: 'journal/todo.yjs', sha: 'b1', size: 5 },
      { path: 'README.md', sha: 'b2', size: 7 },
    ]);
    expect(text(await gh.getBlob('b1'))).toBe('hello');
    expect(gh.id).toBe('github:https://ghe.example/api/v3/me/gym#main');
  });

  it('defaults to https://api.github.com', async () => {
    const { fetch, calls } = mockFetch([['GET', `${R}/git/ref/heads/main`, () => ({ status: 404, json: {} })]]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    expect(await gh.getHead()).toBeNull();
    expect(calls[0].url).toBe('https://api.github.com/repos/me/gym/git/ref/heads/main');
  });

  it('walks subtrees when the recursive listing is truncated', async () => {
    const { fetch } = mockFetch([
      ['GET', `${R}/git/trees/root?recursive=1`, () => ({ json: { truncated: true, tree: [] } })],
      ['GET', `${R}/git/trees/root`, () => ({ json: { tree: [{ path: 'a', type: 'tree', sha: 'A' }, { path: 'x.md', type: 'blob', sha: 'X', size: 1 }] } })],
      ['GET', `${R}/git/trees/A`, () => ({ json: { tree: [{ path: 'b', type: 'tree', sha: 'B' }, { path: 'y', type: 'blob', sha: 'Y', size: 2 }] } })],
      ['GET', `${R}/git/trees/B`, () => ({ json: { tree: [{ path: 'z', type: 'blob', sha: 'Z', size: 3 }] } })],
    ]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    const tree = await gh.listTree('root');
    expect(Object.fromEntries(tree.map((e) => [e.path, e.sha]))).toEqual({ 'x.md': 'X', 'a/y': 'Y', 'a/b/z': 'Z' });
  });

  it('pushes a chain of commits with one ref update, never forced (R8)', async () => {
    const files = [
      { path: 'library/settings.json', content: bytes('{}') },
      { path: 'journal/queue.md', content: bytes('# Queue\n') },
      { path: 'journal/old.md', content: null },
    ];
    const shas = await Promise.all(files.slice(0, 2).map((f) => gitBlobSha(f.content!)));
    let treeN = 0;
    let commitN = 0;
    const { fetch, calls } = mockFetch([
      ['GET', `${R}/git/commits/p1`, () => ({ json: { tree: { sha: 'pt1' } } })],
      ['POST', `${R}/git/blobs`, (c) => ({ status: 201, json: { sha: shas[files.findIndex((f) => f.content && bytesToBase64(f.content) === c.body.content)] } })],
      ['POST', `${R}/git/trees`, () => ({ status: 201, json: { sha: 'nt' + ++treeN } })],
      ['POST', `${R}/git/commits`, () => ({ status: 201, json: { sha: 'nc' + ++commitN } })],
      ['PATCH', `${R}/git/refs/heads/feature/notes`, () => ({ json: { object: { sha: 'nc2' } } })],
    ]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'feature/notes', fetch });
    const head = await gh.commit(
      [
        { message: 'library: Update settings', files: [files[0]] },
        { message: 'journal: Update queue', files: [files[1], files[2]] },
      ],
      'p1',
    );
    expect(head).toEqual({ commitSha: 'nc2', treeSha: 'nt2' });
    const trees = calls.filter((c) => c.url.endsWith('/git/trees'));
    expect(trees[0].body).toEqual({ base_tree: 'pt1', tree: [{ path: 'library/settings.json', mode: '100644', type: 'blob', sha: shas[0] }] });
    expect(trees[1].body).toEqual({
      base_tree: 'nt1',
      tree: [
        { path: 'journal/queue.md', mode: '100644', type: 'blob', sha: shas[1] },
        { path: 'journal/old.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    const commits = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/commits'));
    expect(commits.map((c) => c.body)).toEqual([
      { message: 'library: Update settings', tree: 'nt1', parents: ['p1'] },
      { message: 'journal: Update queue', tree: 'nt2', parents: ['nc1'] },
    ]);
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ sha: 'nc2', force: false });
  });

  it('refuses to write outside journal/ and library/ before sending anything (R5)', async () => {
    const { fetch, calls } = mockFetch([]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    for (const path of ['README.md', 'math/notes.md', 'journal/../README.md', 'journal/formalized.md', '/journal/x.md']) {
      await expect(gh.commit([{ message: 'journal: x', files: [{ path, content: bytes('x') }] }], 'p')).rejects.toBeInstanceOf(WriteScopeError);
    }
    expect(calls).toHaveLength(0);
  });

  it('maps a rejected (non-fast-forward) ref update to ConflictError', async () => {
    const sha = await gitBlobSha(bytes('x'));
    const { fetch } = mockFetch([
      ['GET', `${R}/git/commits/p1`, () => ({ json: { tree: { sha: 'pt1' } } })],
      ['POST', `${R}/git/blobs`, () => ({ status: 201, json: { sha } })],
      ['POST', `${R}/git/trees`, () => ({ status: 201, json: { sha: 'nt' } })],
      ['POST', `${R}/git/commits`, () => ({ status: 201, json: { sha: 'nc' } })],
      ['PATCH', `${R}/git/refs/heads/main`, () => ({ status: 422, json: { message: 'Update is not a fast forward' } })],
    ]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    await expect(gh.commit([{ message: 'journal: x', files: [{ path: 'journal/f', content: bytes('x') }] }], 'p1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps GitHub\'s "input too large" blob rejection to RemoteFileTooLargeError', async () => {
    const { fetch } = mockFetch([['POST', `${R}/git/blobs`, () => ({ status: 422, json: { message: 'Sorry, your input was too large to process.' } })]]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    const err = await gh.commit([{ message: 'library: x', files: [{ path: 'library/books/a/book.pdf', content: bytes('x') }] }], 'p1').catch((e) => e);
    expect(err).toBeInstanceOf(RemoteFileTooLargeError);
    expect(err.path).toBe('library/books/a/book.pdf');
  });

  it('reads the repository permissions (R4 write-access check)', async () => {
    const { fetch } = mockFetch([['GET', R, () => ({ json: { full_name: 'me/gym', default_branch: 'main', private: true, permissions: { push: false, pull: true } } })]]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch });
    expect(await gh.getRepo()).toEqual({ fullName: 'me/gym', defaultBranch: 'main', private: true, canPush: false, canPull: true });
  });

  it('reads the token expiry from the response headers (R4)', async () => {
    const seen: number[] = [];
    const { fetch } = mockFetch([['GET', R, () => ({ json: { full_name: 'me/gym', default_branch: 'main', permissions: { push: true } }, headers: { 'github-authentication-token-expiration': '2026-11-04 10:00:00 UTC' } })]]);
    const gh = new GitHubRemote({ token: 't', repo: 'me/gym', branch: 'main', fetch, onTokenExpiry: (t) => seen.push(t) });
    await gh.getRepo();
    await gh.getRepo();
    expect(seen).toEqual([Date.UTC(2026, 10, 4, 10)]);
    expect(gh.tokenExpiry).toBe(Date.UTC(2026, 10, 4, 10));
  });

  it('backs off on rate limits and surfaces auth errors without leaking the token', async () => {
    let n = 0;
    const slept: number[] = [];
    const reset = Math.floor(Date.now() / 1000) + 5;
    const { fetch } = mockFetch([
      [
        'GET',
        `${R}/git/blobs/b`,
        (): MockReply =>
          ++n === 1
            ? { status: 403, json: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }
            : n === 2
              ? { status: 429, json: {}, headers: { 'retry-after': '2' } }
              : { json: { encoding: 'base64', content: bytesToBase64(bytes('ok')) }, headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(reset) } },
      ],
      ['GET', `${R}/git/blobs/denied`, () => ({ status: 401, json: { message: 'Bad credentials' } })],
      ['GET', `${R}/git/blobs/forbidden`, () => ({ status: 403, json: { message: 'Resource not accessible by personal access token' } })],
      ['GET', `${R}/git/blobs/missing`, () => ({ status: 404, json: { message: 'Not Found' } })],
      ['GET', `${R}/git/blobs/slow`, () => ({ status: 429, json: {}, headers: { 'retry-after': '3600' } })],
    ]);
    const gh = new GitHubRemote({ token: 'github_pat_SECRET', repo: 'me/gym', branch: 'main', fetch, sleep: async (ms) => void slept.push(ms) });
    expect(text(await gh.getBlob('b'))).toBe('ok');
    expect(slept).toHaveLength(2);
    expect(slept[0]).toBeGreaterThan(3000);
    expect(slept[1]).toBe(2000);
    expect(gh.rateLimit?.remaining).toBe(4999);

    const denied = await gh.getBlob('denied').catch((e) => e);
    expect(denied).toBeInstanceOf(AuthError);
    expect(denied.status).toBe(401);
    expect(String(denied.message)).not.toContain('github_pat_SECRET');
    expect(await gh.getBlob('forbidden').catch((e) => e)).toBeInstanceOf(AuthError);
    expect(await gh.getBlob('missing').catch((e) => e)).toBeInstanceOf(NotFoundError);

    const slow = await gh.getBlob('slow').catch((e) => e);
    expect(slow).toBeInstanceOf(GitRemoteError);
    expect(slow.retryAt).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('base64 helpers handle large binary payloads', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it('parses repository input', () => {
    expect(parseRepo('me/gym')).toEqual({ owner: 'me', name: 'gym' });
    expect(parseRepo(' https://github.com/me/gym.git ')).toEqual({ owner: 'me', name: 'gym' });
    expect(parseRepo('me')).toBeNull();
    expect(parseRepo('me/gym/extra')).toBeNull();
  });
});

describe('GitHubRemote against the in-memory GitHub', () => {
  it('round-trips files, enforces fast-forward and token checks', async () => {
    const gh = new FakeGitHub();
    const repo = await gh.createRepo('me/gym', { tokens: ['good'], files: { 'README.md': '# gym\n', 'math/README.md': '# Math\n' } });
    const remote = new GitHubRemote({ token: 'good', repo: 'me/gym', branch: 'main', fetch: gh.fetch });
    const head = (await remote.getHead())!;
    expect((await remote.listTree(head.treeSha)).map((e) => e.path).sort()).toEqual(['README.md', 'math/README.md']);

    const h2 = await remote.commit(
      [
        { message: 'library: Add settings', files: [{ path: 'library/settings.json', content: bytes('{}\n') }] },
        { message: 'journal: Add queue', files: [{ path: 'journal/queue.md', content: bytes('# Queue\n') }] },
      ],
      head.commitSha,
    );
    expect(repo.refUpdates).toBe(1);
    expect(repo.log()).toEqual(['journal: Add queue', 'library: Add settings', 'Initial commit']);
    expect(repo.text('journal/queue.md')).toBe('# Queue\n');

    // a stale parent is rejected (another device pushed first)
    await repo.commitFiles({ 'math/README.md': '# Mathematics\n' }, 'math: Rename');
    await expect(remote.commit([{ message: 'journal: x', files: [{ path: 'journal/queue.md', content: bytes('x') }] }], h2.commitSha)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.text('journal/queue.md')).toBe('# Queue\n');

    const bad = new GitHubRemote({ token: 'bad', repo: 'me/gym', branch: 'main', fetch: gh.fetch });
    await expect(bad.getHead()).rejects.toBeInstanceOf(AuthError);
  });
});
