/**
 * Article extraction for New from link (L8) with Mozilla Readability, and link metadata (L9):
 * title, site, author, published date and canonical URL. Runs on an inert DOMParser document.
 */
import { Readability } from '@mozilla/readability';

export interface ArticleMeta {
  title: string;
  site?: string;
  author?: string;
  /** ISO date or date-time as published by the page */
  published?: string;
  canonicalUrl?: string;
  lang?: string;
  excerpt?: string;
}

export interface Article extends ArticleMeta {
  /** cleaned article HTML (relative URLs resolved against the page) */
  contentHtml: string;
  textContent: string;
}

/**
 * Parses page HTML and makes every URL absolute against `pageUrl`. Browsers ignore `<base>` in
 * DOMParser documents (their base is the app's URL), and Readability resolves links and images
 * against `doc.baseURI`, so URLs are resolved here first.
 */
export function parsePage(html: string, pageUrl: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let base = pageUrl;
  const own = doc.querySelector('base[href]')?.getAttribute('href');
  if (own) {
    try {
      base = new URL(own, pageUrl).toString();
    } catch {
      /* keep the page URL */
    }
  }
  const abs = (v: string) => {
    if (/^(#|data:|javascript:|mailto:|tel:|about:)/i.test(v.trim())) return v;
    try {
      return new URL(v.trim(), base).toString();
    } catch {
      return v;
    }
  };
  for (const attr of ['href', 'src', 'poster', 'data-src', 'data-original', 'data-lazy-src']) {
    for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) el.setAttribute(attr, abs(el.getAttribute(attr)!));
  }
  for (const attr of ['srcset', 'data-srcset']) {
    for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) {
      el.setAttribute(
        attr,
        el
          .getAttribute(attr)!
          .split(/,\s+(?=\S)/)
          .map((c) => {
            const [u, ...rest] = c.trim().split(/\s+/);
            return [abs(u), ...rest].join(' ');
          })
          .join(', '),
      );
    }
  }
  return doc;
}

const meta = (doc: Document, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const el = doc.querySelector(`meta[property="${k}"], meta[name="${k}"], meta[itemprop="${k}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return undefined;
};

/** JSON-LD objects in the page (Article, NewsArticle, ScholarlyArticle…). */
function jsonLd(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const v = JSON.parse(s.textContent ?? '');
      const list = Array.isArray(v) ? v : Array.isArray(v?.['@graph']) ? v['@graph'] : [v];
      for (const o of list) if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return out;
}

function ldName(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(ldName).filter(Boolean).join(', ') || undefined;
  if (typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') return (v as { name: string }).name;
  return undefined;
}

/** Link metadata (L9) from meta tags, JSON-LD and the document. */
export function pageMeta(doc: Document, pageUrl: string): ArticleMeta {
  const ld = jsonLd(doc).find((o) => /Article|Posting|WebPage|Report|Paper/i.test(String(o['@type'] ?? ''))) ?? {};
  const authors = Array.from(doc.querySelectorAll('meta[name="citation_author"]'))
    .map((m) => m.getAttribute('content')?.trim())
    .filter(Boolean) as string[];
  const title =
    meta(doc, 'citation_title', 'og:title', 'twitter:title') ??
    (typeof ld.headline === 'string' ? ld.headline : undefined) ??
    doc.querySelector('title')?.textContent?.trim() ??
    doc.querySelector('h1')?.textContent?.trim() ??
    pageUrl;
  let canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? meta(doc, 'og:url');
  if (canonical) {
    try {
      canonical = new URL(canonical, pageUrl).toString();
    } catch {
      canonical = undefined;
    }
  }
  const timeEl = doc.querySelector('time[datetime]');
  const out: ArticleMeta = { title: title.replace(/\s+/g, ' ').trim() };
  const site = meta(doc, 'og:site_name', 'application-name', 'citation_journal_title') ?? ldName(ld.publisher);
  if (site) out.site = site;
  const author = (authors.length ? authors.join(', ') : undefined) ?? meta(doc, 'author', 'article:author', 'twitter:creator', 'dc.creator', 'DC.creator') ?? ldName(ld.author);
  if (author && !/^https?:/i.test(author)) out.author = author;
  const published =
    meta(doc, 'article:published_time', 'citation_publication_date', 'citation_date', 'datePublished', 'dc.date', 'DC.date', 'date') ??
    (typeof ld.datePublished === 'string' ? ld.datePublished : undefined) ??
    timeEl?.getAttribute('datetime') ??
    undefined;
  if (published) out.published = published.trim();
  if (canonical) out.canonicalUrl = canonical;
  const lang = doc.documentElement.getAttribute('lang');
  if (lang) out.lang = lang;
  const excerpt = meta(doc, 'description', 'og:description');
  if (excerpt) out.excerpt = excerpt;
  return out;
}

/**
 * Extracts the readable article. Readability mutates its document, so it gets a fresh parse;
 * metadata is read from an untouched one. Returns null when the page has no article.
 */
export function extractArticle(html: string, pageUrl: string): Article | null {
  const metaDoc = parsePage(html, pageUrl);
  const info = pageMeta(metaDoc, pageUrl);
  const doc = parsePage(html, pageUrl);
  // keep maths: Readability drops <math> as "unlikely" in some layouts; its alttext is enough
  const parsed = new Readability(doc, { keepClasses: true, charThreshold: 200 }).parse();
  if (!parsed?.content) return null;
  const out: Article = {
    ...info,
    title: info.title || parsed.title || pageUrl,
    contentHtml: parsed.content,
    textContent: parsed.textContent ?? '',
  };
  if (!out.site && parsed.siteName) out.site = parsed.siteName;
  if (!out.author && parsed.byline) out.author = parsed.byline.replace(/^by\s+/i, '').trim();
  if (!out.published && parsed.publishedTime) out.published = parsed.publishedTime;
  if (!out.excerpt && parsed.excerpt) out.excerpt = parsed.excerpt;
  if (parsed.title && (!info.title || info.title === pageUrl)) out.title = parsed.title;
  return out;
}
