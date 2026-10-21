/**
 * Page snapshots for New from link (L8): the page's HTML with its images, stylesheets (and the
 * fonts and images those reference through `url()` and `@import`) and scripts downloaded
 * through the fetch helper and stored by content hash as `assets/<hash>.<ext>`, so the page
 * opens offline. References are rewritten:
 *
 * - in snapshot.html: `assets/<hash>.<ext>`;
 * - inside stylesheet assets: `<hash>.<ext>` (relative to the stylesheet, also in assets/).
 *
 * Snapshots are read-only after creation (L11) and render only in the sandboxed snapshot
 * frame (public/snapshot.html), never in the app's document.
 */
import type { SnapshotAsset } from '../stores/library';
import { assetFileName, mimeFor } from '../storage/assets';

export interface FetchedBytes {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

/** Downloads one resource (through the helper); null or a throw means "not available". */
export type ResourceFetcher = (url: string) => Promise<FetchedBytes | null>;

/** Stores a file and returns its SHA-256 (the AssetStore). */
export type AssetSink = (blob: Blob) => Promise<string>;

export interface SnapshotOptions {
  /** at most this many resources are downloaded (default 80) */
  maxResources?: number;
  /** resources larger than this are skipped (default 5 MB) */
  maxBytes?: number;
  /** stop starting downloads after this many ms (default 3500), so a link clipping takes < 5 s */
  deadlineMs?: number;
  concurrency?: number;
  /** extra URLs to download (images of the Reader view) */
  extraUrls?: string[];
  /** keep the page's scripts (downloaded) so the per-clipping toggle can run them (default true) */
  keepScripts?: boolean;
}

export interface Snapshot {
  html: string;
  assets: SnapshotAsset[];
  /** absolute resource URL → `assets/<hash>.<ext>` */
  urlMap: Map<string, string>;
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
const CSS_IMPORT = /@import\s+(['"])([^'"]+)\1/g;
const GENERIC = /^(application\/octet-stream|binary\/octet-stream|text\/plain)?$/i;

function absolute(href: string | null | undefined, base: string): string | null {
  const h = href?.trim();
  if (!h || /^(data|blob|javascript|about|mailto|tel):/i.test(h) || h.startsWith('#')) return null;
  try {
    const u = new URL(h, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Picks the best candidate of a srcset (largest width up to 1600 px, or density up to 2x). */
export function pickSrcset(srcset: string): string | null {
  const cands = srcset
    .split(/,\s+(?=\S)/)
    .map((c) => {
      const [url, d] = c.trim().split(/\s+/);
      const w = /^(\d+)w$/.exec(d ?? '');
      const x = /^([\d.]+)x$/.exec(d ?? '');
      return { url, w: w ? Number(w[1]) : 0, x: x ? Number(x[1]) : w ? 0 : 1 };
    })
    .filter((c) => c.url);
  if (!cands.length) return null;
  const byW = cands.filter((c) => c.w).sort((a, b) => a.w - b.w);
  if (byW.length) return (byW.filter((c) => c.w <= 1600).pop() ?? byW[0]).url;
  const byX = cands.sort((a, b) => a.x - b.x);
  return (byX.filter((c) => c.x <= 2).pop() ?? byX[0]).url;
}

const PLACEHOLDER_SRC = /^data:image\/(gif|png|svg\+xml)[;,]/i;

/** Builds a snapshot of a page. Never throws for missing resources: they stay absolute. */
export async function buildSnapshot(html: string, pageUrl: string, fetchRes: ResourceFetcher, store: AssetSink, opts: SnapshotOptions = {}): Promise<Snapshot> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseEl = doc.querySelector('base[href]');
  const base = (baseEl && absolute(baseEl.getAttribute('href'), pageUrl)) || pageUrl;
  for (const b of Array.from(doc.querySelectorAll('base'))) b.remove();
  // things that would act on load: refresh, CSP of the original site, preloads
  for (const m of Array.from(doc.querySelectorAll('meta[http-equiv]'))) m.remove();
  for (const l of Array.from(doc.querySelectorAll('link'))) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase();
    if (!/\bstylesheet\b/.test(rel)) l.remove();
  }
  for (const f of Array.from(doc.querySelectorAll('form'))) f.removeAttribute('action');
  if (opts.keepScripts === false) for (const s of Array.from(doc.querySelectorAll('script'))) s.remove();

  // lazy images and responsive sources: settle on one URL per image
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const lazy = img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? img.getAttribute('data-original');
    const src = img.getAttribute('src');
    if (lazy && (!src || PLACEHOLDER_SRC.test(src))) img.setAttribute('src', lazy);
    const set = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
    if (set) {
      const best = pickSrcset(set);
      if (best && (!img.getAttribute('src') || PLACEHOLDER_SRC.test(img.getAttribute('src')!))) img.setAttribute('src', best);
      else if (best) img.setAttribute('src', best);
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('loading');
  }
  for (const s of Array.from(doc.querySelectorAll('picture > source'))) s.remove();

  // ---- collect
  const wanted = new Map<string, 'css' | 'other'>();
  const want = (raw: string | null | undefined, kind: 'css' | 'other' = 'other', b = base) => {
    const u = absolute(raw, b);
    if (u && !wanted.has(u)) wanted.set(u, kind);
    return u;
  };
  for (const el of Array.from(doc.querySelectorAll('img[src], input[type="image"][src], video[poster], audio[src], track[src]'))) {
    want(el.getAttribute(el.tagName === 'VIDEO' ? 'poster' : 'src'));
  }
  for (const el of Array.from(doc.querySelectorAll('image'))) want(el.getAttribute('href') ?? el.getAttribute('xlink:href'));
  for (const l of Array.from(doc.querySelectorAll('link[href]'))) want(l.getAttribute('href'), 'css');
  if (opts.keepScripts !== false) for (const s of Array.from(doc.querySelectorAll('script[src]'))) want(s.getAttribute('src'));
  for (const el of Array.from(doc.querySelectorAll('[style]'))) for (const m of (el.getAttribute('style') ?? '').matchAll(CSS_URL)) want(m[2]);
  for (const st of Array.from(doc.querySelectorAll('style'))) {
    const css = st.textContent ?? '';
    for (const m of css.matchAll(CSS_URL)) want(m[2]);
    for (const m of css.matchAll(CSS_IMPORT)) want(m[2], 'css');
  }
  for (const u of opts.extraUrls ?? []) if (/^https?:/i.test(u) && !wanted.has(u)) wanted.set(u, 'other');

  // ---- download (bounded in count, size and time)
  const urlMap = new Map<string, string>();
  const assets = new Map<string, SnapshotAsset>();
  const start = Date.now();
  const deadline = start + (opts.deadlineMs ?? 3500);
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let budget = opts.maxResources ?? 80;

  const fetchOne = async (url: string, kind: 'css' | 'other', depth = 0): Promise<string | null> => {
    if (urlMap.has(url)) return urlMap.get(url)!;
    if (budget <= 0 || Date.now() > deadline) return null;
    budget--;
    let got: FetchedBytes | null = null;
    try {
      const remaining = Math.max(200, deadline + 1500 - Date.now());
      got = await Promise.race([fetchRes(url), new Promise<null>((r) => setTimeout(() => r(null), remaining))]);
    } catch {
      got = null;
    }
    if (!got || got.bytes.byteLength > maxBytes || got.bytes.byteLength === 0) return null;
    let mime = got.contentType.split(';')[0].trim().toLowerCase();
    if (GENERIC.test(mime)) mime = mimeFor(new URL(url).pathname);
    let bytes: Uint8Array | string = got.bytes;
    if (kind === 'css' || mime === 'text/css') {
      mime = 'text/css';
      bytes = await rewriteCss(new TextDecoder().decode(got.bytes), got.finalUrl || url, depth);
    }
    if (mime === 'application/javascript' || mime === 'application/x-javascript') mime = 'text/javascript';
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const hash = await store(blob);
    const path = `assets/${assetFileName(hash, mime)}`;
    urlMap.set(url, path);
    if (got.finalUrl && got.finalUrl !== url) urlMap.set(got.finalUrl, path);
    if (!assets.has(path)) assets.set(path, { path, hash, mime, url });
    return path;
  };

  /** Downloads what a stylesheet references and rewrites it relative to assets/. */
  const rewriteCss = async (css: string, cssUrl: string, depth: number): Promise<string> => {
    const refs = new Map<string, 'css' | 'other'>();
    for (const m of css.matchAll(CSS_URL)) {
      const u = absolute(m[2], cssUrl);
      if (u) refs.set(u, /\.css(\?|$)/i.test(u) ? 'css' : 'other');
    }
    if (depth < 2) for (const m of css.matchAll(CSS_IMPORT)) {
      const u = absolute(m[2], cssUrl);
      if (u) refs.set(u, 'css');
    }
    await pool([...refs], (([u, k]) => fetchOne(u, k, depth + 1)), opts.concurrency ?? 6);
    const local = (raw: string) => {
      const u = absolute(raw, cssUrl);
      const p = u ? urlMap.get(u) : undefined;
      return p ? p.replace(/^assets\//, '') : u;
    };
    return css
      .replace(CSS_URL, (all, q: string, raw: string) => {
        const r = local(raw);
        return r ? `url(${q}${r}${q})` : all;
      })
      .replace(CSS_IMPORT, (all, q: string, raw: string) => {
        const r = local(raw);
        return r ? `@import ${q}${r}${q}` : all;
      });
  };

  await pool([...wanted], ([u, k]) => fetchOne(u, k), opts.concurrency ?? 6);

  // ---- rewrite the document
  const map = (raw: string | null | undefined, b = base): string | null => {
    const u = absolute(raw, b);
    return u ? (urlMap.get(u) ?? u) : null;
  };
  const setMapped = (el: Element, attr: string) => {
    const v = map(el.getAttribute(attr));
    if (v) el.setAttribute(attr, v);
  };
  for (const el of Array.from(doc.querySelectorAll('img[src], input[type="image"][src], audio[src], track[src], script[src]'))) setMapped(el, 'src');
  for (const el of Array.from(doc.querySelectorAll('video[poster]'))) setMapped(el, 'poster');
  for (const el of Array.from(doc.querySelectorAll('link[href]'))) setMapped(el, 'href');
  for (const el of Array.from(doc.querySelectorAll('image'))) {
    for (const a of ['href', 'xlink:href']) if (el.hasAttribute(a)) setMapped(el, a);
  }
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    el.setAttribute('style', (el.getAttribute('style') ?? '').replace(CSS_URL, (_all, q: string, raw: string) => `url(${q}${map(raw) ?? raw}${q})`));
  }
  for (const st of Array.from(doc.querySelectorAll('style'))) {
    st.textContent = (st.textContent ?? '')
      .replace(CSS_URL, (_all, q: string, raw: string) => `url(${q}${map(raw) ?? raw}${q})`)
      .replace(CSS_IMPORT, (_all, q: string, raw: string) => `@import ${q}${map(raw) ?? raw}${q}`);
  }
  // links stay usable: absolute, opened outside the frame by the viewer
  for (const a of Array.from(doc.querySelectorAll('a[href], area[href]'))) {
    const href = a.getAttribute('href')!;
    if (href.startsWith('#')) continue;
    const u = absolute(href, base);
    if (u) a.setAttribute('href', u);
    else a.removeAttribute('href');
  }
  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, assets: [...assets.values()], urlMap };
}

/** Runs `fn` over items with at most `n` in flight. */
async function pool<T>(items: T[], fn: (item: T) => Promise<unknown>, n: number): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * Prepares snapshot HTML for the frame (L8): with scripts off, script elements, inline event
 * handlers and `javascript:` URLs are removed and `<noscript>` fallbacks are shown. The frame
 * sandbox and CSP block them anyway; this keeps the page from depending on them.
 */
export function prepareSnapshotHtml(html: string, scripts: boolean): string {
  if (scripts) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const s of Array.from(doc.querySelectorAll('script'))) s.remove();
  for (const n of Array.from(doc.querySelectorAll('noscript'))) {
    const frag = new DOMParser().parseFromString(`<body>${n.textContent ?? n.innerHTML}</body>`, 'text/html').body;
    n.replaceWith(...Array.from(frag.childNodes).map((c) => doc.importNode(c, true)));
  }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Text of a snapshot or article as the viewers see it, for text-quote anchors (S5, S6): text
 * nodes in document order, skipping scripts, styles and KaTeX's hidden MathML. The snapshot
 * frame (public/snapshot.html) implements the same walk.
 */
export function documentText(root: Node): string {
  let s = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      s += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
    if (n.nodeType === 1) {
      const el = n as Element;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/i.test(el.tagName)) return;
      if (el.classList?.contains('katex-mathml')) return;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return s;
}
