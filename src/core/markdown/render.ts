/**
 * Markdown → sanitised HTML for text boxes, clippings, clip text and the gym reader.
 *
 * - GitHub Flavored Markdown, `$inline$` and `$$display$$` LaTeX rendered with KaTeX;
 * - `- [ ]` task items become enabled checkboxes carrying `data-task="<n>"` (n-th task in the
 *   source), so a click can be mapped back to the text (see tasks.ts);
 * - headings get GitHub-style ids (for gym anchors);
 * - relative links render as `<a href="#" data-rel="path">` and relative images as
 *   `<img data-rel-src="path">`; the viewer resolves them (gym reader, clippings);
 * - external links open in a new tab.
 *
 * Results are cached; math is spliced in after sanitising so DOMPurify only sees prose.
 */
import { Marked, type Token, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { LRU } from '../util/lru';

const mathCache = new LRU<string, string>(4000);

export function renderMath(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  const hit = mathCache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
  } catch {
    html = `<code class="math-error">${escapeHtml(tex)}</code>`;
  }
  mathCache.set(key, html);
  return html;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** GitHub's heading anchor slug (without de-duplication). */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// Per-render state (renders are synchronous, so module state is safe).
let mathSlots: string[] | null = null;
let taskCounter = 0;
let slugCounts: Map<string, number> | null = null;

function mathSlot(html: string): string {
  if (!mathSlots) return html;
  mathSlots.push(html);
  return `<span class="md-m" data-i="${mathSlots.length - 1}"></span>`;
}

function spliceMath(html: string, slots: string[]): string {
  if (!slots.length) return html;
  return html.replace(/<span class="md-m" data-i="(\d+)"><\/span>/g, (_m, i) => slots[Number(i)] ?? '');
}

const displayMath: TokenizerAndRendererExtension = {
  name: 'displayMath',
  level: 'block',
  start: (src) => src.match(/^\s*\$\$/m)?.index,
  tokenizer(src) {
    const m = /^\s*\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: 'displayMath', raw: m[0], text: m[1].trim() };
    return undefined;
  },
  renderer: (t) => `<div class="md-math-display">${mathSlot(renderMath((t as Tokens.Generic).text, true))}</div>`,
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => {
    const i = src.indexOf('$');
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1].trim(), display: true };
    // pandoc rule: no whitespace right inside the delimiters, closing $ not followed by a digit
    m = /^\$(?=\S)((?:\\\$|[^$\n])+?)(?<=\S)\$(?!\d)/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1], display: false };
    return undefined;
  },
  renderer: (t) => {
    const tok = t as Tokens.Generic;
    return tok.display ? `<span class="md-math-block">${mathSlot(renderMath(tok.text, true))}</span>` : mathSlot(renderMath(tok.text, false));
  },
};

const isExternal = (href: string) => /^(https?:|mailto:)/i.test(href);

const marked = new Marked({ gfm: true, breaks: true, extensions: [displayMath, inlineMath] });

marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      if (isExternal(href)) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`;
      if (href.startsWith('#')) return `<a href="#" data-anchor="${escapeHtml(href.slice(1))}"${t}>${text}</a>`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<a href="#"${t}>${text}</a>`; // javascript: etc.
      return `<a href="#" data-rel="${escapeHtml(href)}"${t}>${text}</a>`;
    },
    image({ href, title, text }) {
      const alt = escapeHtml(text);
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      if (/^(data:image\/|blob:)/i.test(href)) return `<img src="${escapeHtml(href)}" alt="${alt}"${t}>`;
      // Network use NFR: the app contacts only GitHub and the fetch helper, so a remote image
      // is a link the reader can open in the browser, never loaded by the app
      if (isRemote(href)) return `<a class="md-remote-image" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${t}>[image${alt ? `: ${alt}` : ''}]</a>`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<span>${alt}</span>`;
      return `<img data-rel-src="${escapeHtml(href)}" alt="${alt}"${t}>`;
    },
    checkbox({ checked }) {
      const n = taskCounter++;
      return `<input type="checkbox" class="md-task" data-task="${n}"${checked ? ' checked' : ''} aria-label="To-do"> `;
    },
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      let slug = headingSlug(tokens);
      if (slugCounts) {
        const n = slugCounts.get(slug) ?? 0;
        slugCounts.set(slug, n + 1);
        if (n) slug = `${slug}-${n}`;
      }
      // the id goes on after sanitising (see purify): DOMPurify drops ids named like document
      // properties ("title", "links"), which would break `#heading` links to such headings
      return `<h${depth} ${HEADING_ID}="${escapeHtml(slug)}">${inner}</h${depth}>\n`;
    },
  },
});

/** Carries a heading's anchor through sanitising. */
const HEADING_ID = 'data-slate-heading-id';
/** An absolute or protocol-relative web URL (another site). */
const isRemote = (url: string) => /^\s*(https?:)?\/\//i.test(url);

let purifyReady = false;
/**
 * DOMPurify with its DOM-clobbering protection on: `id` and `name` attributes that would shadow
 * document or form properties (`<img name="querySelector">`) are removed. Heading anchors are
 * restored afterwards: an id on a heading cannot shadow a document property (only embed, form,
 * iframe, img and object elements are exposed on `document`).
 */
function purify(html: string): string {
  if (!purifyReady) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
      const id = node.getAttribute?.(HEADING_ID);
      if (id != null) {
        node.removeAttribute(HEADING_ID);
        if (/^H[1-6]$/.test(node.tagName)) node.setAttribute('id', id);
      }
      // Network use NFR: raw HTML may point images, media or backgrounds at other sites; the
      // app loads none of them (the CSP would block them too)
      for (const a of ['src', 'srcset', 'poster', 'background']) {
        const v = node.getAttribute(a);
        if (v && (isRemote(v) || (a === 'srcset' && /(^|[\s,])(https?:)?\/\//i.test(v)))) {
          node.removeAttribute(a);
          if (a === 'src') node.setAttribute('data-remote-src', v);
        }
      }
      const style = node.getAttribute('style');
      if (style && /url\(\s*['"]?\s*(https?:)?\/\//i.test(style)) node.setAttribute('style', style.replace(/url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, 'none'));
    });
    purifyReady = true;
  }
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'data-remote-src', 'data-i', 'data-task', 'data-rel', 'data-rel-src', 'data-anchor', 'aria-hidden', 'encoding'],
    ADD_TAGS: ['semantics', 'annotation'],
  });
}

const htmlCache = new LRU<string, string>(3000);

function run(text: string, inline: boolean): string {
  const slots: string[] = [];
  mathSlots = slots;
  taskCounter = 0;
  slugCounts = new Map();
  let raw: string;
  try {
    raw = (inline ? marked.parseInline(text, { async: false }) : marked.parse(text, { async: false })) as string;
  } finally {
    mathSlots = null;
    slugCounts = null;
  }
  return spliceMath(purify(raw), slots);
}

/** Renders Markdown to sanitised HTML (cached). */
export function renderMarkdown(text: string): string {
  const hit = htmlCache.get(text);
  if (hit !== undefined) return hit;
  const html = run(text, false);
  htmlCache.set(text, html);
  return html;
}

/** Inline-only rendering (no paragraphs) for titles and snippets. */
export function renderInline(text: string): string {
  const key = '\u0000i' + text;
  const hit = htmlCache.get(key);
  if (hit !== undefined) return hit;
  const html = run(text, true);
  htmlCache.set(key, html);
  return html;
}

/**
 * Block tokens of a Markdown text from the same parser and extensions as `renderMarkdown`
 * (maths included), with each token's `raw` source. The gym reader uses it to map rendered
 * blocks back to their source (G7, S2).
 */
export function lexMarkdown(text: string): Token[] {
  return marked.lexer(text);
}

/** The anchor slug `renderMarkdown` gives a heading token (before de-duplication). */
export function headingSlug(tokens: Token[]): string {
  return githubSlug(tokens.map((t) => ('text' in t ? t.text : t.raw)).join(''));
}

/** Sanitises arbitrary HTML (clipboard, pages) with the same policy as rendered Markdown. */
export function sanitizeHtml(html: string): string {
  return purify(html);
}
