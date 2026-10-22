import { describe, expect, it, vi } from 'vitest';
import { lookupBib } from '../citations/enrich';
import { classifyHttpFailure, decodeText, FetchError, helperAsFetch, helperFetch, pageProblem } from './helper';
import { classifyUrl, fileNameFromUrl, isPdfResponse, isUrl, normalizeUrl, pdfLinkFromPage } from './links';
import { BOT_CHECK_HTML, LOGIN_HTML, PAYWALL_HTML, BLOG_HTML } from '../../../tests/e2e/fixtures/pages.mjs';

// The real fetch helper (worker/), imported by path so it stays out of the app's type project.
const WORKER = '../../../worker/src/index.ts';
type Handle = (req: Request, env: { SLATE_KEY: string; ALLOWED_ORIGINS?: string }, f: typeof fetch, resolve: (h: string) => Promise<string[]>) => Promise<Response>;
const { handle } = (await import(/* @vite-ignore */ WORKER)) as { handle: Handle };

const cfg = { helperUrl: 'https://helper.example.workers.dev', helperKey: 'secret' };

/** The real fetch helper (worker/) in front of a fake web. */
function helper(web: Record<string, Response | (() => Response)>) {
  const upstream = vi.fn(async (url: string) => {
    const r = web[url];
    if (!r) return new Response('nope', { status: 404, headers: { 'Content-Type': 'text/html' } });
    return typeof r === 'function' ? r() : r.clone();
  });
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(String(input), init), { SLATE_KEY: 'secret', ALLOWED_ORIGINS: '*' }, upstream as unknown as typeof fetch, async () => ['93.184.216.34']),
  ) as unknown as typeof fetch;
  return { fetchFn, upstream };
}

describe('fetch helper client (L8, L10)', () => {
  it('requests GET <helper>/?url=… with X-Slate-Key and returns the upstream body', async () => {
    const h = helper({ 'https://site.example/a': new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) });
    const r = await helperFetch(cfg, 'https://site.example/a', { fetch: h.fetchFn });
    expect(new TextDecoder().decode(r.bytes)).toBe('<p>hi</p>');
    expect(r).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8', finalUrl: 'https://site.example/a' });
    const call = (h.fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call[0]).toBe('https://helper.example.workers.dev/?url=https%3A%2F%2Fsite.example%2Fa');
    expect((call[1].headers as Record<string, string>)['X-Slate-Key']).toBe('secret');
  });

  it('explains failures: not configured, wrong key, refused, upstream login/bot/paywall/404', async () => {
    await expect(helperFetch({}, 'https://x.example')).rejects.toMatchObject({ reason: 'not-configured', offerClipboard: false });
    const h = helper({
      'https://x.example/bot': new Response(BOT_CHECK_HTML, { status: 403, headers: { 'Content-Type': 'text/html' } }),
      'https://x.example/login': new Response(LOGIN_HTML, { status: 401, headers: { 'Content-Type': 'text/html' } }),
      'https://x.example/pay': new Response('x', { status: 402 }),
    });
    await expect(helperFetch({ ...cfg, helperKey: 'wrong' }, 'https://x.example/bot', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'helper-key' });
    await expect(helperFetch(cfg, 'http://127.0.0.1/admin', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'refused' });
    await expect(helperFetch(cfg, 'https://x.example/bot', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'bot-check', offerClipboard: true });
    await expect(helperFetch(cfg, 'https://x.example/login', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'login' });
    await expect(helperFetch(cfg, 'https://x.example/pay', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'paywall' });
    await expect(helperFetch(cfg, 'https://x.example/missing', { fetch: h.fetchFn })).rejects.toMatchObject({ reason: 'not-found' });
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(helperFetch(cfg, 'https://x.example/', { fetch: down })).rejects.toMatchObject({ reason: 'network' });
    expect(new FetchError('offline').message).toMatch(/offline/);
  });

  it('recognises problem pages served with status 200', () => {
    expect(pageProblem(BOT_CHECK_HTML)).toBe('bot-check');
    expect(pageProblem(LOGIN_HTML)).toBe('login');
    expect(pageProblem(PAYWALL_HTML)).toBe('paywall');
    expect(pageProblem(BLOG_HTML)).toBeNull();
    expect(classifyHttpFailure(500).reason).toBe('http');
  });

  it('decodes charsets', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeText(latin1, 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeText(new TextEncoder().encode('<meta charset="utf-8">é'))).toBe('<meta charset="utf-8">é');
  });

  it('enriches book metadata from a DOI through the helper only (L1)', async () => {
    const h = helper({
      'https://api.crossref.org/works/10.1000%2Fxyz': new Response(JSON.stringify({ message: { title: ['Linear Algebra Done Right'], author: [{ given: 'Sheldon', family: 'Axler' }], issued: { 'date-parts': [[2024]] }, type: 'book', DOI: '10.1000/xyz' } }), { headers: { 'Content-Type': 'application/json' } }),
    });
    const bib = await lookupBib({ doi: '10.1000/xyz' }, helperAsFetch(cfg, h.fetchFn));
    expect(bib).toMatchObject({ title: 'Linear Algebra Done Right', authors: ['Sheldon Axler'], year: 2024, entryType: 'book' });
    expect(h.upstream).toHaveBeenCalledWith('https://api.crossref.org/works/10.1000%2Fxyz', expect.anything());
  });
});

describe('special links (L10)', () => {
  it('classifies PDFs and arXiv abstract pages', () => {
    expect(classifyUrl('https://arxiv.org/abs/2401.01234v2')).toEqual({
      kind: 'arxiv-abs',
      url: 'https://arxiv.org/abs/2401.01234v2',
      arxiv: '2401.01234v2',
      pdfUrl: 'https://arxiv.org/pdf/2401.01234v2',
      htmlUrl: 'https://arxiv.org/html/2401.01234v2',
    });
    expect(classifyUrl('arxiv:hep-th/9901001').kind).toBe('arxiv-abs');
    expect(classifyUrl('https://arxiv.org/pdf/2401.01234')).toMatchObject({ kind: 'pdf', arxiv: '2401.01234' });
    expect(classifyUrl('https://example.org/papers/rank.PDF?dl=1')).toMatchObject({ kind: 'pdf' });
    expect(classifyUrl('https://example.org/post')).toMatchObject({ kind: 'page' });
    expect(classifyUrl('https://arxiv.org/html/2401.01234v1/')).toMatchObject({ kind: 'page' });
  });

  it('normalises input and detects pasted URLs (S9)', () => {
    expect(normalizeUrl('example.org/a b')).toBe('https://example.org/a%20b');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('hello world')).toBeNull();
    expect(isUrl(' https://example.org/x ')).toBe(true);
    expect(isUrl('see https://example.org')).toBe(false);
  });

  it('recognises PDF bodies, citation_pdf_url and file names', () => {
    expect(isPdfResponse('application/octet-stream', new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(isPdfResponse('text/html', new TextEncoder().encode('<html>'))).toBe(false);
    expect(pdfLinkFromPage('<meta name="citation_pdf_url" content="/pdf/1">', 'https://arxiv.org/abs/1')).toBe('https://arxiv.org/pdf/1');
    expect(fileNameFromUrl('https://arxiv.org/pdf/2401.01234v1')).toBe('2401.01234v1.pdf');
  });
});
