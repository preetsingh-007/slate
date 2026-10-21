/**
 * Rendering a gym Markdown file for the reader (G7): block by block with the shared renderer
 * (GitHub Flavored Markdown, KaTeX), each block, list item, table row and code block tagged
 * with its source range (`data-s`, `data-e`) so lasso captures map back to the source (S2)
 * and source links find their place again (S6).
 */
import { parseFrontMatter } from '../../core/gym/frontmatter';
import { mimeOf, resolveLink } from '../../core/gym/paths';
import { layoutDoc, type DocLayout } from '../../core/gym/sourceMap';
import { escapeHtml, renderMarkdown } from '../../core/markdown/render';

export interface GymDoc {
  text: string;
  fields: Record<string, string> | null;
  bodyStart: number;
  layout: DocLayout;
  html: string;
}

export function renderGymDoc(text: string): GymDoc {
  const fm = parseFrontMatter(text);
  const layout = layoutDoc(text, fm.bodyStart);
  // link definitions are appended to every block so reference links render on their own
  const defs = layout.defs ? `\n\n${layout.defs}\n` : '';
  const html = layout.blocks
    .map((b, i) => `<div class="gym-block" data-b="${i}" data-s="${b.start}" data-e="${b.end}">${renderMarkdown(defs ? b.raw.trimEnd() + defs : b.raw)}</div>`)
    .join('');
  return { text, fields: fm.fields, bodyStart: fm.bodyStart, layout, html };
}

const setRange = (el: Element, r: { start: number; end: number }) => {
  el.setAttribute('data-s', String(r.start));
  el.setAttribute('data-e', String(r.end));
};

/** Tags list items, table rows and code blocks, and de-duplicates heading anchors across blocks. */
export function annotate(article: HTMLElement, layout: DocLayout) {
  for (const div of article.querySelectorAll<HTMLElement>(':scope > .gym-block')) {
    const block = layout.blocks[Number(div.dataset.b)];
    if (!block) continue;
    if (block.items) {
      const list = div.querySelector(':scope > ul, :scope > ol');
      const lis = list ? [...list.children].filter((c) => c.tagName === 'LI') : [];
      if (lis.length === block.items.length) lis.forEach((li, i) => setRange(li, block.items![i]));
      else delete block.items; // the renderer disagreed with the lexer: capture the list whole
    } else if (block.rows) {
      const trs = [...div.querySelectorAll(':scope > table tr')];
      if (trs.length === block.rows.length - 1) trs.forEach((tr, i) => setRange(tr, block.rows![i === 0 ? 0 : i + 1]));
      else delete block.rows;
    } else if (block.code) {
      div.querySelector(':scope > pre')?.setAttribute('data-code', '');
    }
  }
  // blocks render separately, so repeated headings all got the base slug: number them like GitHub
  const counts = new Map<string, number>();
  for (const h of article.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
    const n = counts.get(h.id) ?? 0;
    counts.set(h.id, n + 1);
    if (n) h.id = `${h.id}-${n}`;
  }
}

/**
 * Resolves relative images (`<img data-rel-src>`) to blob URLs read from the mirror, relative
 * to the file. `done` settles when every image has loaded (or failed); `cleanup` revokes the URLs.
 */
export function loadImages(article: HTMLElement, file: string, readBlob: (p: string) => Promise<Blob | null>): { done: Promise<void>; cleanup: () => void } {
  const urls: string[] = [];
  let live = true;
  const jobs: Promise<unknown>[] = [];
  for (const img of article.querySelectorAll<HTMLImageElement>('img[data-rel-src]')) {
    const target = resolveLink(file, img.getAttribute('data-rel-src') ?? '');
    if (!target) continue;
    jobs.push(
      readBlob(target.path).then((blob) => {
        if (!live) return;
        if (!blob) {
          img.classList.add('gym-missing');
          img.title = `${target.path} is not available offline`;
          return;
        }
        // the mirror may store bytes without a type; SVG only renders with its MIME type
        const typed = blob.type ? blob : new Blob([blob], { type: mimeOf(target.path) });
        const url = URL.createObjectURL(typed);
        urls.push(url);
        img.src = url;
        return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined;
      }),
    );
  }
  return {
    done: Promise.all(jobs).then(() => undefined),
    cleanup: () => {
      live = false;
      for (const u of urls) URL.revokeObjectURL(u);
    },
  };
}

/** A plain-text file (code, requirements) as an escaped code block. */
export function renderPlain(text: string): string {
  return `<pre class="gym-plain"><code>${escapeHtml(text)}</code></pre>`;
}
