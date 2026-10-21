/**
 * Special links (L10): PDF links are offered as books, arXiv abstract pages offer their PDF
 * (and their HTML version as an article), everything else is a web page.
 */

export interface LinkKind {
  kind: 'pdf' | 'arxiv-abs' | 'page';
  url: string;
  /** arXiv identifier (with version when given) */
  arxiv?: string;
  /** PDF of the paper (arXiv) */
  pdfUrl?: string;
  /** arXiv's HTML rendering of the paper */
  htmlUrl?: string;
}

const ARXIV_ID = /(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/;

/** Normalises user input into an http(s) URL, or null. Accepts bare domains ("example.org/x"). */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^arxiv:/i.test(s)) s = `https://arxiv.org/abs/${s.slice(6).trim()}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** True when the text is just one URL (offer New from link for it, S9). */
export function isUrl(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) && normalizeUrl(t) !== null;
}

/** Classifies a URL before fetching it. */
export function classifyUrl(raw: string): LinkKind {
  const url = normalizeUrl(raw) ?? raw;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'page', url };
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const abs = new RegExp(`^/abs/${ARXIV_ID.source}`).exec(u.pathname);
    if (abs) return { kind: 'arxiv-abs', url, arxiv: abs[1], pdfUrl: `https://arxiv.org/pdf/${abs[1]}`, htmlUrl: `https://arxiv.org/html/${abs[1]}` };
    const pdf = new RegExp(`^/pdf/${ARXIV_ID.source}`).exec(u.pathname);
    if (pdf) return { kind: 'pdf', url, arxiv: pdf[1].replace(/\.pdf$/, ''), pdfUrl: url };
  }
  if (/\.pdf$/i.test(u.pathname)) return { kind: 'pdf', url, pdfUrl: url };
  return { kind: 'page', url };
}

/** True when a downloaded resource is a PDF (by type or by its first bytes). */
export function isPdfResponse(contentType: string, bytes: Uint8Array): boolean {
  if (/application\/(x-)?pdf/i.test(contentType)) return true;
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  return head.startsWith('%PDF-');
}

/**
 * arXiv abstract pages served from another mirror (or fetched page HTML) link their PDF with
 * `citation_pdf_url`; returns it when present.
 */
export function pdfLinkFromPage(html: string, base: string): string | null {
  const m = /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1], base).toString();
  } catch {
    return null;
  }
}

/** File name for a PDF downloaded from a URL. */
export function fileNameFromUrl(url: string, fallback = 'document.pdf'): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    if (!last) return fallback;
    return /\.pdf$/i.test(last) ? last : `${last}.pdf`;
  } catch {
    return fallback;
  }
}
