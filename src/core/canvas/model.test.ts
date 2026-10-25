import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { StrokeObject, TextObject } from '../model/types';
import { CanvasModel } from './model';
import { createObjectMap } from './segment';

function memorySource() {
  const docs = new Map<string, Y.Doc>();
  return {
    docs,
    open: async (month: string) => {
      let d = docs.get(month);
      if (!d) docs.set(month, (d = new Y.Doc()));
      return d;
    },
  };
}

const OCT = new Date(2026, 9, 21, 10).getTime();
const SEP = new Date(2026, 8, 30, 10).getTime();

function stroke(id: string, created: number, x = 0, y = 0): StrokeObject {
  return {
    id,
    kind: 'stroke',
    x,
    y,
    w: 10,
    h: 10,
    rotation: 0,
    z: 'i',
    created,
    edited: created,
    device: 'd1',
    topics: [],
    pts: [x, y, 0.5, x + 10, y + 10, 0.5],
    tool: 'pen',
    color: '#000000',
    size: 2,
  };
}

describe('CanvasModel', () => {
  it('routes objects to the segment of their creation month and presents one surface', async () => {
    const src = memorySource();
    const m = new CanvasModel('main', src, 'd1', () => OCT);
    await m.load(['2026-09', '2026-10']);
    m.transact((tx) => {
      tx.add(stroke('a', SEP, 0, 0));
      tx.add(stroke('b', OCT, 100, 100));
    });
    expect(src.docs.get('2026-09')!.getMap('objects').has('a')).toBe(true);
    expect(src.docs.get('2026-10')!.getMap('objects').has('b')).toBe(true);
    expect(m.query({ x: -5, y: -5, w: 200, h: 200 }).map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(m.query({ x: 50, y: 50, w: 10, h: 10 })).toEqual([]);
  });

  it('undoes a multi-segment action as one step (C17)', async () => {
    const m = new CanvasModel('main', memorySource(), 'd1', () => OCT);
    await m.load(['2026-09', '2026-10']);
    m.transact((tx) => {
      tx.add(stroke('a', SEP));
      tx.add(stroke('b', OCT));
    });
    m.transact((tx) => {
      tx.update('a', { x: 50 });
      tx.update('b', { x: 60 });
    });
    expect(m.get('a')!.x).toBe(50);
    expect(m.undo()).toBe(true);
    expect(m.get('a')!.x).toBe(0);
    expect(m.get('b')!.x).toBe(0);
    expect(m.undo()).toBe(true);
    expect(m.count).toBe(0);
    expect(m.redo()).toBe(true);
    expect(m.count).toBe(2);
  });

  it('records created and edited times (C18)', async () => {
    let t = OCT;
    const m = new CanvasModel('main', memorySource(), 'd1', () => t);
    await m.load(['2026-10']);
    m.transact((tx) => tx.add(stroke('a', OCT)));
    t = OCT + 5000;
    m.transact((tx) => tx.update('a', { color: '#ff0000' }));
    expect(m.get('a')!.created).toBe(OCT);
    expect(m.get('a')!.edited).toBe(OCT + 5000);
  });

  it('merges concurrent edits from two devices with nothing lost (R2)', async () => {
    const a = memorySource();
    const b = memorySource();
    const ma = new CanvasModel('main', a, 'da', () => OCT);
    const mb = new CanvasModel('main', b, 'db', () => OCT);
    await ma.load(['2026-10']);
    await mb.load(['2026-10']);
    const text: TextObject = {
      ...stroke('t', OCT),
      kind: 'text',
      content: 'hello',
      fontSize: 18,
    } as unknown as TextObject;
    ma.transact((tx) => tx.add(text));
    Y.applyUpdate(b.docs.get('2026-10')!, Y.encodeStateAsUpdate(a.docs.get('2026-10')!));
    // offline: both edit
    ma.transact((tx) => tx.add(stroke('s1', OCT)));
    mb.transact((tx) => tx.add(stroke('s2', OCT)));
    ma.textOf('t')!.insert(5, ' world');
    mb.textOf('t')!.insert(0, '> ');
    const da = a.docs.get('2026-10')!;
    const db = b.docs.get('2026-10')!;
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db));
    for (const m of [ma, mb]) {
      expect([...m.objects()].map((o) => o.id).sort()).toEqual(['s1', 's2', 't']);
      expect((m.get('t') as TextObject).content).toBe('> hello world');
    }
  });

  it('keeps the lower day line when two devices create one for the same date (C19)', async () => {
    const a = memorySource();
    const b = memorySource();
    const ma = new CanvasModel('main', a, 'da', () => OCT);
    const mb = new CanvasModel('main', b, 'db', () => OCT);
    await ma.load(['2026-10']);
    await mb.load(['2026-10']);
    ma.transact((tx) => tx.setDay('2026-10-21', 100));
    mb.transact((tx) => tx.setDay('2026-10-21', 300));
    Y.applyUpdate(b.docs.get('2026-10')!, Y.encodeStateAsUpdate(a.docs.get('2026-10')!));
    expect(mb.dayLines().get('2026-10-21')).toBe(300);
    await Promise.resolve();
    expect(b.docs.get('2026-10')!.getMap('days').size).toBe(1);
  });

  it("C19: deleting a day's last object removes its line in the same undo step", async () => {
    const m = new CanvasModel('main', memorySource(), 'd1', () => OCT);
    await m.load(['2026-10']);
    m.transact((tx) => {
      tx.add(stroke('a', OCT, 0, 100));
      tx.add(stroke('b', OCT, 0, 200));
      tx.setDay('2026-10-21', 76);
    });
    m.transact((tx) => tx.remove('a'));
    expect(m.dayLines().get('2026-10-21')).toBe(76);
    // erasing part of a stroke replaces it with pieces of the same day: the line stays
    m.transact((tx) => {
      tx.remove('b');
      tx.add({ ...stroke('b2', OCT, 0, 200) });
    });
    expect(m.dayLines().get('2026-10-21')).toBe(76);
    m.transact((tx) => tx.remove('b2'));
    expect(m.dayLines().has('2026-10-21')).toBe(false);
    m.undo();
    expect(m.has('b2')).toBe(true);
    expect(m.dayLines().get('2026-10-21')).toBe(76);
    m.redo();
    expect(m.dayLines().has('2026-10-21')).toBe(false);
  });

  it("C19: deleting another day's objects leaves today's line alone", async () => {
    const m = new CanvasModel('main', memorySource(), 'd1', () => OCT);
    await m.load(['2026-10']);
    const OCT20 = OCT - 86_400_000;
    m.transact((tx) => {
      tx.add(stroke('old', OCT20, 0, 0));
      tx.setDay('2026-10-20', -24);
    });
    m.transact((tx) => {
      tx.add(stroke('new', OCT, 0, 100));
      tx.setDay('2026-10-21', 76);
    });
    m.transact((tx) => tx.remove('old'));
    expect([...m.dayLines().keys()]).toEqual(['2026-10-21']);
  });

  it('C19: lines of days with no objects left are cleared when the month opens', async () => {
    const src = memorySource();
    const doc = await src.open('2026-10');
    // within 12 hours of the 22nd, but the 23rd has its own line: it counts for the 23rd only
    const OCT23 = new Date(2026, 9, 23, 11, 21).getTime();
    doc.transact(() => {
      doc.getMap('days').set('2026-10-22@d2', 65.2);
      doc.getMap('days').set('2026-10-23@d3', 59.7);
      // made late on the 20th on a device in another time zone: the 21st's line stays
      doc.getMap('days').set('2026-10-21@d4', 0);
      doc.getMap('objects').set('t', createObjectMap({ ...stroke('t', OCT23, 0, 75) }));
      doc.getMap('objects').set('z', createObjectMap({ ...stroke('z', new Date(2026, 9, 20, 22).getTime(), 0, -100) }));
    });
    const m = new CanvasModel('main', src, 'd1', () => OCT23);
    await m.load(['2026-10']);
    expect([...m.dayLines().keys()].sort()).toEqual(['2026-10-21', '2026-10-23']);
    // the clean-up is not an undo step
    expect(m.canUndo()).toBe(false);
  });

  it('typing in a text box is undoable on its own', async () => {
    const m = new CanvasModel('main', memorySource(), 'd1', () => OCT);
    await m.load(['2026-10']);
    m.transact((tx) => tx.add({ ...stroke('t', OCT), kind: 'text', content: 'a', fontSize: 18 } as unknown as TextObject));
    const t = m.textOf('t')!;
    t.doc!.transact(() => t.insert(1, 'bc'), 'local');
    expect((m.get('t') as TextObject).content).toBe('abc');
    m.undo();
    expect((m.get('t') as TextObject).content).toBe('a');
  });
});

describe('CanvasModel across a month boundary (W1)', () => {
  const OCT31 = new Date(2026, 9, 31, 23, 59).getTime();
  const NOV1 = new Date(2026, 10, 1, 0, 1).getTime();

  /** a source whose months open only when the test lets them */
  function gatedSource() {
    const inner = memorySource();
    const gates = new Map<string, () => void>();
    return {
      docs: inner.docs,
      opened: [] as string[],
      release: (month: string) => gates.get(month)?.(),
      open(month: string) {
        this.opened.push(month);
        if (month !== '2026-11') return inner.open(month);
        return new Promise<Y.Doc>((resolve) => gates.set(month, () => void inner.open(month).then(resolve)));
      },
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('W1: a stroke and day line made after midnight wait for the new month instead of being dropped, as one undo step', async () => {
    let now = OCT31;
    const src = gatedSource();
    const m = new CanvasModel('main', src, 'd1', () => now);
    await m.load(['2026-10']);
    m.transact((tx) => tx.add(stroke('a', now)));
    now = NOV1;
    expect(() =>
      m.transact((tx) => {
        tx.add(stroke('b', now, 0, 100));
        tx.setDay('2026-11-01', 76);
      }),
    ).not.toThrow();
    // shown at once, and the month is being loaded
    expect(m.get('b')).toBeDefined();
    expect(m.dayLines().get('2026-11-01')).toBe(76);
    expect(m.query({ x: -5, y: 95, w: 50, h: 50 }).map((o) => o.id)).toEqual(['b']);
    expect(src.opened).toContain('2026-11');
    // more work before the month opens: an edit of the waiting stroke and a second stroke
    m.transact((tx) => tx.update('b', { color: '#ff0000' }));
    m.transact((tx) => tx.add(stroke('c', now, 0, 200)));
    expect((m.get('b') as StrokeObject).color).toBe('#ff0000');
    src.release('2026-11');
    await flush();
    const nov = src.docs.get('2026-11')!;
    expect([...nov.getMap('objects').keys()].sort()).toEqual(['b', 'c']);
    expect(m.monthOf('b')).toBe('2026-11');
    expect((m.get('b') as StrokeObject).color).toBe('#ff0000');
    expect(m.dayLines().get('2026-11-01')).toBe(76);
    // one undo step per action, as if the month had been loaded
    m.undo();
    expect(m.has('c')).toBe(false);
    m.undo();
    expect((m.get('b') as StrokeObject).color).toBe('#000000');
    m.undo();
    expect(m.has('b')).toBe(false);
    expect(m.dayLines().has('2026-11-01')).toBe(false);
    expect(m.has('a')).toBe(true);
    m.redo();
    expect(m.has('b')).toBe(true);
    expect(m.dayLines().get('2026-11-01')).toBe(76);
  });

  it('W1: undoing an action that is still waiting withdraws it; redo queues it again', async () => {
    let now = OCT31;
    const src = gatedSource();
    const m = new CanvasModel('main', src, 'd1', () => now);
    await m.load(['2026-10']);
    now = NOV1;
    m.transact((tx) => {
      tx.add(stroke('b', now));
      tx.add(stroke('old', OCT31, 0, 50));
    });
    expect(m.undo()).toBe(true);
    expect(m.has('b')).toBe(false);
    expect(m.has('old')).toBe(false);
    expect(m.redo()).toBe(true);
    expect(m.has('b')).toBe(true);
    expect(m.has('old')).toBe(true);
    m.transact((tx) => tx.add(stroke('c', now)));
    m.undo();
    src.release('2026-11');
    await flush();
    expect([...src.docs.get('2026-11')!.getMap('objects').keys()]).toEqual(['b']);
    expect(m.has('c')).toBe(false);
    m.redo();
    expect([...src.docs.get('2026-11')!.getMap('objects').keys()].sort()).toEqual(['b', 'c']);
    m.undo();
    m.undo();
    expect(m.count).toBe(0);
  });
});
