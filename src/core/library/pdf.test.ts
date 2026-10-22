// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzePdf,
  closePdf,
  arxivYear,
  configurePdfjs,
  extractPageMarkdown,
  findAbstract,
  findArxivId,
  findDoi,
  getPageTextItems,
  isGarbageTitle,
  iteratePageTexts,
  openPdf,
  parseAuthorLine,
  parsePdfDate,
  splitAuthors,
} from './pdf';
import { itemsToMarkdown, selectItemsInPolygon } from './extract';
import { makeBookPdf, makePaperPdf, PAPER } from '../../test/fixtures';


beforeAll(() => {
  configurePdfjs({ assetBase: null });
});

describe('identifier helpers (L1)', () => {
  it('findDoi strips trailing punctuation and unbalanced parens', () => {
    expect(findDoi('DOI: 10.5555/axiom.2024.0042.')).toBe('10.5555/axiom.2024.0042');
    expect(findDoi('see (https://doi.org/10.1145/3290605.3300234), p. 3')).toBe('10.1145/3290605.3300234');
    expect(findDoi('doi:10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0')).toBe('10.1002/(SICI)1097-4571(199806)49:8');
    expect(findDoi('no identifier here')).toBeUndefined();
  });

  it('findArxivId handles new, old and URL styles', () => {
    expect(findArxivId('arXiv:2101.00001v2 [cs.LG] 5 Jan 2021')).toBe('2101.00001v2');
    expect(findArxivId('see https://arxiv.org/abs/1706.03762')).toBe('1706.03762');
    expect(findArxivId('preprint hep-th/9901001v1')).toBe('hep-th/9901001v1');
    expect(findArxivId('arxiv.org/abs/math.GT/0309136')).toBe('math.GT/0309136');
    expect(findArxivId('version 2101.00001 of nothing')).toBeUndefined();
    expect(arxivYear('2101.00001v2')).toBe(2021);
    expect(arxivYear('hep-th/9901001')).toBe(1999);
    expect(arxivYear('math/0309136')).toBe(2003);
  });

  it('isGarbageTitle / splitAuthors / parseAuthorLine / parsePdfDate', () => {
    expect(isGarbageTitle('Microsoft Word - paper_final_v3.docx')).toBe(true);
    expect(isGarbageTitle('untitled')).toBe(true);
    expect(isGarbageTitle('paper_final_v3')).toBe(true);
    expect(isGarbageTitle('main.tex')).toBe(true);
    expect(isGarbageTitle('report', 'report.pdf')).toBe(true);
    expect(isGarbageTitle('Attention Is All You Need')).toBe(false);
    expect(splitAuthors('Edsger Dijkstra; Barbara Liskov')).toEqual(['Edsger Dijkstra', 'Barbara Liskov']);
    expect(splitAuthors('Ada Lovelace, Alan Turing and Grace Hopper')).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
    expect(splitAuthors('Lovelace, Ada')).toEqual(['Lovelace, Ada']);
    expect(splitAuthors('Administrator')).toEqual([]);
    expect(parseAuthorLine('Ada Lovelace1,2, Alan Turing*, and Grace Hopper†')).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
    expect(parseAuthorLine('Department of Computer Science, University of Somewhere')).toEqual([]);
    expect(parsePdfDate('D:20240315120000Z')?.getUTCFullYear()).toBe(2024);
    expect(parsePdfDate('garbage')).toBeUndefined();
  });

  it('findAbstract', () => {
    const t = 'Title\n\nAbstract\nWe study the problem of reading order reconstruction in scanned and born-digital documents at scale.\n\n1 Introduction\nText';
    expect(findAbstract(t)).toMatch(/^We study the problem/);
  });
});

describe('pdf.js on generated fixtures (L1, L2, S2)', () => {
  it('analyzes the two-column paper: heuristic title and authors over garbage Info, DOI, outline', async () => {
    const pdf = await openPdf(await makePaperPdf());
    const a = await analyzePdf(pdf, { fileName: 'paper.pdf' });
    expect(a.pageCount).toBe(3);
    expect(a.isSlides).toBe(false);
    expect(a.title).toBe(PAPER.title);
    expect(a.bib.authors).toEqual(PAPER.authors);
    expect(a.bib.doi).toBe(PAPER.doi);
    expect(a.bib.year).toBe(2024);
    expect(a.toc.map((t) => t.title)).toEqual(['Introduction', 'Method', 'Conclusion']);
    expect(a.toc[1].children?.[0]).toMatchObject({ title: 'Objective', page: 2 });
    expect(a.toc[2].page).toBe(3);
    expect(a.pageSize).toEqual({ width: 612, height: 792 });
    await closePdf(pdf);
  });

  it('extracts page 1 in reading order: left column before right, de-hyphenated', async () => {
    const pdf = await openPdf(await makePaperPdf());
    const md = await extractPageMarkdown(pdf, 1);
    expect(md.startsWith(`# ${PAPER.title}`)).toBe(true);
    expect(md).toContain('preserve its information rather than flatten');
    const intro = md.indexOf('1 Introduction');
    const method = md.indexOf('2 Method');
    const local = md.indexOf('Local-first software');
    expect(intro).toBeGreaterThan(0);
    expect(local).toBeGreaterThan(intro);
    expect(method).toBeGreaterThan(local);
    await closePdf(pdf);
  });

  it('turns a lassoed region of the right column into Markdown (S2)', async () => {
    const pdf = await openPdf(await makePaperPdf());
    const page = await pdf.getPage(1);
    const items = await getPageTextItems(page);
    const sel = selectItemsInPolygon(items, [
      [310, 150],
      [600, 150],
      [600, 300],
      [310, 300],
    ]);
    const md = itemsToMarkdown(sel, { bodyFontSize: 10 });
    expect(md).toMatch(/^## 2 Method\n\nWe cluster text runs into columns/);
    expect(md).not.toContain('Introduction');
    await closePdf(pdf);
  });

  it('analyzes an 800-page book quickly, reading Info metadata and the outline (L1, L2)', async () => {
    const data = await makeBookPdf(800);
    const t0 = performance.now();
    const pdf = await openPdf(data);
    const a = await analyzePdf(pdf);
    expect(a.pageCount).toBe(800);
    expect(a.title).toBe('Foundations of Study Systems');
    expect(a.bib.authors).toEqual(['Edsger Dijkstra', 'Barbara Liskov']);
    expect(a.bib.entryType).toBe('book');
    expect(a.toc).toHaveLength(16);
    expect(a.toc[15]).toMatchObject({ title: 'Chapter 16', page: 751 });
    expect(performance.now() - t0).toBeLessThan(8000);
    const pages: number[] = [];
    for await (const p of iteratePageTexts(pdf, { from: 799, to: 800 })) {
      pages.push(p.page);
      expect(p.text).toContain(`page ${p.page} of the book`);
    }
    expect(pages).toEqual([799, 800]);
    await closePdf(pdf);
  });

  it('honours AbortSignal and does not detach the caller buffer', async () => {
    const data = await makePaperPdf();
    const ctl = new AbortController();
    ctl.abort();
    await expect(openPdf(data, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const pdf = await openPdf(data);
    expect(data.byteLength).toBeGreaterThan(0);
    await closePdf(pdf);
  });
});
