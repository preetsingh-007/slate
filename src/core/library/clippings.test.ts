// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SlateDB } from '../storage/idb';
import { AssetStore } from '../storage/assets';
import { LibraryStore } from '../stores/library';
import { uid } from '../util/ids';
import { ARXIV_CSS, ARXIV_HTML, BLOG_CSS, BLOG_HTML, BOT_CHECK_HTML, LOGIN_HTML, PAYWALL_HTML, PNG_BASE64 } from '../../../tests/e2e/fixtures/pages.mjs';
import { extractArticle } from './article';
import { detectFormat, detectSourceLabel, fromClipboard, normalizeMathDelimiters, titleFrom } from './clipboard';
import { clippingSlug, createClipboardClipping, createLinkClipping, fetchLink, invalidClippingLinks } from './clippings';
import { FetchError, type FetchedResource } from './helper';
import { buildSnapshot, documentText, pickSrcset, prepareSnapshotHtml, type ResourceFetcher } from './snapshot';

const png = () => Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));

/** A fake web: URL → resource, as the fetch helper would return it. */
function web(pages: Record<string, { body: string | Uint8Array; type: string; status?: number }>) {
  const calls: string[] = [];
  const fetchRes: ResourceFetcher = async (url) => {
    calls.push(url);
    const p = pages[url];
    if (!p) return null;
    return { bytes: typeof p.body === 'string' ? new TextEncoder().encode(p.body) : p.body, contentType: p.type, finalUrl: url };
  };
  const fetchUrl = async (url: string): Promise<FetchedResource> => {
    const p = pages[url];
    if (!p) throw new FetchError('not-found');
    return { status: p.status ?? 200, bytes: typeof p.body === 'string' ? new TextEncoder().encode(p.body) : p.body, contentType: p.type, finalUrl: url };
  };
  return { fetchRes, fetchUrl, calls };
}

async function deps() {
  const db = await SlateDB.open(`clip-${uid()}`);
  const assets = new AssetStore(db);
  return { library: await LibraryStore.open(db), assets: (b: Blob) => assets.put(b), store: assets };
}

describe('New from clipboard (L7)', () => {
  it('detects Markdown vs plain text', () => {
    expect(detectFormat('# Title\n\nBody')).toBe('markdown');
    expect(detectFormat('Euler: $e^{i\\pi}+1=0$')).toBe('markdown');
    expect(detectFormat('```py\nx=1\n```')).toBe('markdown');
    expect(detectFormat('- one\n- two\n\n**bold**')).toBe('markdown');
    expect(detectFormat('Dear Ada,\nthe price is $5 and $10.\nThanks')).toBe('plain');
    expect(detectFormat('Just a sentence.')).toBe('plain');
  });

  it('normalises ChatGPT \\( \\) and \\[ \\] delimiters, but not inside code', () => {
    expect(normalizeMathDelimiters('Let \\(x^2\\) be\n\\[ \\int f \\]\nand `\\(raw\\)`')).toBe('Let $x^2$ be\n\n$$\n\\int f\n$$\n\nand `\\(raw\\)`');
  });

  it('takes the title from the first heading or line', () => {
    expect(titleFrom('Intro line\n# Real **title**\nx')).toBe('Real title');
    expect(titleFrom('\n\n- **Eigenvalues** of [A](https://x.org)\n')).toBe('Eigenvalues of A');
    expect(titleFrom('x'.repeat(30) + ' ' + 'y'.repeat(60))).toBe('x'.repeat(30) + '…');
  });

  it('labels ChatGPT and Claude HTML', () => {
    expect(detectSourceLabel('<div class="markdown prose w-full">x</div>')).toBe('ChatGPT');
    expect(detectSourceLabel('<div class="font-claude-message">x</div>')).toBe('Claude');
    expect(detectSourceLabel('<p>x</p>')).toBeUndefined();
  });

  it('builds a clipping from HTML (Markdown with maths) or text', () => {
    const c = fromClipboard({
      html: '<div class="markdown prose"><h2>Rank</h2><p>The rank of <span class="katex"><span class="katex-mathml"><math><semantics><mi>A</mi><annotation encoding="application/x-tex">A</annotation></semantics></math></span><span class="katex-html">A</span></span> is its column dimension.</p></div>',
      text: 'Rank\nThe rank of A is its column dimension.',
    })!;
    expect(c).toEqual({ markdown: '## Rank\n\nThe rank of $A$ is its column dimension.', format: 'markdown', title: 'Rank', sourceLabel: 'ChatGPT' });
    const plain = fromClipboard({ html: '<meta charset="utf-8"><span>Call me at 5.</span>', text: 'Call me at 5.' })!;
    expect(plain).toMatchObject({ markdown: 'Call me at 5.', format: 'plain', title: 'Call me at 5.' });
    expect(fromClipboard({ text: '   ' })).toBeNull();
  });

  it('creates and stores a clipboard clipping quickly with a dated slug and content hash', async () => {
    const d = await deps();
    const t0 = performance.now();
    const c = (await createClipboardClipping(d, { text: '# Spectral theorem\n\n$$A = Q\\Lambda Q^T$$' }, Date.UTC(2026, 9, 21, 12)))!;
    expect(performance.now() - t0).toBeLessThan(500);
    expect(c).toMatchObject({ origin: 'clipboard', title: 'Spectral theorem', format: 'markdown', slug: '2026-10-21-spectral-theorem' });
    expect(c.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await d.library.clippingContent(c.id))?.markdown).toContain('Q\\Lambda Q^T');
    expect(clippingSlug('2026-10-21', 'Spectral theorem', ['2026-10-21-spectral-theorem'])).toBe('2026-10-21-spectral-theorem-2');
  });
});

describe('Readability extraction and link metadata (L8, L9)', () => {
  it('extracts an arXiv HTML paper with its maths and metadata', () => {
    const a = extractArticle(ARXIV_HTML, 'https://arxiv.org/html/2401.01234v1/')!;
    expect(a.title).toBe('Spectral Methods for Study Graphs');
    expect(a.author).toBe('Lovelace, Ada, Turing, Alan');
    expect(a.site).toBe('arXiv.org');
    expect(a.published).toBe('2024/01/05');
    expect(a.canonicalUrl).toBe('https://arxiv.org/abs/2401.01234v1');
    expect(a.contentHtml).toContain('alttext="L=D-A"');
    expect(a.textContent).toContain('Fiedler vector');
  });

  it('extracts a blog article: title, site, author, date, canonical URL', () => {
    const a = extractArticle(BLOG_HTML, 'https://blog.example/posts/spaced-repetition?utm=x')!;
    expect(a).toMatchObject({
      title: 'Why spaced repetition works',
      site: 'The Study Blog',
      author: 'Grace Hopper',
      published: '2026-09-30T08:00:00Z',
      canonicalUrl: 'https://blog.example/posts/spaced-repetition',
    });
    expect(a.contentHtml).not.toContain('<nav');
  });
});

describe('snapshot resources (L8)', () => {
  it('picks srcset candidates', () => {
    expect(pickSrcset('a.png 400w, b.png 800w, c.png 2400w')).toBe('b.png');
    expect(pickSrcset('a.png 1x, b.png 2x, c.png 3x')).toBe('b.png');
  });

  it('downloads images, stylesheets and their url() resources, rewriting them to assets/<hash>.<ext>', async () => {
    const site = 'https://arxiv.org';
    const w = web({
      [`${site}/static/ltx-article.css`]: { body: ARXIV_CSS, type: 'text/css; charset=utf-8' },
      [`${site}/static/fonts/ltx.woff2`]: { body: new Uint8Array([1, 2, 3]), type: 'font/woff2' },
      [`${site}/img/paper.png`]: { body: png(), type: 'image/png' },
      [`${site}/html/2401.01234v1/x1.png`]: { body: png(), type: 'application/octet-stream' },
    });
    const d = await deps();
    const stored = new Map<string, Blob>();
    const sink = async (b: Blob) => {
      const h = await d.assets(b);
      stored.set(h, b);
      return h;
    };
    const snap = await buildSnapshot(ARXIV_HTML, `${site}/html/2401.01234v1/`, w.fetchRes, sink);
    const css = snap.assets.find((a) => a.mime === 'text/css')!;
    expect(snap.html).toContain(`href="${css.path}"`);
    expect(snap.html).toMatch(/<img src="assets\/[0-9a-f]{64}\.png"/);
    expect(snap.html).toContain('href="https://example.org/data"');
    expect(snap.html).toContain('href="#S2"');
    const cssText = await stored.get(css.hash)!.text();
    expect(cssText).toMatch(/url\("[0-9a-f]{64}\.woff2"\)/);
    expect(cssText).toMatch(/url\('[0-9a-f]{64}\.png'\)/);
    expect(snap.assets.map((a) => a.path).every((p) => /^assets\/[0-9a-f]{64}\.(css|png|woff2)$/.test(p))).toBe(true);
  });

  it('settles lazy and responsive images, drops refresh and keeps scripts as assets', async () => {
    const site = 'https://blog.example';
    const w = web({
      [`${site}/static/blog.css`]: { body: BLOG_CSS, type: 'text/css' },
      [`${site}/img/curve-800.png`]: { body: png(), type: 'image/png' },
      [`${site}/img/lazy.png`]: { body: png(), type: 'image/png' },
      [`${site}/img/hero.png`]: { body: png(), type: 'image/png' },
      [`${site}/static/app.js`]: { body: 'document.title = "x"', type: 'application/javascript' },
    });
    const d = await deps();
    const snap = await buildSnapshot(BLOG_HTML, `${site}/posts/spaced-repetition`, w.fetchRes, d.assets);
    expect(w.calls).not.toContain(`${site}/img/curve-400.png`);
    expect(snap.html).not.toContain('srcset');
    expect(snap.html).not.toContain('http-equiv');
    expect(snap.html).toMatch(/background-image: url\("assets\/[0-9a-f]{64}\.png"\)/);
    expect(snap.html).toMatch(/<script src="assets\/[0-9a-f]{64}\.js"><\/script>/);
    // the same image bytes are stored once
    expect(new Set(snap.assets.filter((a) => a.mime === 'image/png').map((a) => a.hash)).size).toBe(1);
    const off = prepareSnapshotHtml(snap.html, false);
    expect(off).not.toContain('<script');
  });

  it('gives up on slow or failing resources and leaves them absolute', async () => {
    const slow: ResourceFetcher = (url) => (url.endsWith('.css') ? new Promise(() => {}) : Promise.reject(new Error('boom')));
    const d = await deps();
    const t0 = Date.now();
    const snap = await buildSnapshot(BLOG_HTML, 'https://blog.example/p', slow, d.assets, { deadlineMs: 100 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(snap.assets).toHaveLength(0);
    expect(snap.html).toContain('href="https://blog.example/static/blog.css"');
  });

  it('document text skips scripts and KaTeX MathML (S5 anchors)', () => {
    const doc = new DOMParser().parseFromString('<p>A <span class="katex"><span class="katex-mathml">x</span><span class="katex-html">x</span></span> b</p><script>no</script>', 'text/html');
    expect(documentText(doc.body)).toBe('A x b');
  });
});

describe('New from link end to end (L8, L9, L10)', () => {
  const site = 'https://arxiv.org';
  const pages = {
    [`${site}/html/2401.01234v1/`]: { body: ARXIV_HTML, type: 'text/html; charset=utf-8' },
    [`${site}/static/ltx-article.css`]: { body: ARXIV_CSS, type: 'text/css' },
    [`${site}/html/2401.01234v1/x1.png`]: { body: png(), type: 'image/png' },
    [`${site}/pdf/2401.01234v1`]: { body: new TextEncoder().encode('%PDF-1.7\n...'), type: 'application/pdf' },
    'https://x.example/bot': { body: BOT_CHECK_HTML, type: 'text/html', status: 403 },
    'https://x.example/ok-bot': { body: BOT_CHECK_HTML, type: 'text/html' },
    'https://x.example/login': { body: LOGIN_HTML, type: 'text/html' },
    'https://x.example/paywall': { body: PAYWALL_HTML, type: 'text/html' },
  };

  it('creates a link clipping with Reader Markdown (maths, local images, absolute links) and a snapshot', async () => {
    const w = web(pages);
    const d = await deps();
    const page = await fetchLink(w.fetchUrl, `${site}/html/2401.01234v1/`);
    expect(page.type).toBe('html');
    const t0 = performance.now();
    const c = await createLinkClipping(d, page as { html: string; finalUrl: string }, w.fetchRes, { requestedUrl: 'https://arxiv.org/html/2401.01234' }, Date.UTC(2026, 9, 21));
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(c).toMatchObject({
      origin: 'link',
      format: 'markdown',
      title: 'Spectral Methods for Study Graphs',
      url: 'https://arxiv.org/html/2401.01234',
      canonicalUrl: 'https://arxiv.org/abs/2401.01234v1',
      site: 'arXiv.org',
      author: 'Lovelace, Ada, Turing, Alan',
      published: '2024/01/05',
      fetched: Date.UTC(2026, 9, 21),
      slug: '2026-10-21-spectral-methods-for-study-graphs',
      scripts: false,
    });
    const content = (await d.library.clippingContent(c.id))!;
    expect(content.markdown).toContain('$L=D-A$');
    expect(content.markdown).toContain('$$\n\\lambda_{2}=\\min_{x\\perp\\mathbf{1}}\\frac{x^{\\top}Lx}{x^{\\top}x}\n$$');
    expect(content.markdown).toMatch(/!\[A study graph with two clusters\]\(assets\/[0-9a-f]{64}\.png\)/);
    expect(content.markdown).toContain('[data set](https://example.org/data)');
    expect(content.markdown).toContain('[Section 2](https://arxiv.org/html/2401.01234v1/#S2)');
    expect(invalidClippingLinks(content.markdown, content.assets.map((a) => a.path))).toEqual([]);
    expect(content.snapshotHtml).toContain('<script>');
    expect(content.assets.length).toBeGreaterThanOrEqual(2);
  });

  it('recognises PDFs, bot checks, sign-in walls and paywalls', async () => {
    const w = web(pages);
    expect((await fetchLink(w.fetchUrl, `${site}/pdf/2401.01234v1`)).type).toBe('pdf');
    await expect(fetchLink(w.fetchUrl, 'https://x.example/ok-bot')).rejects.toMatchObject({ reason: 'bot-check' });
    await expect(fetchLink(w.fetchUrl, 'https://x.example/login')).rejects.toMatchObject({ reason: 'login' });
    await expect(fetchLink(w.fetchUrl, 'https://x.example/paywall')).rejects.toMatchObject({ reason: 'paywall' });
  });

  it('flags relative links a clipping must not contain (gym check.py)', () => {
    expect(invalidClippingLinks('[a](https://x.org) [b](other.md) ![c](assets/0123456789abcdef.png) `[d](e.md)` [f](#x) [g](/abs)')).toEqual(['other.md', '/abs']);
  });

  it('a Readability-free page still yields Markdown from the body', async () => {
    const d = await deps();
    const c = await createLinkClipping(d, { html: '<html><head><title>Tiny</title></head><body><p>Short note.</p></body></html>', finalUrl: 'https://t.example/' }, vi.fn(async () => null));
    expect(c.title).toBe('Tiny');
    expect((await d.library.clippingContent(c.id))?.markdown).toBe('Short note.');
  });
});
