/** Types shared by PDF analysis (pdf.ts) and reading-order extraction (extract.ts). */
import type { TocEntry } from '../model/types';

/** A positioned run of text on a page, in PDF points with origin at the top-left. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontName?: string;
  /** true when the item ends a line according to the PDF producer */
  eol?: boolean;
  /** text rotation in degrees (0 = horizontal, left-to-right); omitted when 0 */
  angle?: number;
  /** style hints when known (synthetic items, tagged PDFs) */
  bold?: boolean;
  italic?: boolean;
}

/** Bibliographic metadata read from a file or looked up (L1). */
export interface BookBib {
  title?: string;
  authors?: string[];
  year?: number;
  edition?: string;
  venue?: string;
  publisher?: string;
  doi?: string;
  arxiv?: string;
  url?: string;
  abstract?: string;
  /** article, book, misc… */
  entryType?: string;
}

/** Result of analysing a PDF once at import time. */
export interface PdfAnalysis {
  pageCount: number;
  title?: string;
  bib: BookBib;
  toc: TocEntry[];
  /** landscape presentation deck */
  isSlides: boolean;
  /** first pages' plain text (identifier lookup) */
  sampleText: string;
  /** size of page 1 in PDF points (rotation applied) */
  pageSize?: { width: number; height: number };
  /** true when the outline was larger than the configured caps and was cut */
  tocTruncated?: boolean;
}
