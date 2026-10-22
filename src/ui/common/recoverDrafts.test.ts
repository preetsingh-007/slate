import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, type Services } from '../../app/services';
import { makeStroke } from '../../core/canvas/objects';
import { annotationsMap, newAnnotation, putAnnotation } from '../../core/library/annotations';
import type { Annotation, StrokeObject } from '../../core/model/types';
import { addItem } from '../../core/stores/checklist';
import { TODO_DOC_ID, annotationsDocId } from '../../core/stores/docIds';
import { checklistText } from '../../core/stores/todo';
import { draftKey, listDrafts, writeDraft } from './drafts';
import { recoverDrafts } from './recoverDrafts';

const NOW = new Date(2026, 9, 21, 10).getTime();
const AUGUST = new Date(2026, 7, 30, 22).getTime();

beforeEach(() => localStorage.clear());

async function services(): Promise<Services> {
  const s = await createServices(`recover-test-${Math.random()}`);
  await s.library.putBook({ id: 'bk', slug: 'paper', format: 'pdf', title: 'Paper', authors: [], citation: '', fileHash: 'h', fileName: 'p.pdf', size: 1, added: 0 });
  return s;
}

const strokeDraft = (id: string, created = NOW) => ({ kind: 'stroke' as const, canvas: 'main', id, created, tool: 'pen' as const, color: '#000000', size: 2, pts: [0, 100, 0.5, 20, 104, 0.5, 40, 100, 0.5] });

/** The drafts left once every recovered write is on disk. */
async function settled(s: Services) {
  await s.docs.flush();
  await new Promise((r) => setTimeout(r, 0));
  return listDrafts().map((d) => d.key);
}

const pdfNote = (text: string): Annotation => newAnnotation('note', { type: 'pdf', page: 1, region: { x: 0.5, y: 0.5, w: 0, h: 0 }, quote: '' }, { text }, NOW);

describe('recoverDrafts (durability NFR)', () => {
  it('turns a stroke draft into a committed stroke in its month, on top, with its id and time (durability NFR)', async () => {
    const s = await services();
    const model = s.canvases.model('main');
    await model.load(['2026-08', '2026-10']);
    const below = makeStroke({ id: 'old', now: NOW, device: 'd', z: model.topZ() }, { pts: [0, 0, 0.5, 5, 5, 0.5], tool: 'pen', color: '#000000', size: 2 });
    model.transact((tx) => tx.add(below));
    writeDraft(draftKey('stroke', 's1'), strokeDraft('s1', AUGUST));
    expect(await recoverDrafts(s, () => NOW)).toBe(1);
    const st = model.get('s1') as StrokeObject;
    expect(st).toMatchObject({ kind: 'stroke', created: AUGUST, tool: 'pen', pts: strokeDraft('s1').pts });
    expect(model.monthOf('s1')).toBe('2026-08');
    expect(st.z > below.z).toBe(true);
    expect(await settled(s)).toEqual([]);
    // on disk: a fresh store sees it
    const rows = await s.db.getUpdates('seg:main:2026-08');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not add a stroke twice when its write reached the disk after all (durability NFR)', async () => {
    const s = await services();
    writeDraft(draftKey('stroke', 's1'), strokeDraft('s1'));
    expect(await recoverDrafts(s, () => NOW)).toBe(1);
    writeDraft(draftKey('stroke', 's1'), strokeDraft('s1'));
    expect(await recoverDrafts(s, () => NOW)).toBe(0);
    expect([...s.canvases.model('main').objects()].filter((o) => o.kind === 'stroke')).toHaveLength(1);
  });

  it('keeps a stroke draft for a canvas this device does not know (durability NFR)', async () => {
    const s = await services();
    writeDraft(draftKey('stroke', 's1'), { ...strokeDraft('s1'), canvas: 'elsewhere' });
    expect(await recoverDrafts(s, () => NOW)).toBe(0);
    expect(await settled(s)).toEqual(['slate-draft:stroke:s1']);
  });

  it('turns PDF ink into an ink annotation once (durability NFR)', async () => {
    const s = await services();
    const ink = newAnnotation('ink', { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 0.1, h: 0.1 }, quote: '' }, { color: '#000000', strokes: [{ pts: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5], color: '#000000', size: 0.004, tool: 'pen' }] });
    writeDraft(draftKey('ink', ink.id), { kind: 'ink', item: 'bk', annotation: ink });
    expect(await recoverDrafts(s)).toBe(1);
    writeDraft(draftKey('ink', ink.id), { kind: 'ink', item: 'bk', annotation: ink });
    expect(await recoverDrafts(s)).toBe(0);
    const doc = await s.docs.open(annotationsDocId('bk'));
    expect([...annotationsMap(doc).values()]).toEqual([ink]);
    expect(await settled(s)).toEqual([]);
  });

  it('creates a margin note, or updates its text keeping its id (durability NFR)', async () => {
    const s = await services();
    const doc = await s.docs.open(annotationsDocId('bk'));
    const fresh = pdfNote('Check the gutter rule');
    writeDraft(draftKey('note', fresh.id), { kind: 'note', item: 'bk', annotation: fresh });
    const old = pdfNote('Che');
    putAnnotation(doc, { ...old, color: '#5cc27e' });
    writeDraft(draftKey('note', old.id), { kind: 'note', item: 'bk', annotation: { ...old, text: 'Check twice' } });
    expect(await recoverDrafts(s)).toBe(2);
    expect(annotationsMap(doc).get(fresh.id)?.text).toBe('Check the gutter rule');
    // the stored note is kept (its colour), only the text comes from the draft
    expect(annotationsMap(doc).get(old.id)).toMatchObject({ text: 'Check twice', color: '#5cc27e' });
    expect(annotationsMap(doc).size).toBe(2);
    expect(await settled(s)).toEqual([]);
  });

  it('drops annotation drafts of a deleted book and keeps those of one not here yet (durability NFR)', async () => {
    const s = await services();
    await s.library.deleteBook('bk');
    writeDraft(draftKey('note', 'n1'), { kind: 'note', item: 'bk', annotation: { ...pdfNote('x'), id: 'n1' } });
    writeDraft(draftKey('note', 'n2'), { kind: 'note', item: 'later', annotation: { ...pdfNote('y'), id: 'n2' } });
    expect(await recoverDrafts(s)).toBe(0);
    expect(await settled(s)).toEqual(['slate-draft:note:n2']);
  });

  it('adds a to-do being typed, and a committed one only when it is missing (durability NFR)', async () => {
    const s = await services();
    const t = checklistText(await s.docs.open(TODO_DOC_ID));
    addItem(t, 'Buy chalk');
    writeDraft(draftKey('todo', 'a'), { kind: 'todo', text: 'Buy chalk', committed: true, created: NOW });
    writeDraft(draftKey('todo', 'b'), { kind: 'todo', text: 'Grade ', committed: false, created: NOW });
    writeDraft(draftKey('todo', 'c'), { kind: 'todo', text: 'Email', committed: true, created: NOW });
    writeDraft(draftKey('todo', 'd'), { kind: 'todo', text: '  ', committed: false, created: NOW });
    expect(await recoverDrafts(s)).toBe(2);
    expect(t.toString()).toBe('- [ ] Buy chalk\n- [ ] Grade\n- [ ] Email\n');
    expect(await settled(s)).toEqual([]);
  });

  it('marks a to-do committed before adding it, so a crash during recovery cannot add it twice (durability NFR)', async () => {
    const s = await services();
    // the write of the recovered item never finishes (the tab dies again)
    s.db.putUpdate = () => new Promise<void>(() => {});
    writeDraft(draftKey('todo', 'b'), { kind: 'todo', text: 'Grade', committed: false, created: NOW });
    await recoverDrafts(s);
    expect(listDrafts()[0].draft).toMatchObject({ committed: true });
  });

  it('leaves drafts it cannot read, and survives a failing one (durability NFR)', async () => {
    const s = await services();
    localStorage.setItem(draftKey('stroke', 'x'), JSON.stringify({ ...strokeDraft('x'), v: 99 }));
    localStorage.setItem(draftKey('note', 'y'), '{');
    writeDraft(draftKey('todo', 'z'), { kind: 'todo', text: 'Read', committed: false, created: NOW });
    vi.spyOn(s.docs, 'open').mockRejectedValueOnce(new Error('blocked'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await recoverDrafts(s)).toBe(0);
    warn.mockRestore();
    expect(await settled(s)).toEqual(['slate-draft:note:y', 'slate-draft:stroke:x', 'slate-draft:todo:z']);
    // next start
    expect(await recoverDrafts(s)).toBe(1);
    expect(await settled(s)).toEqual(['slate-draft:note:y', 'slate-draft:stroke:x']);
  });
});
