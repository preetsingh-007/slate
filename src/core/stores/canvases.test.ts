import { describe, expect, it } from 'vitest';
import { DocStore } from '../storage/docstore';
import { SlateDB } from '../storage/idb';
import { CanvasStore } from './canvases';
import { segmentDocId } from './docIds';

const OCT21 = new Date(2026, 9, 21, 9).getTime();

async function setup(name: string) {
  const db = await SlateDB.open(name);
  const docs = new DocStore(db);
  const store = await CanvasStore.open(db, docs, 'd1');
  return { db, docs, store };
}

describe('on-demand segments (R9)', () => {
  it('opens a month this device has at once; the download merges in later', async () => {
    const { docs, store } = await setup('canvases-r9-a');
    const local = store.model('main');
    await local.load(['2026-10']);
    local.transact((tx) => tx.add({ id: 't1', kind: 'text', x: 0, y: 0, w: 100, h: 20, rotation: 0, z: 'a', created: OCT21, edited: OCT21, device: 'd1', topics: [], content: 'here', fontSize: 16 }));
    await docs.flush();

    // a second app start on the same storage, with a download that never finishes
    const docs2 = new DocStore(docs.db);
    const store2 = await CanvasStore.open(docs.db, docs2, 'd1');
    const asked: string[] = [];
    store2.setRemoteFetcher((id) => {
      asked.push(id);
      return new Promise(() => undefined);
    });
    const m = store2.model('main');
    await m.load(['2026-10']); // does not wait for the download
    expect(m.get('t1')).toMatchObject({ content: 'here' });
    expect(asked).toEqual([segmentDocId('main', '2026-10')]);
  });

  it('waits for the download of a month with nothing local', async () => {
    const { store } = await setup('canvases-r9-b');
    let done = false;
    store.setRemoteFetcher(async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
    });
    await store.model('main').load(['2026-09']);
    expect(done).toBe(true);
  });

  it('asks for every month in the canvas index (S7 marks, canvas to-dos)', async () => {
    const { store } = await setup('canvases-r9-c');
    await store.update('main', { segments: { '2026-09': null, '2026-10': { x: 0, y: 0, w: 1, h: 1 } } });
    await store.create('Physics', 'physics');
    await store.update('physics', { segments: { '2026-10': null } });
    const asked: string[] = [];
    await store.fetchAllSegments(); // no fetcher: nothing to do
    store.setRemoteFetcher(async (id) => void asked.push(id));
    await store.fetchAllSegments();
    expect(asked.sort()).toEqual([segmentDocId('main', '2026-09'), segmentDocId('main', '2026-10'), segmentDocId('physics', '2026-10')]);
  });
});
