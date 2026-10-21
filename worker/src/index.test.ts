// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_BYTES, checkUrl, handle, isPrivateIp, type Env } from './index';

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

  it('classifies addresses', () => {
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
});
