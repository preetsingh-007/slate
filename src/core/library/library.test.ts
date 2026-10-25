// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import type { ClipObject, SourceLink } from '../model/types';
import { DocStore } from '../storage/docstore';
import { SlateDB } from '../storage/idb';
import { CanvasStore } from '../stores/canvases';
import { annotationsDocId, segmentDocId } from '../stores/docIds';
import { LibraryStore } from '../stores/library';
import { SettingsStore, mergeSettings } from '../stores/settings';
import { createObjectMap, objectsMap } from '../canvas/segment';
import { uid } from '../util/ids';
import { findQuote, makeQuote } from '../locators/textQuote';
import { HIGHLIGHT_COLORS, annotationsMap, inkBounds, listAnnotations, newAnnotation, putAnnotation, removeAnnotation } from './annotations';
import { flattenAnnotations } from './flatten';
import { pdfClipMarks } from './marks';
import { configurePdfjs, getPageTextItems, openPdf, closePdf } from './pdf';
import { itemsToText } from './extract';
import { epubPosition, pdfPosition, readingPosition, saveReadingPosition } from './positions';
import { clipsPointingTo, deleteLibraryItem } from './remove';
import { LibraryTextIndex } from './textIndex';
import { makePaperPdf } from '../../test/fixtures';

beforeAll(() => configurePdfjs({ assetBase: null }));

async function services() {
  const db = await SlateDB.open(`lib-${uid()}`);
  const docs = new DocStore(db);
  return { db, docs, library: await LibraryStore.open(db), settings: await SettingsStore.open(db), canvases: await CanvasStore.open(db, docs, 'dev1') };
}

const link = (id: string, locator: SourceLink['locator']): SourceLink => ({ type: 'book', id, title: 'Paper', locator, capturedAt: 1, contentHash: 'h' });

function clip(id: string, source: SourceLink, text = 'The rank of a matrix'): ClipObject {
  return { id, kind: 'clip', x: 0, y: 0, w: 100, h: 50, rotation: 0, z: 'a', created: Date.UTC(2026, 9, 21), edited: 0, device: 'd', topics: [], text, display: 'both', source, asset: 'img' };
}

describe('annotations stored apart from the file (L4, L5, R2)', () => {
  it('adds, lists and removes annotations in ann:<id>; concurrent edits merge', async () => {
    const s = await services();
    const doc = await s.docs.open(annotationsDocId('book1'));
    const hl = newAnnotation('highlight', { type: 'pdf', page: 1, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }, quote: 'rank' }, { color: HIGHLIGHT_COLORS[2].value, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] }, 1);
    putAnnotation(doc, hl);
    const note = newAnnotation('note', { type: 'epub', chapter: 'OEBPS/ch1.xhtml', quote: { exact: 'engine', prefix: 'The ', suffix: ' weaves' }, position: 0.1 }, { text: 'Check this' }, 2);
    putAnnotation(doc, note);
    expect(listAnnotations(doc).map((a) => a.kind)).toEqual(['highlight', 'note']);
    // another device adds ink at the same time
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    annotationsMap(other).set('ink1', newAnnotation('ink', { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 0, h: 0 }, quote: '' }, { strokes: [{ pts: [0.1, 0.1, 0.5], color: '#000', size: 0.004, tool: 'pen' }] }, 3));
    removeAnnotation(doc, hl.id);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(listAnnotations(doc).map((a) => a.kind)).toEqual(['note', 'ink']);
    expect(HIGHLIGHT_COLORS).toHaveLength(5);
    expect(inkBounds([0.1, 0.2, 0.5, 0.3, 0.4, 0.5], 0.02)).toEqual({ x: expect.closeTo(0.09, 5), y: expect.closeTo(0.19, 5), w: expect.closeTo(0.22, 5), h: expect.closeTo(0.22, 5) });
  });

  it('exports a copy with highlights, ink and notes flattened in; the original is untouched (L4)', async () => {
    const original = await makePaperPdf();
    const copy = original.slice();
    const anns = [
      newAnnotation('highlight', { type: 'pdf', page: 1, region: { x: 0.1, y: 0.2, w: 0.4, h: 0.02 }, quote: '' }, { rects: [{ x: 0.1, y: 0.2, w: 0.4, h: 0.02 }] }),
      newAnnotation('ink', { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 0, h: 0 }, quote: '' }, { strokes: [{ pts: [0.1, 0.5, 0.5, 0.3, 0.55, 0.6, 0.5, 0.6, 0.5], color: '#c93a32', size: 0.005, tool: 'pen' }] }),
      newAnnotation('note', { type: 'pdf', page: 2, region: { x: 0.8, y: 0.3, w: 0, h: 0 }, quote: '' }, { text: 'Margin note: compare with Axler 5A' }),
    ];
    const out = await flattenAnnotations(original, anns);
    expect(original).toEqual(copy);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    const pdf = await openPdf(out);
    const text = itemsToText(await getPageTextItems(await pdf.getPage(2)));
    expect(text).toContain('Margin note: compare with Axler 5A');
    await closePdf(pdf);
  });
});

describe('reading positions synced through settings (L2, L3)', () => {
  it('saves per item and merges by newest', async () => {
    const s = await services();
    await saveReadingPosition(s.settings, 'b1', pdfPosition(42, 0.25), 'dev1', 1000);
    await saveReadingPosition(s.settings, 'e1', epubPosition('OEBPS/ch2.xhtml', 0.5), 'dev1', 1000);
    expect(readingPosition(s.settings, 'b1')).toMatchObject({ locator: { type: 'pdf', page: 42, region: { y: 0.25 } }, device: 'dev1' });
    const remote = { ...s.settings.get(), readingPositions: { b1: { sourceId: 'b1', locator: pdfPosition(50, 0), updated: 2000, device: 'dev2' } }, updated: 1 };
    const merged = mergeSettings(s.settings.get(), remote);
    expect(merged.readingPositions.b1.locator).toMatchObject({ page: 50 });
    expect(merged.readingPositions.e1).toBeDefined();
  });
});

describe('local full-text search (L12)', () => {
  it('finds items by title words or text, with PDF pages and snippets', async () => {
    const s = await services();
    const idx = new LibraryTextIndex(s.db);
    await idx.put({ id: 'b', pages: ['Intro page', 'The Fiedler vector splits a graph.'], source: 'h1' });
    await idx.put({ id: 'c', text: 'Spaced repetition beats cramming.', source: 'h2' });
    const items = [
      { id: 'b', title: 'Spectral Graph Theory', extra: 'Chung' },
      { id: 'c', title: 'Why spaced repetition works' },
      { id: 'd', title: 'Unindexed' },
    ];
    expect(await idx.search('spectral chung', items)).toEqual([{ id: 'b', inTitle: true }]);
    const hits = await idx.search('FIEDLER vector', items);
    expect(hits).toEqual([{ id: 'b', inTitle: false, page: 2, snippet: 'The Fiedler vector splits a graph.' }]);
    expect((await idx.search('cramming', items))[0].id).toBe('c');
    expect(await idx.search('nothing-matches', items)).toEqual([]);
    expect(await idx.has('b', 'h1')).toBe(true);
    expect(await idx.has('b', 'other')).toBe(false);
  });

  it('L12: a search made before a book is indexed finds it once the indexer has added it', async () => {
    const s = await services();
    const pane = LibraryTextIndex.for(s.db);
    const items = [{ id: 'b', title: 'Animals of Australia' }];
    expect(await pane.search('quokka', items)).toEqual([]);
    await LibraryTextIndex.for(s.db).put({ id: 'b', pages: ['The quokka smiles.'], source: 'h1' });
    expect((await pane.search('quokka', items)).map((h) => h.id)).toEqual(['b']);
  });
});

describe('delete warnings (L13) and clip marks (S7)', () => {
  it('lists the clips pointing to an item; deleting keeps the clips', async () => {
    const s = await services();
    await s.library.putBook({ id: 'bk', slug: 'paper', format: 'pdf', title: 'Paper', authors: [], citation: '', fileHash: 'h', fileName: 'p.pdf', size: 1, added: 0 });
    const seg = await s.docs.open(segmentDocId('main', '2026-10'));
    objectsMap(seg).set('c1', createObjectMap(clip('c1', link('bk', { type: 'pdf', page: 3, region: { x: 0.1, y: 0.5, w: 0.5, h: 0.1 }, quote: 'x' }))));
    objectsMap(seg).set('c2', createObjectMap(clip('c2', link('bk', { type: 'pdf', page: 3, region: { x: 0.1, y: 0.55, w: 0.5, h: 0.1 }, quote: 'x' }), '')));
    objectsMap(seg).set('c3', createObjectMap(clip('c3', link('other', { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }))));
    const list = await clipsPointingTo(s.canvases, 'bk');
    expect(list.map((c) => c.label)).toEqual(['The rank of a matrix', 'Image']);
    expect(list[0]).toMatchObject({ canvas: 'main', month: '2026-10' });
    await saveReadingPosition(s.settings, 'bk', pdfPosition(3, 0), 'dev1');
    await deleteLibraryItem(s, 'book', 'bk');
    expect(s.library.book('bk')).toBeUndefined();
    expect(s.library.tombstones()).toMatchObject([{ kind: 'book', id: 'bk', slug: 'paper' }]);
    expect(readingPosition(s.settings, 'bk')).toBeUndefined();
    expect((await s.canvases.findClipsOf('bk')).map((r) => r.clip.id).sort()).toEqual(['c1', 'c2']);
    const marks = pdfClipMarks(await s.canvases.findClipsOf('bk'));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ page: 3, y: 0.5 });
    expect(marks[0].h).toBeCloseTo(0.15);
  });

  it('re-anchors quotes exactly and fuzzily after the text changed (S5, S6)', () => {
    const text = 'Chapter one. The engine weaves algebraical patterns just as the loom weaves flowers.';
    const start = text.indexOf('algebraical');
    const q = makeQuote(text, start, start + 'algebraical patterns'.length);
    expect(findQuote(text, q)).toMatchObject({ start, exact: true });
    const changed = text.replace('algebraical patterns', 'algebraic patterns');
    const m = findQuote(changed, q, start)!;
    expect(m.exact).toBe(false);
    expect(changed.slice(m.start, m.end)).toContain('algebraic pattern');
  });
});
