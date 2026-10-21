/**
 * Headings of a Markdown text with their source offsets and the anchors the renderer gives
 * them (GitHub-style slugs, `-1`, `-2`… for repeats). Used for `path#heading` links (G6, G7)
 * and to point search hits at the nearest section.
 */
import { githubSlug } from '../markdown/render';
import { plainInline } from './frontmatter';

export interface Heading {
  depth: number;
  text: string;
  slug: string;
  /** offset of the heading line in the text */
  offset: number;
}

export function headings(text: string): Heading[] {
  const out: Heading[] = [];
  const counts = new Map<string, number>();
  let fence: string | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const f = /^\s{0,3}(```|~~~)/.exec(line);
    if (f) fence = fence ? (f[1] === fence ? null : fence) : f[1];
    else if (!fence) {
      const m = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
      if (m) {
        const text = plainInline(m[2]);
        let slug = githubSlug(text);
        const n = counts.get(slug) ?? 0;
        counts.set(slug, n + 1);
        if (n) slug = `${slug}-${n}`;
        out.push({ depth: m[1].length, text, slug, offset });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/** The heading a position falls under (the last heading at or before it). */
export function headingAt(list: Heading[], pos: number): Heading | undefined {
  let best: Heading | undefined;
  for (const h of list) {
    if (h.offset > pos) break;
    best = h;
  }
  return best;
}
