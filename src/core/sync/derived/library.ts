/**
 * Library files: `library/README.md` (derived), `library/books/<slug>/annotations.md` (derived
 * from the book's annotations document), and `clipping.md` (written once per clipping, L11).
 */
import type { Annotation, BookMeta, ClippingMeta } from '../../model/types';
import { isoDate, isoDateTime } from '../../util/time';
import { frontMatter, parseFrontMatter } from './frontmatter';
import { textBlock } from './segment';

const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/([[\]])/g, '\\$1').trim();

export function libraryReadme(books: readonly BookMeta[], clippings: readonly ClippingMeta[]): string {
  const out = [
    '# Library',
    '',
    'Written by [Slate](https://github.com/preetsingh-007/slate): books and clippings, their annotations, and the app\'s synced settings. Do not edit these files; the app regenerates the derived ones on every sync.',
    '',
    '## Books',
    '',
  ];
  if (books.length) {
    out.push('| Book | Authors | Format | Added |', '| --- | --- | --- | --- |');
    for (const b of [...books].sort((a, c) => a.title.localeCompare(c.title) || a.slug.localeCompare(c.slug))) {
      out.push(`| [${cell(b.title) || b.slug}](books/${b.slug}/book.json) | ${cell((b.authors ?? []).join(', '))} | ${b.format.toUpperCase()} | ${isoDate(b.added)} |`);
    }
  } else out.push('No books yet.');
  out.push('', '## Clippings', '');
  if (clippings.length) {
    out.push('| Clipping | Source | Added |', '| --- | --- | --- |');
    for (const c of [...clippings].sort((a, b) => b.slug.localeCompare(a.slug))) {
      const src = c.url && /^https?:\/\//.test(c.url) ? `[${cell(c.site || hostOf(c.url))}](${c.url.replace(/[()\s]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))})` : cell(c.sourceLabel ?? (c.origin === 'clipboard' ? 'Clipboard' : ''));
      out.push(`| [${cell(c.title) || c.slug}](clippings/${c.slug}/clipping.md) | ${src} | ${isoDate(c.added)} |`);
    }
  } else out.push('No clippings yet.');
  return out.join('\n') + '\n';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function annotationWhere(a: Annotation): { key: string; order: number; label: string } {
  const loc = a.locator;
  if (loc.type === 'pdf') return { key: `p${String(loc.page).padStart(6, '0')}`, order: loc.region?.y ?? 0, label: `Page ${loc.page}` };
  if (loc.type === 'epub') return { key: `c${loc.chapter}`, order: loc.position ?? 0, label: loc.chapter.split('/').pop()!.replace(/\.x?html?$/i, '') || 'Chapter' };
  if (loc.type === 'clipping') return { key: 'c', order: loc.offset ?? 0, label: 'Text' };
  return { key: 'z', order: 0, label: 'Other' };
}

/** `annotations.md`: the book's highlights and notes, grouped by page or chapter. */
export function annotationsMarkdown(book: BookMeta, annotations: readonly Annotation[]): string {
  const out = [`# Annotations: ${book.title.replace(/\s+/g, ' ').trim() || book.slug}`, ''];
  const groups = new Map<string, { label: string; items: { order: number; created: number; id: string; line: string }[] }>();
  for (const a of annotations) {
    const w = annotationWhere(a);
    let g = groups.get(w.key);
    if (!g) groups.set(w.key, (g = { label: w.label, items: [] }));
    const text = textBlock(a.text ?? '').replace(/\n+/g, ' ');
    const line =
      a.kind === 'highlight' ? `- Highlight: ${text ? `“${text}”` : '(no text)'}` : a.kind === 'note' ? `- Note: ${text || '(empty)'}` : `- Ink (${a.strokes?.length ?? 0} stroke${a.strokes?.length === 1 ? '' : 's'})`;
    g.items.push({ order: w.order, created: a.created, id: a.id, line });
  }
  if (!groups.size) out.push('No annotations.');
  for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const g = groups.get(key)!;
    out.push(`## ${g.label}`, '');
    for (const it of g.items.sort((a, b) => a.order - b.order || a.created - b.created || (a.id < b.id ? -1 : 1))) out.push(it.line);
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

/** `clipping.md`: a little front matter (the full metadata is in meta.json) and the Markdown. */
export function clippingMarkdown(meta: ClippingMeta, markdown: string): string {
  return (
    frontMatter([
      ['title', meta.title],
      ['origin', meta.origin],
      ['source', meta.url ?? meta.sourceLabel ?? ''],
      ['added', isoDateTime(meta.added)],
    ]) +
    '\n' +
    markdown.replace(/\s+$/, '') +
    '\n'
  );
}

/** The Markdown body of a clipping.md. */
export function parseClippingMarkdown(text: string): string {
  return parseFrontMatter(text).body.replace(/\n$/, '');
}
