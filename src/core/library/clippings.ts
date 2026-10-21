/**
 * Creating clippings (L7, L8, L9, L11). A clipping is read-only after creation: its Markdown
 * (`clipping.md`), snapshot (`snapshot.html` + `assets/`) and metadata (`meta.json`). Only
 * the title, view settings, topics and the annotations on top change later.
 *
 * gym's check.py checks relative links in `library/**\/*.md`: clipping.md may only contain
 * absolute links or links to files in the clipping folder (`assets/<hash>.<ext>`).
 */
import type { ClippingMeta } from '../model/types';
import type { ClippingContent, LibraryStore, SnapshotAsset } from '../stores/library';
import { sha256Hex, slugify, uid } from '../util/ids';
import { isoDate } from '../util/time';
import { htmlToMarkdown } from '../html/toMarkdown';
import { extractArticle, pageMeta, parsePage } from './article';
import { fromClipboard, type ClipboardInput } from './clipboard';
import { decodeText, FetchError, pageProblem, type FetchedResource } from './helper';
import { isPdfResponse } from './links';
import { buildSnapshot, type AssetSink, type ResourceFetcher, type SnapshotOptions } from './snapshot';

/** `YYYY-MM-DD-<slug>`, unique among existing clipping folders. */
export function clippingSlug(date: string, title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${date}-${slugify(title, 50)}`;
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Links in Markdown that gym's checker would reject for a clipping (see check.py LINK). */
export function invalidClippingLinks(markdown: string, assets: Iterable<string> = []): string[] {
  const files = new Set(assets);
  const text = markdown.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1/gm, '').replace(/`[^`\n]*`/g, '');
  const bad: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const t = m[1];
    if (t.includes('://') || t.startsWith('mailto:') || t.startsWith('#')) continue;
    if (/^assets\/[0-9a-f]{16,64}(\.[a-z0-9]+)?$/.test(t) && (!files.size || files.has(t))) continue;
    bad.push(t);
  }
  return bad;
}

interface Deps {
  library: LibraryStore;
}

function takenSlugs(library: LibraryStore): string[] {
  return [...library.clippings().map((c) => c.slug), ...library.tombstones().filter((t) => t.kind === 'clipping').map((t) => t.slug)];
}

/** Stores a new clipping; returns its metadata. */
async function store(deps: Deps, meta: Omit<ClippingMeta, 'id' | 'slug' | 'contentHash' | 'added'>, content: ClippingContent, now: number): Promise<ClippingMeta> {
  const full: ClippingMeta = {
    ...meta,
    id: uid(),
    slug: clippingSlug(isoDate(now), meta.title, takenSlugs(deps.library)),
    added: now,
    contentHash: await sha256Hex(new TextEncoder().encode(content.markdown)),
  };
  await deps.library.putClipping(full, content);
  return full;
}

/** New from clipboard (L7). Returns null when there is nothing to clip. */
export async function createClipboardClipping(deps: Deps, input: ClipboardInput, now = Date.now()): Promise<ClippingMeta | null> {
  const c = fromClipboard(input);
  if (!c) return null;
  const meta: Omit<ClippingMeta, 'id' | 'slug' | 'contentHash' | 'added'> = { origin: 'clipboard', title: c.title, format: c.format, topics: [] };
  if (c.sourceLabel) meta.sourceLabel = c.sourceLabel;
  return store(deps, meta, { markdown: c.markdown, assets: [] }, now);
}

export type LinkFetch = (url: string) => Promise<FetchedResource>;

export type FetchedLink = { type: 'pdf'; bytes: Uint8Array; finalUrl: string } | { type: 'html'; html: string; finalUrl: string };

/** Downloads a link and tells a PDF from a page; recognises bot checks, sign-in walls and paywalls (L10). */
export async function fetchLink(fetchUrl: LinkFetch, url: string): Promise<FetchedLink> {
  const res = await fetchUrl(url);
  if (isPdfResponse(res.contentType, res.bytes)) return { type: 'pdf', bytes: res.bytes, finalUrl: res.finalUrl };
  if (!/html|xml|text\/plain/i.test(res.contentType) && res.bytes.byteLength) throw new FetchError('empty', `not a web page: ${res.contentType}`);
  const html = decodeText(res.bytes, res.contentType);
  const problem = pageProblem(html);
  if (problem) throw new FetchError(problem);
  return { type: 'html', html, finalUrl: res.finalUrl };
}

export interface LinkClippingOptions extends SnapshotOptions {
  /** URL the owner entered (kept as `url`; the final URL after redirects is used for resolving) */
  requestedUrl?: string;
}

/**
 * New from link (L8, L9): extracts the article (Reader view, Markdown with images stored as
 * assets) and saves the snapshot (Original view), both through the fetch helper.
 */
export async function createLinkClipping(
  deps: Deps & { assets: AssetSink },
  page: { html: string; finalUrl: string },
  fetchRes: ResourceFetcher,
  opts: LinkClippingOptions = {},
  now = Date.now(),
): Promise<ClippingMeta> {
  const url = page.finalUrl;
  const article = extractArticle(page.html, url);
  // images of the Reader view are downloaded with the snapshot so both work offline
  const articleImages = article ? [...new DOMParser().parseFromString(article.contentHtml, 'text/html').querySelectorAll('img[src]')].map((i) => {
    try {
      return new URL(i.getAttribute('src')!, url).toString();
    } catch {
      return '';
    }
  }) : [];
  const snap = await buildSnapshot(page.html, url, fetchRes, deps.assets, { ...opts, extraUrls: [...(opts.extraUrls ?? []), ...articleImages.filter(Boolean)] });
  const image = (u: string) => snap.urlMap.get(u) ?? null;
  let markdown: string;
  let info;
  if (article) {
    markdown = htmlToMarkdown(article.contentHtml, { baseUrl: url, image });
    info = article;
  } else {
    const doc = parsePage(page.html, url);
    info = pageMeta(doc, url);
    markdown = htmlToMarkdown(doc.body?.innerHTML ?? '', { baseUrl: url, image });
  }
  if (!markdown.trim()) throw new FetchError('empty');
  // only assets the Markdown or snapshot reference are kept with the clipping
  const assets: SnapshotAsset[] = snap.assets;
  const meta: Omit<ClippingMeta, 'id' | 'slug' | 'contentHash' | 'added'> = {
    origin: 'link',
    title: info.title || url,
    format: 'markdown',
    url: opts.requestedUrl ?? url,
    fetched: now,
    scripts: false,
    topics: [],
  };
  if (info.canonicalUrl) meta.canonicalUrl = info.canonicalUrl;
  else if (opts.requestedUrl && opts.requestedUrl !== url) meta.canonicalUrl = url;
  try {
    meta.site = info.site ?? new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep without site */
  }
  if (info.author) meta.author = info.author;
  if (info.published) meta.published = info.published;
  return store(deps, meta, { markdown, snapshotHtml: snap.html, assets }, now);
}
