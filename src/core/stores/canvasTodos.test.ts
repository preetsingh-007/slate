import { describe, expect, it } from 'vitest';
import type { TextObject } from '../model/types';
import { DocStore } from '../storage/docstore';
import { SlateDB } from '../storage/idb';
import { CanvasStore } from './canvases';
import { CanvasTodoIndex, groupByDay, setCanvasTodo } from './canvasTodos';

const OCT20 = new Date(2026, 9, 20, 9).getTime();
const OCT21 = new Date(2026, 9, 21, 9).getTime();
const SEP30 = new Date(2026, 8, 30, 9).getTime();

function text(id: string, content: string, created: number, y = 0): TextObject {
  return { id, kind: 'text', x: 0, y, w: 300, h: 40, rotation: 0, z: 'i', created, edited: created, device: 'd1', topics: [], content, fontSize: 16 };
}

async function setup(name: string) {
  const db = await SlateDB.open(name);
  const docs = new DocStore(db);
  const store = await CanvasStore.open(db, docs, 'd1');
  return { db, docs, store };
}

describe('canvas to-dos (G4)', () => {
  it('collects unchecked tasks across canvases and stored segments, grouped by day, newest first', async () => {
    const { db, docs, store } = await setup('todos-a');
    const main = store.model('main');
    await main.load(['2026-09', '2026-10']);
    main.transact((tx) => {
      tx.add(text('t1', '- [ ] prove 5.3\n- [x] done already\nplain', OCT20, 100));
      tx.add(text('t2', 'Lecture\n- [ ] ask about Jordan form', OCT21, 50));
      tx.add(text('t3', '```\n- [ ] in code\n```\n- [ ] old one', SEP30));
    });
    await store.create('Physics', 'physics');
    const phys = store.model('physics');
    await phys.load(['2026-10']);
    phys.transact((tx) => tx.add(text('p1', '- [ ] lab report', OCT21, 10)));
    await docs.flush();

    // a second app instance reads the stored segments without loading any canvas
    const docs2 = new DocStore(db);
    const store2 = await CanvasStore.open(db, docs2, 'd2');
    const idx = new CanvasTodoIndex(store2, docs2, 0);
    await idx.refresh();
    const days = idx.days();
    expect(days.map((d) => d.date)).toEqual(['2026-10-21', '2026-10-20', '2026-09-30']);
    expect(days[0].todos.map((t) => [t.canvas, t.text])).toEqual([
      ['main', 'ask about Jordan form'],
      ['physics', 'lab report'],
    ]);
    expect(days[1].todos.map((t) => t.text)).toEqual(['prove 5.3']);
    expect(days[2].todos.map((t) => [t.text, t.task])).toEqual([['old one', 0]]);
    idx.dispose();
  });

  it('checking one here checks it in the text box on the canvas, and the list follows', async () => {
    const { docs, store } = await setup('todos-b');
    const main = store.model('main');
    await main.load(['2026-10']);
    main.transact((tx) => tx.add(text('t1', 'Notes\n- [ ] first\n- [ ] second', OCT21)));
    const idx = new CanvasTodoIndex(store, docs, 0);
    await idx.refresh();
    const second = idx.all().find((t) => t.text === 'second')!;
    let changed = 0;
    idx.onChange.on(() => changed++);
    expect(await setCanvasTodo(store, second, true)).toBe(true);
    expect((main.get('t1') as TextObject).content).toBe('Notes\n- [ ] first\n- [x] second');
    expect(main.canUndo()).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    await idx.refresh();
    expect(changed).toBeGreaterThan(0);
    expect(idx.all().map((t) => t.text)).toEqual(['first']);
    idx.dispose();
  });

  it('finds a moved task by its text and reports a removed text box', async () => {
    const { store } = await setup('todos-c');
    const main = store.model('main');
    await main.load(['2026-10']);
    main.transact((tx) => tx.add(text('t1', '- [ ] a\n- [ ] b', OCT21)));
    const b = { canvas: 'main', month: '2026-10', object: 't1', task: 1, text: 'b', created: OCT21, date: '2026-10-21', x: 0, y: 0 };
    main.transact((tx) => tx.update('t1', { content: '- [ ] new\n- [ ] a\n- [ ] b' }));
    await setCanvasTodo(store, b, true);
    expect((main.get('t1') as TextObject).content).toBe('- [ ] new\n- [ ] a\n- [x] b');
    main.transact((tx) => tx.remove('t1'));
    expect(await setCanvasTodo(store, b, true)).toBe(false);
    expect(groupByDay([])).toEqual([]);
  });
});
