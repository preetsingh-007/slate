/**
 * Day files (G5): `journal/<canvas>/<YYYY-MM>/days/<YYYY-MM-DD>.md` and `.svg`, one pair per day
 * that has objects or marks created on it.
 *
 * - `.md`: front matter `canvas`, `date`, `topics`; a link to the day's SVG; the objects created
 *   that day in reading order (top to bottom, then left to right): text boxes as Markdown, clips
 *   as quotes with a citation linking to the library item, images as relative links; then links
 *   to the day's marks.
 * - `.svg`: the objects created that day, rendered within their bounding area.
 */
import type { CanvasObject } from '../../model/types';
import { objectsToSvg } from '../../canvas/export';
import { dayPath, markPath, relativeLink, segmentAssetPath } from '../paths';
import { frontMatter } from './frontmatter';
import { dayOf, linkText, objectBlock, readingOrder, type DerivedEnv, type SegmentContent } from './segment';

/** Days of a segment that get a day file, sorted. */
export function segmentDays(seg: SegmentContent): string[] {
  const days = new Set<string>();
  for (const o of seg.objects) if (!(o.kind === 'stroke' && o.beautifiedInto)) days.add(dayOf(o.created, seg.month));
  for (const m of seg.marks) days.add(dayOf(m.created, seg.month));
  return [...days].sort();
}

/** Objects created on `date`, ignoring strokes replaced by a shape (C16). */
export function objectsOfDay(seg: SegmentContent, date: string): CanvasObject[] {
  return seg.objects.filter((o) => dayOf(o.created, seg.month) === date && !(o.kind === 'stroke' && o.beautifiedInto));
}

/** G2: the day's topics: the canvas's, the day's tags, and those of its objects and marks. */
export function dayTopics(seg: SegmentContent, date: string, canvasTopics: readonly string[]): string[] {
  const out = new Set<string>(canvasTopics);
  for (const t of seg.dayTopics.get(date) ?? []) out.add(t);
  for (const o of objectsOfDay(seg, date)) for (const t of o.topics ?? []) out.add(t);
  for (const m of seg.marks) if (m.topic && dayOf(m.created, seg.month) === date) out.add(m.topic);
  return [...out].filter((t) => t.trim()).sort();
}

export function dayMarkdown(seg: SegmentContent, date: string, canvasTopics: readonly string[], env: DerivedEnv): string {
  const file = dayPath(seg.slug, seg.month, date, 'md');
  const title = env.canvas(seg.slug)?.title ?? seg.slug;
  const fm = frontMatter([
    ['canvas', seg.slug],
    ['date', date],
    ['topics', dayTopics(seg, date, canvasTopics)],
  ]);
  const parts: string[] = [`![${linkText(`${title}, ${date}`)}](${date}.svg)`];
  for (const o of readingOrder(objectsOfDay(seg, date))) {
    const block = objectBlock(seg, o, file, env);
    if (block) parts.push(block);
  }
  const marks = seg.marks.filter((m) => dayOf(m.created, seg.month) === date);
  if (marks.length) {
    parts.push(
      '## Marks',
      marks.map((m) => `- [${m.id}](${relativeLink(file, markPath(seg.slug, seg.month, m.id, 'md'))}) · ${m.kind} · ${m.topic || 'no topic'}`).join('\n'),
    );
  }
  return `${fm}\n${parts.join('\n\n')}\n`;
}

export function daySvg(seg: SegmentContent, date: string): string {
  return objectsToSvg(objectsOfDay(seg, date), {
    // from days/ to the segment's assets/
    assetHref: (hash, mime) => relativeLink(dayPath(seg.slug, seg.month, date, 'svg'), segmentAssetPath(seg.slug, seg.month, hash, mime)),
    background: '#ffffff',
  });
}
