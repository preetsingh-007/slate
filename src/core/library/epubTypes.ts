/** Parsed EPUB (see epub.ts). */

/** Table-of-contents entry inside a parsed EPUB: spine index plus the fragment (#id) in it. */
export interface EpubTocEntry {
  title: string;
  /** spine index */
  chapter?: number;
  fragment?: string;
  children?: EpubTocEntry[];
}

export interface EpubChapter {
  id: string;
  /** zip path of the chapter document; used as the chapter href in locators (S5) */
  href: string;
  title?: string;
}

export interface EpubBook {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  /** dc:date as written (e.g. "1843-09-01") */
  date?: string;
  /** dc:identifier (ISBN / UUID / DOI) */
  identifier?: string;
  toc: EpubTocEntry[];
  chapters: EpubChapter[];
  /** sanitized XHTML body for a chapter; images resolved to object URLs */
  chapterHtml(index: number): Promise<string>;
  /** plain text of the first chapters (search index, identifiers) */
  sampleText(maxChars?: number): Promise<string>;
  /** resolve an href (relative to chapter `from`, or to the OPF when omitted) to a spine index + fragment */
  resolveHref(href: string, from?: number): { chapter: number; fragment?: string } | null;
  coverUrl?: string;
  dispose(): void;
}
