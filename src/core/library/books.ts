/**
 * Books (L1, L6): reading metadata from PDF and EPUB files, gym's citation format, and the
 * import pipeline. Book files are stored once in the AssetStore under their SHA-256
 * (`BookMeta.fileHash`); a book whose file is missing on this device is matched again by hash
 * when the file is re-imported.
 */
import type { BookMeta, TocEntry } from '../model/types';
import type { AssetStore } from '../storage/assets';
import type { LibraryStore } from '../stores/library';
import { sha256Hex, slugify, uid } from '../util/ids';
import { parseEpub } from './epub';
import type { EpubTocEntry } from './epubTypes';
import { analyzePdf, closePdf, findArxivId, findDoi, openPdf, splitAuthors } from './pdf';
import type { BookBib } from './pdfTypes';

export type BookFormat = 'pdf' | 'epub';

/** Detects PDF and EPUB from the first bytes, falling back to the file name. */
export async function sniffBookFormat(file: Blob, name = ''): Promise<BookFormat | null> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.includes('%PDF-')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    if (ascii.includes('application/epub+zip') || /\.epub$/i.test(name)) return 'epub';
    return null;
  }
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') return 'pdf';
  if (/\.epub$/i.test(name) || file.type === 'application/epub+zip') return 'epub';
  return null;
}

// ---------------------------------------------------------------- citation (gym format)

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "4" / "4th ed." / "fourth" → "4th edition"; other text is kept. */
export function normalizeEdition(edition: string | undefined): string {
  const e = (edition ?? '').trim();
  if (!e) return '';
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const m = /^(\d{1,3})(?:st|nd|rd|th)?\.?(?:\s*(?:ed\.?|edn\.?|edition))?$/i.exec(e);
  if (m) return `${ORDINAL(Number(m[1]))} edition`;
  const w = words.indexOf(e.toLowerCase().replace(/\s*(ed\.?|edition)$/i, '').trim());
  if (w >= 0) return `${ORDINAL(w + 1)} edition`;
  return e;
}

/** "Sheldon Axler" → "Axler, S."; "Lovelace, Ada" → "Lovelace, A."; single names unchanged. */
export function citeName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return '';
  let last: string;
  let firsts: string[];
  if (n.includes(',')) {
    const [l, f] = n.split(',', 2);
    last = l.trim();
    firsts = f.trim().split(' ').filter(Boolean);
  } else {
    const parts = n.split(' ');
    if (parts.length === 1) return n;
    // particles stay with the last name ("van der Waals")
    let i = parts.length - 1;
    while (i > 1 && /^(van|von|der|den|de|del|della|di|da|du|la|le|ter|ten|bin|ibn|al)$/i.test(parts[i - 1])) i--;
    last = parts.slice(i).join(' ');
    firsts = parts.slice(0, i);
  }
  const initials = firsts.map((f) => f.split('-').map((p) => `${p[0]?.toUpperCase() ?? ''}.`).join('-')).join(' ');
  return initials ? `${last}, ${initials}` : last;
}

/**
 * Citation in gym's reference format: author, title, edition (and year when known), e.g.
 * `Axler, S., Linear Algebra Done Right, 4th edition, 2024`. Three or more authors become
 * `First, F., et al.`.
 */
export function citationFor(b: { authors: string[]; title: string; edition?: string; year?: number }): string {
  const names = b.authors.map(citeName).filter(Boolean);
  const author = names.length === 0 ? '' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, et al.`;
  const parts = [author, b.title.trim(), normalizeEdition(b.edition), b.year ? String(b.year) : ''].filter(Boolean);
  return parts.join(', ');
}

// ---------------------------------------------------------------- reading metadata

export interface BookFileInfo {
  format: BookFormat;
  title: string;
  authors: string[];
  year?: number;
  pages?: number;
  toc: TocEntry[];
  bib: BookBib;
}

/** EPUB TOC → Slate TOC (chapter href with optional #fragment). */
export function epubTocToToc(entries: EpubTocEntry[], chapters: { href: string }[]): TocEntry[] {
  return entries.map((e) => {
    const out: TocEntry = { title: e.title };
    if (e.chapter !== undefined && chapters[e.chapter]) out.href = chapters[e.chapter].href + (e.fragment ? `#${e.fragment}` : '');
    if (e.children?.length) out.children = epubTocToToc(e.children, chapters);
    return out;
  });
}

const fileBase = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';

/** Reads title, authors, year, pages and TOC from a PDF (Info/XMP, then page 1) or EPUB (OPF). */
export async function readBookFile(file: Blob, name: string, format?: BookFormat): Promise<BookFileInfo> {
  const fmt = format ?? (await sniffBookFormat(file, name));
  if (!fmt) throw new Error('Only PDF and EPUB files can be imported as books.');
  if (fmt === 'pdf') {
    const pdf = await openPdf(new Uint8Array(await file.arrayBuffer()), { transfer: true });
    try {
      const a = await analyzePdf(pdf, { fileName: name });
      return {
        format: 'pdf',
        title: a.title ?? fileBase(name),
        authors: a.bib.authors ?? [],
        year: a.bib.year,
        pages: a.pageCount,
        toc: a.toc,
        bib: a.bib,
      };
    } finally {
      await closePdf(pdf);
    }
  }
  const book = await parseEpub(file);
  try {
    const sample = await book.sampleText(20000);
    const year = Number(/^(\d{4})/.exec(book.date ?? '')?.[1]) || undefined;
    const bib: BookBib = { title: book.title, authors: book.authors, entryType: 'book' };
    if (year) bib.year = year;
    if (book.publisher) bib.publisher = book.publisher;
    const doi = findDoi(book.identifier) ?? findDoi(sample);
    if (doi) bib.doi = doi;
    const arxiv = findArxivId(sample);
    if (arxiv) bib.arxiv = arxiv;
    return {
      format: 'epub',
      title: book.title && book.title !== 'Untitled' ? book.title : fileBase(name),
      authors: splitAuthors(book.authors),
      year,
      toc: epubTocToToc(book.toc, book.chapters),
      bib,
    };
  } finally {
    book.dispose();
  }
}

/** A folder name under library/books/ not used by another book or a pending deletion. */
export function uniqueSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title, 50);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export interface ImportResult {
  book: BookMeta;
  /** true when the file matched a book already in the library (L6) */
  existing: boolean;
}

/**
 * Imports a book file (L1): stores the file by hash (refusing files over 50 MB unless Git LFS
 * mode is on, R7) and creates its metadata. A file whose hash matches an existing book is not
 * imported twice: it restores that book's file on this device (L6).
 */
export async function importBookFile(deps: { library: LibraryStore; assets: AssetStore }, file: Blob, name: string, now = Date.now()): Promise<ImportResult> {
  const format = await sniffBookFormat(file, name);
  if (!format) throw new Error(`${name} is not a PDF or EPUB file.`);
  const fileHash = await sha256Hex(file);
  const existing = deps.library.books().find((b) => b.fileHash === fileHash);
  await deps.assets.put(file);
  if (existing) return { book: existing, existing: true };
  const info = await readBookFile(file, name, format);
  const taken = [...deps.library.books().map((b) => b.slug), ...deps.library.tombstones().filter((t) => t.kind === 'book').map((t) => t.slug)];
  const book: BookMeta = {
    id: uid(),
    slug: uniqueSlug(info.title, taken),
    format,
    title: info.title,
    authors: info.authors,
    citation: citationFor({ authors: info.authors, title: info.title, year: info.year }),
    fileHash,
    fileName: name,
    size: file.size,
    added: now,
    topics: [],
  };
  if (info.year) book.year = info.year;
  if (info.pages) book.pages = info.pages;
  if (info.toc.length) book.toc = info.toc;
  await deps.library.putBook(book);
  return { book, existing: false };
}

/**
 * Stores a re-imported file for a book whose file is missing on this device (L6). Returns
 * false (and stores nothing) when the file is not the book's file.
 */
export async function restoreBookFile(deps: { assets: AssetStore }, book: BookMeta, file: Blob): Promise<boolean> {
  const hash = await sha256Hex(file);
  if (hash !== book.fileHash) return false;
  await deps.assets.put(file);
  return true;
}

/** Applies edited metadata and recomputes the citation (L1: all fields editable). */
export function editBook(book: BookMeta, patch: Partial<Pick<BookMeta, 'title' | 'authors' | 'year' | 'edition' | 'topics'>>): BookMeta {
  const next: BookMeta = { ...book, ...patch };
  if (!next.edition) delete next.edition;
  if (!next.year) delete next.year;
  next.citation = citationFor({ authors: next.authors, title: next.title, edition: next.edition, year: next.year });
  return next;
}
