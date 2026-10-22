import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from './docstore';
import { SlateDB } from './idb';

async function open() {
  const db = await SlateDB.open(`docstore-test-${Math.random()}`);
  return { db, docs: new DocStore(db) };
}

describe('DocStore.whenSaved (durability NFR)', () => {
  it('resolves at once for a document with nothing unsaved', async () => {
    const { docs } = await open();
    expect(docs.isSaved('todo')).toBe(true);
    await docs.whenSaved('todo');
  });

  it('resolves once the changes made before the call are in IndexedDB', async () => {
    const { db, docs } = await open();
    const doc = await docs.open('todo');
    doc.getText('checklist').insert(0, '- [ ] a\n');
    expect(docs.isSaved('todo')).toBe(false);
    await docs.whenSaved('todo');
    expect(docs.isSaved('todo')).toBe(true);
    const rows = await db.getUpdates('todo');
    const copy = new Y.Doc();
    for (const r of rows) Y.applyUpdate(copy, r.data);
    expect(copy.getText('checklist').toString()).toBe('- [ ] a\n');
  });

  it('waits for a failed write to be retried', async () => {
    const { db, docs } = await open();
    const doc = await docs.open('todo');
    const put = db.putUpdate.bind(db);
    let fail = true;
    db.putUpdate = (id, data) => (fail ? Promise.reject(new Error('quota')) : put(id, data));
    doc.getText('checklist').insert(0, '- [ ] a\n');
    let saved = false;
    void docs.whenSaved('todo').then(() => (saved = true));
    await docs.flushNow();
    await new Promise((r) => setTimeout(r, 50));
    expect(saved).toBe(false);
    fail = false;
    await docs.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toBe(true);
    expect((await db.getUpdates('todo')).length).toBeGreaterThan(0);
  });
});
