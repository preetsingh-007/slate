// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { SlateDB } from '../storage/idb';
import { AssetStore, FileTooLargeError } from '../storage/assets';
import { LibraryStore } from '../stores/library';
import { uid } from '../util/ids';
import { citationFor, citeName, editBook, importBookFile, normalizeEdition, readBookFile, restoreBookFile, sniffBookFormat, uniqueSlug } from './books';
import { configurePdfjs } from './pdf';
import { EPUB, makeBookPdf, makeEpub, makePaperPdf, PAPER } from '../../test/fixtures';

beforeAll(() => configurePdfjs({ assetBase: null }));

async function stores() {
  const db = await SlateDB.open(`books-${uid()}`);
  return { db, library: await LibraryStore.open(db), assets: new AssetStore(db) };
}

const blob = (b: Uint8Array, type = '') => new Blob([b as BlobPart], { type });

describe('citation in gym format (L1)', () => {
  it('formats author, title, edition and year', () => {
    expect(citeName('Sheldon Axler')).toBe('Axler, S.');
    expect(citeName('Lovelace, Ada')).toBe('Lovelace, A.');
    expect(citeName('Johannes van der Waals')).toBe('van der Waals, J.');
    expect(citeName('Jean-Pierre Serre')).toBe('Serre, J.-P.');
    expect(citeName('Plato')).toBe('Plato');
    expect(normalizeEdition('4')).toBe('4th edition');
    expect(normalizeEdition('2nd ed.')).toBe('2nd edition');
    expect(normalizeEdition('third')).toBe('3rd edition');
    expect(normalizeEdition('Revised')).toBe('Revised');
    expect(citationFor({ authors: ['Sheldon Axler'], title: 'Linear Algebra Done Right', edition: '4', year: 2024 })).toBe(
      'Axler, S., Linear Algebra Done Right, 4th edition, 2024',
    );
    expect(citationFor({ authors: ['A B', 'C D'], title: 'T' })).toBe('B, A. and D, C., T');
    expect(citationFor({ authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'], title: 'Attention Is All You Need', year: 2017 })).toBe(
      'Vaswani, A., et al., Attention Is All You Need, 2017',
    );
  });

  it('editing metadata recomputes the citation (L1: all fields editable)', () => {
    const b = editBook(
      { id: 'x', slug: 'x', format: 'pdf', title: 'Old', authors: [], citation: '', fileHash: 'h', fileName: 'x.pdf', size: 1, added: 0 },
      { title: 'Linear Algebra Done Right', authors: ['Sheldon Axler'], edition: '4th', year: 2024 },
    );
    expect(b.citation).toBe('Axler, S., Linear Algebra Done Right, 4th edition, 2024');
    expect(b.edition).toBe('4th');
  });

  it('makes unique slugs', () => {
    expect(uniqueSlug('Linear Algebra Done Right!', [])).toBe('linear-algebra-done-right');
    expect(uniqueSlug('A', ['a', 'a-2'])).toBe('a-3');
  });
});

describe('reading metadata from files (L1)', () => {
  it('sniffs formats', async () => {
    expect(await sniffBookFormat(blob(await makePaperPdf()), 'x.bin')).toBe('pdf');
    expect(await sniffBookFormat(blob(await makeEpub()), 'book.epub')).toBe('epub');
    expect(await sniffBookFormat(new Blob(['hello']), 'notes.txt')).toBeNull();
  });

  it('reads PDF title, authors, year, pages and TOC', async () => {
    const info = await readBookFile(blob(await makePaperPdf()), 'paper.pdf');
    expect(info).toMatchObject({ format: 'pdf', title: PAPER.title, authors: PAPER.authors, year: 2024, pages: 3 });
    expect(info.toc[0]).toEqual({ title: 'Introduction', page: 1 });
    expect(info.bib.doi).toBe(PAPER.doi);
  });

  it('reads EPUB title, authors, year and a TOC of chapter hrefs', async () => {
    const info = await readBookFile(blob(await makeEpub()), 'book.epub');
    expect(info).toMatchObject({ format: 'epub', title: EPUB.title, authors: EPUB.authors, year: 1843 });
    expect(info.toc[1]).toEqual({
      title: 'Chapter 2. Notes on Operations',
      href: 'OEBPS/text/ch2.xhtml',
      children: [{ title: '2.1 The Figure', href: 'OEBPS/text/ch2.xhtml#sec2-1' }],
    });
  });
});

describe('import and book files on each device (L1, L6)', () => {
  it('imports a PDF: file stored by hash, metadata with citation; re-import matches by hash', async () => {
    const s = await stores();
    const file = blob(await makeBookPdf(20, { title: 'Linear Algebra Done Right', author: 'Sheldon Axler' }), 'application/pdf');
    const r = await importBookFile(s, file, 'axler.pdf', 1000);
    expect(r.existing).toBe(false);
    expect(r.book).toMatchObject({ format: 'pdf', title: 'Linear Algebra Done Right', slug: 'linear-algebra-done-right', pages: 20, added: 1000 });
    expect(r.book.citation).toBe('Axler, S., Linear Algebra Done Right, 2024');
    expect(await s.assets.has(r.book.fileHash)).toBe(true);
    const again = await importBookFile(s, file, 'copy.pdf');
    expect(again).toEqual({ book: r.book, existing: true });
    expect(s.library.books()).toHaveLength(1);
  });

  it('a book synced from another device has no file here until the same file is imported', async () => {
    const s = await stores();
    const bytes = await makePaperPdf();
    const { book } = await importBookFile(s, blob(bytes), 'paper.pdf');
    // second device: metadata only
    const other = await stores();
    await other.library.putBook(book);
    expect(await other.assets.has(book.fileHash)).toBe(false);
    expect(await restoreBookFile(other, book, blob(await makeEpub()))).toBe(false);
    expect(await restoreBookFile(other, book, blob(bytes))).toBe(true);
    expect(await other.assets.has(book.fileHash)).toBe(true);
    // importing the file from the library view matches it too
    const third = await stores();
    await third.library.putBook(book);
    expect((await importBookFile(third, blob(bytes), 'renamed.pdf')).existing).toBe(true);
  });

  it('refuses files over 50 MB unless Git LFS mode is on (R7)', async () => {
    const s = await stores();
    const big = new Blob([new Uint8Array(51 * 1024 * 1024)]);
    const pdf = new Blob([(await makePaperPdf()) as BlobPart, big]);
    await expect(importBookFile(s, pdf, 'big.pdf')).rejects.toBeInstanceOf(FileTooLargeError);
    const lfs = { library: s.library, assets: new AssetStore(s.db, () => true) };
    await expect(importBookFile(lfs, pdf, 'big.pdf')).resolves.toMatchObject({ existing: false });
  });
});
