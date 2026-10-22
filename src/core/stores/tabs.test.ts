/** R1 with the app open in two tabs of one browser: neither tab's saved changes are lost. */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SlateDB } from '../storage/idb';
import { DocStore } from '../storage/docstore';
import { LibraryStore } from './library';
import { CanvasStore } from './canvases';
import { SettingsStore } from './settings';
import type { ClippingMeta } from '../model/types';

const meta = (id: string): ClippingMeta => ({ id, slug: `2026-10-21-${id}`, origin: 'clipboard', title: id, format: 'plain', added: 1, contentHash: id });
let n = 0;
const dbName = () => `tabs-${Date.now()}-${n++}`;
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('two tabs on one database (R1)', () => {
  it("R1: the library index keeps both tabs' changes", async () => {
    const name = dbName();
    const tabA = await LibraryStore.open(await SlateDB.open(name));
    const tabB = await LibraryStore.open(await SlateDB.open(name));
    await tabB.putClipping(meta('fromb'), { markdown: 'B', assets: [] });
    await tabA.putClipping(meta('froma'), { markdown: 'A', assets: [] });
    await tabA.deleteClipping('fromb');
    await tabB.putClipping(meta('fromb2'), { markdown: 'B2', assets: [] });
    const fresh = await LibraryStore.open(await SlateDB.open(name));
    expect(fresh.clippings().map((c) => c.id).sort()).toEqual(['froma', 'fromb2']);
    expect(fresh.tombstones().map((t) => t.id)).toEqual(['fromb']);
    // and each tab sees the other's changes
    await until(() => tabA.clippings().length === 2);
    expect(tabA.clippings().map((c) => c.id).sort()).toEqual(['froma', 'fromb2']);
    expect(tabB.clippings().map((c) => c.id).sort()).toEqual(['froma', 'fromb2']);
  });

  it("R1: the canvas list keeps both tabs' changes", async () => {
    const name = dbName();
    const dbA = await SlateDB.open(name);
    const dbB = await SlateDB.open(name);
    const tabA = await CanvasStore.open(dbA, new DocStore(dbA), 'a');
    const tabB = await CanvasStore.open(dbB, new DocStore(dbB), 'b');
    await tabA.create('Physics', 'physics');
    await tabB.create('Maths', 'maths');
    await tabA.update('main', { title: 'Lectures' });
    const fresh = await CanvasStore.open(await SlateDB.open(name), new DocStore(dbA), 'c');
    expect(fresh.list().map((m) => m.slug).sort()).toEqual(['main', 'maths', 'physics']);
    expect(fresh.meta('main')!.title).toBe('Lectures');
    await until(() => tabB.list().length === 3);
    expect(tabB.meta('main')!.title).toBe('Lectures');
  });

  it("R1: settings keep both tabs' changes", async () => {
    const name = dbName();
    const tabA = await SettingsStore.open(await SlateDB.open(name));
    const tabB = await SettingsStore.open(await SlateDB.open(name));
    await tabB.update({ colors: ['#123456'] });
    await tabA.update({ readingPositions: { b1: { sourceId: 'b1', locator: { type: 'pdf', page: 2, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }, updated: 5, device: 'a' } } }, { touch: false });
    await tabA.setPrefs({ minimap: false });
    await tabB.setPrefs({ theme: 'dark' });
    const fresh = await SettingsStore.open(await SlateDB.open(name));
    expect(fresh.get().colors).toEqual(['#123456']);
    expect(Object.keys(fresh.get().readingPositions)).toEqual(['b1']);
    expect(fresh.getPrefs()).toMatchObject({ minimap: false, theme: 'dark' });
  });

  it('R1: a document open in one tab receives what the other tab saves', async () => {
    const name = dbName();
    const docsA = new DocStore(await SlateDB.open(name));
    const docsB = new DocStore(await SlateDB.open(name));
    const a = await docsA.open('todo');
    const b = await docsB.open('todo');
    b.getText('checklist').insert(0, 'from b');
    await docsB.flush();
    await until(() => a.getText('checklist').toString() === 'from b');
    expect(a.getText('checklist').toString()).toBe('from b');
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    expect(await docsA.listDocIds()).toContain('todo');
  });
});
