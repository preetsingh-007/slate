/**
 * Mark files (G5): `journal/<canvas>/<YYYY-MM>/marks/<id>.md` and `.png`.
 *
 * - `.md`: front matter `id`, `kind`, `topic` (gym path or empty), `problem` (gym path, for
 *   solutions), `comment`, `created`, `day` (relative link to the day file); body: a link to
 *   `<id>.png`, the typed text inside the mark, and clip texts with citations.
 * - `.png`: the marked region rendered at twice the 100% zoom resolution (one canvas unit is
 *   one CSS pixel at 100%), from an SVG with images inlined, by an injectable rasteriser.
 */
import type { CanvasObject, Mark, Rect } from '../../model/types';
import { objectsToSvg } from '../../canvas/export';
import { isoDateTime } from '../../util/time';
import { dayPath, markPath, relativeLink } from '../paths';
import { frontMatter } from './frontmatter';
import { citation, dayOf, readingOrder, textBlock, type DerivedEnv, type SegmentContent } from './segment';

/** Renders a standalone SVG to PNG bytes of exactly `width` × `height` pixels. */
export type Rasterizer = (svg: string, width: number, height: number) => Promise<Uint8Array>;

/** Twice the 100% zoom resolution (G5). */
export const MARK_SCALE = 2;
/** Longest PNG side; larger regions are scaled down to fit (memory on iPad). */
export const MARK_MAX_PX = 8192;

export function markPngSize(region: Rect): { w: number; h: number } {
  let w = Math.max(1, region.w * MARK_SCALE);
  let h = Math.max(1, region.h * MARK_SCALE);
  const k = Math.min(1, MARK_MAX_PX / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { w, h };
}

/** An object of the mark and the segment it is stored in (marks can span months). */
export interface MarkObject {
  object: CanvasObject;
  seg: Pick<SegmentContent, 'slug' | 'month'>;
}

export function markDay(seg: Pick<SegmentContent, 'month'>, mark: Mark): string {
  return dayOf(mark.created, seg.month);
}

export function markMarkdown(seg: SegmentContent, mark: Mark, objects: MarkObject[], env: DerivedEnv): string {
  const file = markPath(seg.slug, seg.month, mark.id, 'md');
  const day = markDay(seg, mark);
  const fm = frontMatter([
    ['id', mark.id],
    ['kind', mark.kind],
    ['topic', mark.topic],
    ['problem', mark.problem],
    ['comment', mark.comment],
    ['created', isoDateTime(mark.created)],
    ['day', relativeLink(file, dayPath(seg.slug, seg.month, day, 'md'))],
  ]);
  const parts: string[] = [`![Mark ${mark.id}](${mark.id}.png)`];
  const ordered = readingOrder(objects.map((x) => x.object));
  for (const o of ordered) {
    if (o.kind === 'text') {
      const t = textBlock(o.content);
      if (t) parts.push(t);
    } else if (o.kind === 'clip') {
      const text = textBlock(o.text);
      const quote = text ? text.split('\n').map((l) => (l ? `> ${l}` : '>')) : [];
      if (quote.length) quote.push('>');
      quote.push(`> — ${citation(o.source, file, env)}`);
      parts.push(quote.join('\n'));
    }
  }
  return `${fm}\n${parts.join('\n\n')}\n`;
}

/**
 * SVG of the marked region: every object intersecting it, clipped to it, on white, with
 * `assetHref` giving data: URIs so the rasteriser needs no network or file access.
 */
export function markSvg(mark: Mark, objects: readonly CanvasObject[], assetHref: (hash: string, mime: string) => string): string {
  return objectsToSvg(objects, { region: mark.region, padding: 0, background: '#ffffff', assetHref });
}
