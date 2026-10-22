// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MAX_BYTES, TIMEOUT_MS, checkUrl, handle, isPrivateIp, type Env } from './index';

const env: Env = { SLATE_KEY: 'secret', ALLOWED_ORIGINS: 'https://app.example' };
const publicDns = async () => ['93.184.216.34'];

function req(url: string, init: RequestInit & { key?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.key !== null) headers.set('X-Slate-Key', init.key ?? 'secret');
  headers.set('Origin', 'https://app.example');
  return new Request(`https://helper.example/?url=${encodeURIComponent(url)}`, { method: init.method ?? 'GET', headers });
}

describe('fetch helper', () => {
  it('requires the secret header', async () => {
    const res = await handle(req('https://example.com', { key: null }), env, fetch, publicDns);
    expect(res.status).toBe(401);
    const wrong = await handle(req('https://example.com', { key: 'nope!!' }), env, fetch, publicDns);
    expect(wrong.status).toBe(401);
  });

  it('allows GET only', async () => {
    const res = await handle(req('https://example.com', { method: 'POST' }), env, fetch, publicDns);
    expect(res.status).toBe(405);
  });

  it('refuses non-http schemes and private addresses', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://[::1]/', 'http://localhost:8080/', 'http://2130706433/', 'http://0x7f000001/', 'http://169.254.169.254/latest', 'http://printer/', 'http://user:pw@example.com/']) {
      expect(await checkUrl(u, publicDns), u).not.toBeNull();
    }
    expect(await checkUrl('https://example.com/a', publicDns)).toBeNull();
    expect(await checkUrl('https://evil.example/', async () => ['192.168.1.5'])).toMatch(/private/);
    expect(await checkUrl('https://evil6.example/', async () => ['fd00::1'])).toMatch(/private/);
  });

  it('refuses IPv6 forms that embed a private IPv4 address (L8)', async () => {
    for (const u of ['http://[::127.0.0.1]/', 'http://[::7f00:1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[2002:c0a8:101::1]/', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', 'http://[::]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[64:ff9b::a00:1]/', 'http://[fec0::1]/', 'http://0177.0.0.1/', 'http://127.1/']) {
      expect(await checkUrl(u, publicDns), u).not.toBeNull();
    }
    expect(await checkUrl('https://evil6.example/', async () => ['::a00:1'])).toMatch(/private/);
    expect(await checkUrl('https://evil6.example/', async () => ['2002:a00:1::'])).toMatch(/private/);
    expect(await checkUrl('http://[2606:4700:4700::1111]/', publicDns)).toBeNull();
  });

  it('classifies addresses', () => {
    expect(isPrivateIp('::a.b.c.d')).toBe(true); // unparseable: refused
    expect(isPrivateIp('::7f00:1')).toBe(true);
    expect(isPrivateIp('2001::1')).toBe(true);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('fetches a page and reports the final URL after redirects, re-checking each hop', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url === 'https://a.example/') return new Response(null, { status: 301, headers: { Location: '/b' } });
      return new Response('<html>hi</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }) as typeof fetch;
    const res = await handle(req('https://a.example/'), env, fetcher, publicDns);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Final-Url')).toBe('https://a.example/b');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(await res.text()).toBe('<html>hi</html>');
    expect(calls).toEqual(['https://a.example/', 'https://a.example/b']);

    const toPrivate = (async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } })) as unknown as typeof fetch;
    expect((await handle(req('https://a.example/'), env, toPrivate, publicDns)).status).toBe(403);
  });

  it('enforces the size limit', async () => {
    const big = (async () => new Response(new Uint8Array(MAX_BYTES + 1), { status: 200 })) as unknown as typeof fetch;
    expect((await handle(req('https://a.example/'), env, big, publicDns)).status).toBe(413);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const pre = await handle(req('https://a.example/', { method: 'OPTIONS', key: null }), env, fetch, publicDns);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toBe('X-Slate-Key');
  });

  // fetch helper NFR: GET over http(s) only; private addresses refused; 10 MB and 15 s limits;
  // a secret header; no content logged; the site sees the URL and nothing of the person
  it('stops at 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      const hang = ((_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
      const pending = handle(req('https://slow.example/'), env, hang, publicDns);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      let done = false;
      void pending.then(() => (done = true));
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe(504);
      expect(TIMEOUT_MS).toBe(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a body without Content-Length at 10 MB, and follows at most 5 redirects', async () => {
    expect(MAX_BYTES).toBe(10 * 1024 * 1024);
    const stream = (async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(1024 * 1024));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    expect((await handle(req('https://a.example/'), env, stream, publicDns)).status).toBe(413);
    let n = 0;
    const loop = (async () => new Response(null, { status: 302, headers: { Location: `/r${n++}` } })) as unknown as typeof fetch;
    expect((await handle(req('https://a.example/'), env, loop, publicDns)).status).toBe(508);
    expect(n).toBe(6);
  });

  it('logs nothing and passes nothing of the request on to the site', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    let sent: Headers | undefined;
    const fetcher = (async (_u: string, init: RequestInit) => {
      sent = new Headers(init.headers);
      return new Response('<p>secret page content</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }) as unknown as typeof fetch;
    const r = new Request('https://helper.example/?url=https%3A%2F%2Fa.example%2F', { headers: { 'X-Slate-Key': 'secret', Origin: 'https://app.example', Cookie: 'session=1', Authorization: 'token abc', Referer: 'https://app.example/' } });
    expect((await handle(r, env, fetcher, publicDns)).status).toBe(200);
    const names: string[] = [];
    sent!.forEach((_v, k) => names.push(k));
    expect(names.sort()).toEqual(['accept', 'user-agent']);
    await handle(req('http://127.0.0.1/'), env, fetcher, publicDns);
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
