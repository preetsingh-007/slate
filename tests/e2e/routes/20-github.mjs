// Mocked GitHub API for the sync e2e tests (R4, R10), served under /github. It is the same
// in-memory GitHub the unit tests use (src/core/sync/git/fakeGitHub.ts, loaded by Node with
// type stripping). Tests create their own repository through the control endpoints:
//   POST /github/__setup   { repo, tokens, files?, push?, tokenExpiry? }
//   POST /github/__config  { repo, tokens?, tokenExpiry?, networkDown? }
//   GET  /github/__files?repo=owner/name   → { path: text } of the default branch
//   GET  /github/__log?repo=owner/name     → commit messages, newest first
// Loading a .ts module needs Node's type stripping (on by default from Node 22.18; CI uses 22).
let gh;
try {
  const { FakeGitHub } = await import('../../../src/core/sync/git/fakeGitHub.ts');
  gh = new FakeGitHub({ prefix: '/github' });
} catch (err) {
  console.error(`[e2e server] mocked GitHub unavailable (needs Node >= 22.18 or --experimental-strip-types): ${err?.message ?? err}`);
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new Uint8Array(Buffer.concat(chunks));
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handle(req, res, url) {
  if (!url.pathname.startsWith('/github/')) return false;
  if (!gh) return json(res, 500, { message: 'mocked GitHub unavailable: run the e2e server on Node >= 22.18' }), true;
  const p = url.pathname;
  if (p === '/github/__setup' && req.method === 'POST') {
    const b = JSON.parse(new TextDecoder().decode(await body(req)));
    await gh.createRepo(b.repo, { tokens: b.tokens ?? ['tok'], files: b.files, push: b.push, tokenExpiry: b.tokenExpiry });
    return json(res, 200, { ok: true }), true;
  }
  if (p === '/github/__config' && req.method === 'POST') {
    const b = JSON.parse(new TextDecoder().decode(await body(req)));
    const repo = gh.repo(b.repo);
    if (!repo) return json(res, 404, { message: 'no repo' }), true;
    if (b.tokens) repo.tokens = new Set(b.tokens);
    if ('tokenExpiry' in b) repo.tokenExpiry = b.tokenExpiry;
    return json(res, 200, { ok: true }), true;
  }
  if ((p === '/github/__files' || p === '/github/__log') && req.method === 'GET') {
    const repo = gh.repo(url.searchParams.get('repo') ?? '');
    if (!repo) return json(res, 404, { message: 'no repo' }), true;
    if (p === '/github/__log') return json(res, 200, repo.log()), true;
    const out = {};
    for (const [path, bytes] of repo.files()) out[path] = new TextDecoder().decode(bytes);
    return json(res, 200, out), true;
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req);
  const r = await gh.handle(req.method, url.href, headers, raw);
  const out = {};
  r.headers.forEach((v, k) => (out[k] = v));
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
  return true;
}
