/**
 * Reading a canvas segment for the derived files (R6, G5), and the Markdown blocks the day and
 * mark files share: text boxes, clips with citations, images.
 */
import * as Y from 'yjs';
import type { BookMeta, CanvasMeta, CanvasObject, ClipObject, ClippingMeta, ImageObject, Mark, SourceLink } from '../../model/types';
import { dayTopicsMap, marksMap, objectsMap, readMark, readObject } from '../../canvas/segment';
import { objectBounds } from '../../canvas/bounds';
import { isoDate } from '../../util/time';
import { bookDir, clippingMdPath, relativeLink, segmentAssetPath } from '../paths';

export interface SegmentContent {
  slug: string;
  month: string;
  objects: CanvasObject[];
  marks: Mark[];
  dayTopics: Map<string, string[]>;
}

export function readSegment(slug: string, month: string, doc: Y.Doc): SegmentContent {
  const objects: CanvasObject[] = [];
  for (const m of objectsMap(doc).values()) {
    const o = m instanceof Y.Map ? readObject(m) : null;
    if (o) objects.push(o);
  }
  const marks: Mark[] = [];
  for (const m of marksMap(doc).values()) {
    const mark = m instanceof Y.Map ? readMark(m) : null;
    if (mark) marks.push(mark);
  }
  marks.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  const dayTopics = new Map<string, string[]>();
  for (const [d, t] of dayTopicsMap(doc).entries()) if (Array.isArray(t)) dayTopics.set(d, t);
  return { slug, month, objects, marks, dayTopics };
}

/** Assets (images and clip images) a segment references: hash → MIME type. */
export function segmentAssets(seg: Pick<SegmentContent, 'objects'>): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of seg.objects) {
    if (o.kind === 'image' && o.asset) out.set(o.asset, o.mime || 'image/png');
    else if (o.kind === 'clip' && o.asset) out.set(o.asset, o.mime || 'image/png');
  }
  return out;
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return String(new Date(y, m, 0).getDate()).padStart(2, '0');
}

/**
 * The day (device-local date) of a time, kept inside the segment's month: an object lives in
 * the segment of the month it was created in, but a device in another time zone may see its
 * date in the neighbouring month, and gym's checker requires day files to match their month.
 */
export function dayOf(t: number, month: string): string {
  const d = isoDate(t);
  if (d.startsWith(month)) return d;
  return d < month ? `${month}-01` : `${month}-${lastDay(month)}`;
}

/** Top to bottom, then left to right (G5 reading order). */
export function readingOrder<T extends CanvasObject>(objects: readonly T[]): T[] {
  return [...objects].sort((a, b) => {
    const ba = objectBounds(a);
    const bb = objectBounds(b);
    return ba.y - bb.y || ba.x - bb.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** What derived files need from the rest of the repository. */
export interface DerivedEnv {
  /** true when the path (file, or folder) will exist in the repository after this push */
  exists(path: string): boolean;
  book(id: string): BookMeta | undefined;
  clipping(id: string): ClippingMeta | undefined;
  canvas(slug: string): CanvasMeta | undefined;
}

/** Text safe inside a Markdown link label. */
export function linkText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/([[\]\\])/g, '\\$1') || 'untitled';
}

/** Citation of a clip's source, linking to the library item or gym file when it exists. */
export function citation(src: SourceLink, fromFile: string, env: DerivedEnv): string {
  const loc = src.locator;
  switch (src.type) {
    case 'book': {
      const meta = env.book(src.id);
      const where = loc.type === 'pdf' ? `, p. ${loc.page}` : loc.type === 'epub' && loc.chapter ? `, ${loc.chapter.split('/').pop()!.replace(/\.x?html?$/i, '')}` : '';
      const label = linkText((meta?.title ?? src.title) + where);
      if (meta && env.exists(bookDir(meta.slug))) return `[${label}](${relativeLink(fromFile, bookDir(meta.slug) + '/')})`;
      return `${label} (source deleted)`;
    }
    case 'clipping': {
      const meta = env.clipping(src.id);
      const label = linkText(meta?.title ?? src.title);
      if (meta && env.exists(clippingMdPath(meta.slug))) return `[${label}](${relativeLink(fromFile, clippingMdPath(meta.slug))})`;
      return `${label} (source deleted)`;
    }
    case 'gym': {
      const path = loc.type === 'gym' ? loc.path : src.id;
      const label = linkText(src.title || path);
      if (path && env.exists(path)) return `[${label}](${relativeLink(fromFile, path)})`;
      return `${label} (gym file not found)`;
    }
    case 'canvas': {
      const slug = loc.type === 'canvas' ? loc.canvas : src.id;
      return `${linkText(env.canvas(slug)?.title ?? src.title ?? slug)} (canvas)`;
    }
  }
}

/** A text box's Markdown, with an unclosed code fence closed so it cannot swallow the file. */
export function textBlock(content: string): string {
  let t = content.replace(/\s+$/, '');
  if (!t.trim()) return '';
  let open: string | null = null;
  for (const line of t.split('\n')) {
    const m = /^\s*(```|~~~)/.exec(line);
    if (!m) continue;
    if (!open) open = m[1];
    else if (m[1] === open) open = null;
  }
  if (open) t += `\n${open}`;
  return t;
}

/** Relative link from `fromFile` to a segment asset, or null when the file is not in the repository. */
export function assetLink(seg: Pick<SegmentContent, 'slug' | 'month'>, hash: string, mime: string, fromFile: string, env: DerivedEnv): string | null {
  const path = segmentAssetPath(seg.slug, seg.month, hash, mime);
  return env.exists(path) ? relativeLink(fromFile, path) : null;
}

export function imageBlock(seg: Pick<SegmentContent, 'slug' | 'month'>, o: ImageObject, fromFile: string, env: DerivedEnv): string {
  const link = assetLink(seg, o.asset, o.mime, fromFile, env);
  const alt = linkText(o.alt || 'Image');
  return link ? `![${alt}](${link})` : `*${alt} (image not synced)*`;
}

/** A clip as a quote with its citation (and its image when it shows one). */
export function clipBlock(seg: Pick<SegmentContent, 'slug' | 'month'>, o: ClipObject, fromFile: string, env: DerivedEnv): string {
  const parts: string[] = [];
  if (o.asset && o.display !== 'text') {
    const link = assetLink(seg, o.asset, o.mime ?? 'image/png', fromFile, env);
    if (link) parts.push(`![${linkText(`Clip: ${o.source.title || 'source'}`)}](${link})`, '');
  }
  const text = textBlock(o.text);
  const quote = text ? text.split('\n').map((l) => (l ? `> ${l}` : '>')) : [];
  if (quote.length) quote.push('>');
  quote.push(`> — ${citation(o.source, fromFile, env)}`);
  parts.push(...quote);
  return parts.join('\n');
}

/** The Markdown block of an object in a day or mark file ('' for ink and shapes). */
export function objectBlock(seg: Pick<SegmentContent, 'slug' | 'month'>, o: CanvasObject, fromFile: string, env: DerivedEnv): string {
  switch (o.kind) {
    case 'text':
      return textBlock(o.content);
    case 'clip':
      return clipBlock(seg, o, fromFile, env);
    case 'image':
      return imageBlock(seg, o, fromFile, env);
    default:
      return '';
  }
}
