import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_VERSION, draftKey, draftThrottle, listDrafts, parseDraft, readDraft, readDraftRaw, removeDraft, settleDraft, writeDraft, type StrokeDraft } from './drafts';

const stroke = (id = 's1'): Omit<StrokeDraft, 'v'> => ({ kind: 'stroke', canvas: 'main', id, created: 1, tool: 'pen', color: '#000000', size: 2, pts: [0, 0, 0.5, 10, 10, 0.5] });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('drafts (durability NFR)', () => {
  it('writes, reads and removes drafts synchronously under namespaced keys', () => {
    const key = draftKey('stroke', 's1');
    expect(key).toBe('slate-draft:stroke:s1');
    const raw = writeDraft(key, stroke());
    expect(raw).toBe(localStorage.getItem(key));
    expect(readDraft(key)).toEqual({ ...stroke(), v: DRAFT_VERSION });
    removeDraft(key);
    expect(readDraft(key)).toBeNull();
  });

  it('removes a draft only while it holds what was committed (durability NFR)', () => {
    const key = draftKey('todo', 'a');
    const first = writeDraft(key, { kind: 'todo', text: 'Buy', committed: false, created: 1 })!;
    writeDraft(key, { kind: 'todo', text: 'Buy chalk', committed: false, created: 1 });
    removeDraft(key, first);
    expect(readDraft(key)).toMatchObject({ text: 'Buy chalk' });
  });

  it('lists every draft and keeps the ones it cannot read: other versions, bad JSON, missing fields (durability NFR)', () => {
    writeDraft(draftKey('stroke', 's1'), stroke());
    localStorage.setItem(draftKey('stroke', 's2'), JSON.stringify({ ...stroke('s2'), v: 2 }));
    localStorage.setItem(draftKey('note', 'n1'), '{not json');
    localStorage.setItem(draftKey('ink', 'i1'), JSON.stringify({ v: 1, kind: 'ink', item: 'b' }));
    localStorage.setItem('slate-layout', '{}');
    const list = listDrafts();
    expect(list.map((d) => d.key)).toEqual(['slate-draft:ink:i1', 'slate-draft:note:n1', 'slate-draft:stroke:s1', 'slate-draft:stroke:s2']);
    expect(list.map((d) => !!d.draft)).toEqual([false, false, true, false]);
    expect(localStorage.length).toBe(5);
  });

  it('parses each kind and rejects mismatched ones (durability NFR)', () => {
    const a = { id: 'n1', kind: 'note', locator: { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 0, h: 0 }, quote: '' }, color: '#f5d742', created: 1, text: 'x' };
    expect(parseDraft(JSON.stringify({ v: 1, kind: 'note', item: 'b', annotation: a }))).not.toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, kind: 'ink', item: 'b', annotation: a }))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, kind: 'todo', text: 'x' }))).toMatchObject({ committed: false });
    expect(parseDraft(JSON.stringify({ v: 1, ...stroke(), tool: 'brush' }))).toBeNull();
    expect(parseDraft('null')).toBeNull();
  });

  it('never throws when storage refuses (durability NFR)', () => {
    const refuse = () => {
      throw new Error('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse, key: refuse, get length() {
      return refuse();
    } });
    try {
      expect(writeDraft(draftKey('stroke', 's1'), stroke())).toBeNull();
      expect(readDraft(draftKey('stroke', 's1'))).toBeNull();
      expect(listDrafts()).toEqual([]);
      removeDraft(draftKey('stroke', 's1'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throttles writes while work is large and writes every time while it is small (durability NFR)', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    let big = false;
    const t = draftThrottle(write, { ms: 150, eager: () => !big });
    t.schedule();
    t.schedule();
    expect(write).toHaveBeenCalledTimes(2);
    big = true;
    t.schedule();
    t.schedule();
    expect(write).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(150);
    expect(write).toHaveBeenCalledTimes(3);
    t.schedule();
    t.flush();
    expect(write).toHaveBeenCalledTimes(4);
    t.schedule();
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledTimes(4);
  });

  it('settles a draft once its document is saved, unless a newer draft was written (durability NFR)', async () => {
    let save!: () => void;
    const docs = { whenSaved: () => new Promise<void>((r) => (save = r)) };
    const key = draftKey('note', 'n1');
    writeDraft(key, { kind: 'todo', text: 'a', committed: true, created: 1 });
    settleDraft(docs, key, 'todo');
    expect(readDraftRaw(key)).not.toBeNull();
    save();
    await vi.waitFor(() => expect(readDraftRaw(key)).toBeNull());

    writeDraft(key, { kind: 'todo', text: 'a', committed: true, created: 1 });
    settleDraft(docs, key, 'todo');
    writeDraft(key, { kind: 'todo', text: 'ab', committed: false, created: 1 });
    save();
    await new Promise((r) => setTimeout(r, 10));
    expect(readDraft(key)).toMatchObject({ text: 'ab' });
  });

  it('waits for the commit to reach its document before settling (durability NFR)', async () => {
    const docs = { whenSaved: vi.fn(() => Promise.resolve()) };
    const key = draftKey('stroke', 's1');
    writeDraft(key, stroke());
    let ready = false;
    settleDraft(docs, key, 'seg:main:2026-10', () => ready);
    await new Promise((r) => setTimeout(r, 250));
    expect(docs.whenSaved).not.toHaveBeenCalled();
    ready = true;
    await vi.waitFor(() => expect(readDraftRaw(key)).toBeNull());
    expect(docs.whenSaved).toHaveBeenCalledWith('seg:main:2026-10');
  });
});
