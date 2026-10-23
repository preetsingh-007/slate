/**
 * The demo's local stand-ins for the network, on one port: a mocked GitHub API (the in-memory
 * GitHub the sync tests use, src/core/sync/git/fakeGitHub.ts) holding the demo gym repository,
 * and the fake fetch helper of the e2e tests (tests/e2e/routes/30-library.mjs) with the demo's
 * own article added. Nothing here reaches the internet.
 */
import { createServer } from 'node:http';
import { FakeGitHub } from '../../../src/core/sync/git/fakeGitHub.ts';
import * as library from '../../../tests/e2e/routes/30-library.mjs';

export const DEMO_REPO = 'preetsingh-007/gym';
export const DEMO_BRANCH = 'claude/stoic-pascal-tk33n8';
/** An obviously fake token: only this mocked GitHub accepts it. */
export const DEMO_TOKEN = 'github_pat_DEMO_0000000000_not_a_real_token_0000000000';
export const HELPER_KEY = library.HELPER_KEY;

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new Uint8Array(Buffer.concat(chunks));
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Starts the server; `pages` are extra pages for the fetch helper (URL → { type, body }). */
export async function startServer({ port, gymFiles, pages = {} }) {
  const gh = new FakeGitHub({ prefix: '/github' });
  const expiry = new Date(Date.now() + 90 * 86_400_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const reset = () => gh.createRepo(DEMO_REPO, { tokens: [DEMO_TOKEN], files: gymFiles, branch: DEMO_BRANCH, tokenExpiry: expiry });
  await reset();

  /** Local pages for the recorder (a host page for the phone frame), path → HTML. */
  const html = {};
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://localhost:${port}`);
    if (process.env.DEMO_LOG && url.pathname.startsWith('/helper')) console.log('[helper]', url.searchParams.get('url'));
    try {
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (html[url.pathname]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html[url.pathname]);
        return;
      }
      // control endpoints for the recorder
      if (url.pathname === '/github/__demo/reset' && req.method === 'POST') {
        await reset();
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/github/__demo/commit' && req.method === 'POST') {
        const b = JSON.parse(new TextDecoder().decode(await body(req)));
        await gh.repo(DEMO_REPO).commitFiles(b.files, b.message ?? 'gym: update');
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/github/__demo/file' && req.method === 'GET') {
        return json(res, 200, { text: gh.repo(DEMO_REPO).text(url.searchParams.get('path') ?? '') ?? null });
      }
      if (url.pathname.startsWith('/github/')) {
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req);
        const r = await gh.handle(req.method, url.href, headers, raw);
        const out = {};
        r.headers.forEach((v, k) => (out[k] = v));
        res.writeHead(r.status, out);
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      // the fetch helper: the demo's own pages, then the e2e fixture web
      if ((url.pathname === '/helper/' || url.pathname === '/helper') && pages[url.searchParams.get('url') ?? '']) {
        if (req.headers['x-slate-key'] !== HELPER_KEY) return json(res, 401, { error: 'Missing or wrong X-Slate-Key header.' });
        const target = url.searchParams.get('url');
        const page = pages[target];
        if (/html/.test(page.type)) await new Promise((r) => setTimeout(r, 120));
        res.writeHead(200, { 'Content-Type': page.type, 'X-Upstream-Status': '200', 'X-Final-Url': target, 'Cache-Control': 'no-store' });
        res.end(page.body);
        return;
      }
      if (await library.handle(req, res, url)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err?.stack ?? err));
    }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, gh, html, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}
