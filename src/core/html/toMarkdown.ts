/**
 * HTML → Markdown for clipboard answers (L7), web articles (L8 Reader view) and lassoed HTML
 * regions (S2: EPUB chapters, clippings, gym files). Adapted from Axiom's domExtract and
 * extended to whole documents.
 *
 * Keeps headings, paragraphs, lists (nested, ordered, tasks), links, images, emphasis, inline
 * and fenced code (with the language), block quotes, tables (GFM) and maths. Maths is written
 * as `$…$` / `$$…$$` LaTeX taken from, in order: KaTeX's MathML annotation
 * (`annotation[encoding="application/x-tex"]`), a `<math alttext>` (arXiv/LaTeXML, Wikipedia),
 * MathJax `script[type^="math/tex"]`, or a best-effort conversion of presentation MathML.
 *
 * Input HTML is sanitised with DOMPurify first. Everything runs on an inert document
 * (DOMParser), so page scripts never run.
 */
import DOMPurify from 'dompurify';

export interface ToMarkdownOptions {
  /** URL the HTML came from: relative links and images are resolved against it */
  baseUrl?: string;
  /**
   * Maps an absolute image URL to the reference written in the Markdown (e.g.
   * `assets/<hash>.<ext>`), or null to drop the image (alt text is kept).
   * Default: keep http(s) URLs, drop others.
   */
  image?(url: string): string | null;
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'SUMMARY', 'TABLE', 'UL', 'CENTER',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO', 'HEAD', 'TITLE', 'META', 'LINK']);

// ---------------------------------------------------------------- entry points

/** Parses and sanitises an HTML string (fragment or document) into an inert body element. */
export function parseHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  preprocessMath(doc);
  const clean = DOMPurify.sanitize(doc.body.innerHTML, {
    ADD_TAGS: ['semantics', 'annotation', 'math'],
    ADD_ATTR: ['encoding', 'alttext', 'display', 'data-tex', 'data-display', 'start', 'checked', 'type', 'class', 'data-language', 'lang'],
    FORBID_TAGS: ['style', 'form'],
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  dropCodeLabels(clean);
  return clean;
}

/**
 * Chatbot UIs put the code block's language ("python") in a header next to the <pre>; the
 * fence already carries it, so the header text is removed.
 */
function dropCodeLabels(root: Element) {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const lang = languageOf(pre.querySelector('code') ?? pre)?.toLowerCase();
    if (!lang) continue;
    let node: Element | null = pre;
    for (let depth = 0; node && node !== root && depth < 4; depth++, node = node.parentElement) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (!sib.querySelector('pre') && (sib.textContent ?? '').trim().toLowerCase() === lang) sib.remove();
      }
      // labels inside the <pre> itself (ChatGPT) are skipped by codeBlock()
    }
  }
}

/** Converts an HTML string to Markdown. */
export function htmlToMarkdown(html: string, opts: ToMarkdownOptions = {}): string {
  return nodeToMarkdown(parseHtml(html), opts);
}

/** Converts a DOM node (element, fragment or a range's contents) to Markdown. */
export function nodeToMarkdown(node: Node, opts: ToMarkdownOptions = {}): string {
  const ctx: Ctx = { opts, listDepth: 0 };
  const out = blocks(node, ctx);
  return tidy(out);
}

/** Plain text of HTML with paragraph breaks (for the Plain view and search). */
export function htmlToText(html: string): string {
  return tidy(textOf(parseHtml(html)));
}

function textOf(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const el = node as Element;
  if (node.nodeType === 1 && SKIP.has(el.tagName)) return '';
  if (node.nodeType === 1 && isMathRoot(el)) return mathTex(el)?.tex ?? el.textContent ?? '';
  let s = '';
  for (const c of Array.from(node.childNodes)) s += textOf(c);
  if (node.nodeType === 1 && (BLOCK.has(el.tagName) || el.tagName === 'BR')) s = `\n${s.trim()}\n`;
  return s;
}

// ---------------------------------------------------------------- maths

/** Turns MathJax script tags and MathJax 3 containers into `<span data-tex>` before sanitising. */
function preprocessMath(doc: Document) {
  for (const s of Array.from(doc.querySelectorAll('script[type^="math/tex"]'))) {
    const span = doc.createElement('span');
    span.setAttribute('data-tex', s.textContent ?? '');
    if (/mode=display/.test(s.getAttribute('type') ?? '')) span.setAttribute('data-display', 'block');
    s.replaceWith(span);
  }
  // MathJax 2 previews and rendered copies duplicate the script's content
  for (const el of Array.from(doc.querySelectorAll('.MathJax_Preview, .MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML'))) el.remove();
  // MathJax 3: <mjx-container display="true"><mjx-assistive-mml><math>…
  for (const c of Array.from(doc.querySelectorAll('mjx-container'))) {
    const math = c.querySelector('math');
    if (math) {
      if (c.getAttribute('display') === 'true') math.setAttribute('display', 'block');
      c.replaceWith(math);
    } else c.remove();
  }
}

function isMathRoot(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'math') return true;
  if (el.hasAttribute('data-tex')) return true;
  const cls = el.getAttribute('class') ?? '';
  return /(^|\s)(katex|katex-display|mwe-math-element)(\s|$)/.test(cls);
}

const TEX_ENCODINGS = /^(application\/(x-)?tex|text\/(x-)?latex|application\/x-latex|TeX|LaTeX)$/i;

/** LaTeX source of a maths element, and whether it is display maths. */
export function mathTex(el: Element): { tex: string; display: boolean } | null {
  const cls = el.getAttribute('class') ?? '';
  if (el.hasAttribute('data-tex')) return { tex: el.getAttribute('data-tex')!.trim(), display: el.getAttribute('data-display') === 'block' };
  const math = el.tagName.toLowerCase() === 'math' ? el : el.querySelector('math');
  let display = /katex-display/.test(cls) || !!el.closest?.('.katex-display') || math?.getAttribute('display') === 'block';
  if (/mwe-math-element/.test(cls) && el.querySelector('.mwe-math-mathml-display, [display="block"]')) display = true;
  const ann = [...el.querySelectorAll('annotation')].find((a) => TEX_ENCODINGS.test(a.getAttribute('encoding') ?? ''));
  let tex = ann?.textContent?.trim();
  if (!tex && math?.getAttribute('alttext')) tex = math.getAttribute('alttext')!.trim();
  if (!tex && math) tex = mathmlToTex(math).trim();
  if (!tex) return null;
  // Wikipedia wraps its alttext in {\displaystyle …}
  const ds = /^\{\\displaystyle\s*([\s\S]*)\}$/.exec(tex);
  if (ds) tex = ds[1].trim();
  return { tex, display };
}

const MO_MAP: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∞': '\\infty', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
  '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq',
  '∪': '\\cup', '∩': '\\cap', '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '±': '\\pm', '∂': '\\partial', '∇': '\\nabla',
  '∀': '\\forall', '∃': '\\exists', '−': '-', '…': '\\ldots', '⋯': '\\cdots', '∘': '\\circ', '⟨': '\\langle', '⟩': '\\rangle',
  '{': '\\{', '}': '\\}', '∥': '\\|', '‖': '\\|',
};
const MI_MAP: Record<string, string> = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ϵ: '\\epsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta',
  ι: '\\iota', κ: '\\kappa', λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau',
  υ: '\\upsilon', φ: '\\varphi', ϕ: '\\phi', χ: '\\chi', ψ: '\\psi', ω: '\\omega', Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta',
  Λ: '\\Lambda', Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega', ℝ: '\\mathbb{R}', ℕ: '\\mathbb{N}',
  ℤ: '\\mathbb{Z}', ℚ: '\\mathbb{Q}', ℂ: '\\mathbb{C}', ℓ: '\\ell',
};

const group = (s: string) => (s.length === 1 ? s : `{${s}}`);

/** Best-effort presentation MathML → LaTeX (used only when no TeX source is embedded). */
export function mathmlToTex(el: Element): string {
  const kids = () => Array.from(el.children).map(mathmlToTex);
  const tag = el.tagName.toLowerCase().replace(/^m:/, '');
  const text = (el.textContent ?? '').trim();
  switch (tag) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'semantics':
    case 'mphantom':
      return Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() !== 'annotation' && c.tagName.toLowerCase() !== 'annotation-xml')
        .map(mathmlToTex)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'mi':
      return MI_MAP[text] ?? (text.length > 1 ? `\\mathrm{${text}}` : text);
    case 'mn':
      return text;
    case 'mo':
      return MO_MAP[text] ?? text;
    case 'mtext':
      return text ? `\\text{${text}}` : '';
    case 'mspace':
      return '\\,';
    case 'msup': {
      const [b, s] = kids();
      return `${group(b ?? '')}^${group(s ?? '')}`;
    }
    case 'msub': {
      const [b, s] = kids();
      return `${group(b ?? '')}_${group(s ?? '')}`;
    }
    case 'msubsup': {
      const [b, s, p] = kids();
      return `${group(b ?? '')}_${group(s ?? '')}^${group(p ?? '')}`;
    }
    case 'munder': {
      const [b, s] = kids();
      return `${group(b ?? '')}_${group(s ?? '')}`;
    }
    case 'mover': {
      const [b, s] = kids();
      if (s === '^' || s === '\\hat') return `\\hat{${b}}`;
      if (s === '¯' || s === '‾' || s === '-') return `\\overline{${b}}`;
      if (s === '~') return `\\tilde{${b}}`;
      return `${group(b ?? '')}^${group(s ?? '')}`;
    }
    case 'munderover': {
      const [b, s, p] = kids();
      return `${group(b ?? '')}_${group(s ?? '')}^${group(p ?? '')}`;
    }
    case 'mfrac': {
      const [a, b] = kids();
      return `\\frac{${a ?? ''}}{${b ?? ''}}`;
    }
    case 'msqrt':
      return `\\sqrt{${kids().join(' ')}}`;
    case 'mroot': {
      const [a, b] = kids();
      return `\\sqrt[${b ?? ''}]{${a ?? ''}}`;
    }
    case 'mfenced': {
      const open = el.getAttribute('open') ?? '(';
      const close = el.getAttribute('close') ?? ')';
      return `\\left${open} ${kids().join(', ')} \\right${close}`;
    }
    case 'mtable':
      return `\\begin{matrix} ${Array.from(el.children)
        .map((tr) => Array.from(tr.children).map(mathmlToTex).join(' & '))
        .join(' \\\\ ')} \\end{matrix}`;
    case 'mtd':
    case 'mtr':
      return kids().join(' ');
    case 'annotation':
    case 'annotation-xml':
      return '';
    default:
      return kids().join(' ') || text;
  }
}

// ---------------------------------------------------------------- conversion

interface Ctx {
  opts: ToMarkdownOptions;
  listDepth: number;
}

/** Converts children of `node` as a sequence of blocks separated by blank lines. */
function blocks(node: Node, ctx: Ctx): string {
  const out: string[] = [];
  let inline = '';
  const flush = () => {
    const t = inline.replace(/[ \t]+\n/g, '\n').trim();
    if (t) out.push(escapeBlockStart(t));
    inline = '';
  };
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 1) {
      const el = c as Element;
      if (SKIP.has(el.tagName)) continue;
      if (isMathRoot(el)) {
        const m = mathTex(el);
        if (m?.display) {
          flush();
          out.push(`$$\n${m.tex}\n$$`);
        } else inline += m ? `$${m.tex}$` : '';
        continue;
      }
      if (isBlock(el)) {
        flush();
        const b = block(el, ctx);
        if (b.trim()) out.push(b);
        continue;
      }
    }
    inline += inlineOf(c, ctx);
  }
  flush();
  return out.join('\n\n');
}

function isBlock(el: Element): boolean {
  if (BLOCK.has(el.tagName)) return true;
  // a span/div wrapper holding blocks (e.g. ChatGPT's code header wrappers) behaves as a block
  return false;
}

function block(el: Element, ctx: Ctx): string {
  const tag = el.tagName;
  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const t = inlineChildren(el, ctx).replace(/\s+/g, ' ').trim();
      return t ? `${'#'.repeat(Number(tag[1]))} ${t}` : '';
    }
    case 'P':
      return escapeBlockStart(inlineChildren(el, ctx).replace(/[ \t]+\n/g, '\n').trim());
    case 'HR':
      return '---';
    case 'PRE':
      return codeBlock(el);
    case 'BLOCKQUOTE': {
      const inner = blocks(el, ctx);
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    }
    case 'UL':
    case 'OL':
      return list(el, ctx);
    case 'LI':
      return list(el.ownerDocument!.createElement('ul').appendChild(el.cloneNode(true)).parentElement!, ctx);
    case 'TABLE':
      return table(el, ctx);
    case 'DL':
      return Array.from(el.children)
        .map((c) => (c.tagName === 'DT' ? `**${inlineChildren(c, ctx).trim()}**` : blocks(c, ctx)))
        .join('\n\n');
    case 'FIGURE':
      return blocks(el, ctx);
    case 'FIGCAPTION':
      return `*${inlineChildren(el, ctx).trim()}*`;
    case 'DETAILS':
    case 'SUMMARY':
    default:
      return blocks(el, ctx);
  }
}

function codeBlock(pre: Element): string {
  // ChatGPT and Claude wrap the <code> in headers and copy buttons inside <pre>
  const code = pre.querySelector('code') ?? pre;
  const lang = languageOf(code) ?? languageOf(pre) ?? '';
  const text = (code.textContent ?? '').replace(/\n$/, '');
  const fence = text.includes('```') ? '````' : '```';
  return `${fence}${lang}\n${text}\n${fence}`;
}

function languageOf(el: Element): string | undefined {
  const cls = el.getAttribute('class') ?? '';
  const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls);
  if (m) return m[1];
  return el.getAttribute('data-language') ?? undefined;
}

function list(el: Element, ctx: Ctx): string {
  const ordered = el.tagName === 'OL';
  let n = Number(el.getAttribute('start') ?? '1') || 1;
  const lines: string[] = [];
  const sub: Ctx = { ...ctx, listDepth: ctx.listDepth + 1 };
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    const marker = ordered ? `${n++}.` : '-';
    let task = '';
    const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
    if (box) task = box.hasAttribute('checked') ? '[x] ' : '[ ] ';
    const body = blocks(li, sub).replace(/^\s+/, '');
    const pad = ' '.repeat(marker.length + 1);
    const [first, ...rest] = body.split('\n');
    lines.push(`${marker} ${task}${first ?? ''}`);
    for (const r of rest) lines.push(r ? pad + r : '');
  }
  // tight list unless an item spans several paragraphs
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function table(el: Element, ctx: Ctx): string {
  const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
  if (!rows.length) return '';
  const cells = rows.map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => inlineChildren(c, ctx).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')),
  );
  const width = Math.max(...cells.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = cells.map(pad);
  const line = (r: string[]) => `| ${r.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
}

function inlineChildren(el: Node, ctx: Ctx): string {
  let s = '';
  for (const c of Array.from(el.childNodes)) s += inlineOf(c, ctx);
  return s;
}

function inlineOf(node: Node, ctx: Ctx): string {
  if (node.nodeType === 3) return escapeInline((node.nodeValue ?? '').replace(/\s+/g, ' '));
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const el = node as Element;
  if (node.nodeType === 11) return inlineChildren(node, ctx);
  if (SKIP.has(el.tagName)) return '';
  if (isMathRoot(el)) {
    const m = mathTex(el);
    if (!m) return '';
    return m.display ? `\n\n$$\n${m.tex}\n$$\n\n` : `$${m.tex}$`;
  }
  // block inside inline context (e.g. <p> in <li>): keep its breaks
  if (isBlock(el)) return `\n\n${block(el, ctx)}\n\n`;
  switch (el.tagName) {
    case 'BR':
      return '  \n';
    case 'STRONG':
    case 'B':
      return wrapInline(inlineChildren(el, ctx), '**');
    case 'EM':
    case 'I':
    case 'CITE':
    case 'DFN':
      return wrapInline(inlineChildren(el, ctx), '*');
    case 'DEL':
    case 'S':
    case 'STRIKE':
      return wrapInline(inlineChildren(el, ctx), '~~');
    case 'SUP':
      return `<sup>${inlineChildren(el, ctx).trim()}</sup>`;
    case 'SUB':
      return `<sub>${inlineChildren(el, ctx).trim()}</sub>`;
    case 'CODE':
    case 'KBD':
    case 'SAMP':
    case 'TT': {
      const t = (el.textContent ?? '').replace(/\s+/g, ' ');
      if (!t.trim()) return '';
      const ticks = /`/.test(t) ? '``' : '`';
      return `${ticks}${ticks.length > 1 ? ' ' : ''}${t}${ticks.length > 1 ? ' ' : ''}${ticks}`;
    }
    case 'A': {
      const text = inlineChildren(el, ctx).replace(/\s+/g, ' ').trim();
      const href = resolveUrl(el.getAttribute('href') ?? '', ctx.opts.baseUrl);
      if (!href || !/^(https?:|mailto:)/i.test(href)) return text;
      if (!text) return `<${href}>`;
      return `[${text}](${encodeLinkTarget(href)})`;
    }
    case 'IMG': {
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]\n]/g, ' ').trim();
      const src = resolveUrl(el.getAttribute('src') ?? '', ctx.opts.baseUrl);
      const mapped = src ? (ctx.opts.image ? ctx.opts.image(src) : /^https?:/i.test(src) ? src : null) : null;
      if (!mapped) return alt ? escapeInline(alt) : '';
      return `![${alt}](${encodeLinkTarget(mapped)})`;
    }
    case 'INPUT':
      return '';
    default:
      return inlineChildren(el, ctx);
  }
}

function wrapInline(inner: string, mark: string): string {
  const t = inner.trim();
  if (!t) return inner;
  const lead = /^\s*/.exec(inner)![0];
  const trail = /\s*$/.exec(inner)![0];
  return `${lead}${mark}${t}${mark}${trail}`;
}

/** Resolves a URL against the base; returns '' for unusable (javascript:, data: without base…). */
export function resolveUrl(href: string, base?: string): string {
  const h = href.trim();
  if (!h) return '';
  if (/^(javascript|vbscript|data|blob|file):/i.test(h)) return /^data:image\//i.test(h) ? h : '';
  try {
    return base ? new URL(h, base).toString() : /^[a-z][a-z0-9+.-]*:/i.test(h) ? new URL(h).toString() : '';
  } catch {
    return '';
  }
}

function encodeLinkTarget(url: string): string {
  return url.replace(/[ ()<>]/g, (c) => encodeURIComponent(c));
}

function escapeInline(s: string): string {
  return s.replace(/([\\`*_[\]$<])/g, '\\$1');
}

function escapeBlockStart(s: string): string {
  return s.replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s|={3,}|-{3,})/, '\\$1');
}

function tidy(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, (m) => (m === '  ' ? m : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
