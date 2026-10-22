/** Push edge cases: deletions of library items whose folder was reused, clipping content. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from './git/fakeGitHub';
import { device, type TestDevice } from './testing/device';
import { useNodeBlob } from './testing/nodeBlob';
import { runCheckPy } from './testing/checkpy';
import { annotationsDocId } from '../stores/docIds';
import type { BookMeta, ClippingMeta } from '../model/types';

beforeAll(useNodeBlob);

let devices: TestDevice[] = [];
afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

async function setup() {
  const gh = new FakeGitHub();
  const repo = await gh.createRepo('me/gym', { tokens: ['tok'], files: { 'README.md': '# gym\n' } });
  const dev = async (name: string) => {
    const d = await device(gh, name);
    devices.push(d);
    return d;
  };
  return { gh, repo, dev };
}

const book = (id: string): BookMeta => ({ id, slug: 'sicp', format: 'pdf', title: 'SICP', authors: [], citation: '', fileHash: id.repeat(64).slice(0, 64), fileName: 's.pdf', size: 1, added: 1 });
const clipping = (id: string): ClippingMeta => ({ id, slug: '2026-10-21-notes', origin: 'clipboard', title: 'Notes', format: 'plain', added: 1, contentHash: id });
const paths = (repo: { files(): Map<string, Uint8Array> }, prefix: string) => [...repo.files().keys()].filter((p) => p.startsWith(prefix)).sort();

describe('deleting library items (L13, G9)', () => {
  it('L13: a pending deletion does not remove a new book that took the same folder, and clears', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    await b.library.putBook(book('b1'));
    await b.sync.sync();
    await a.sync.sync();
    await a.library.deleteBook('b1'); // deleted on a while offline
    await b.library.deleteBook('b1');
    await b.sync.sync();
    await b.library.putBook(book('b2'));
    (await b.docs.open(annotationsDocId('b2'))).getMap('annotations').set('x', { id: 'x', kind: 'highlight', locator: { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }, color: '#ff0', text: 'x', created: 1 });
    await b.sync.sync();
    const before = paths(repo, 'library/books/sicp/');
    expect(before).toContain('library/books/sicp/annotations.yjs');
    await a.sync.sync();
    expect(paths(repo, 'library/books/sicp/')).toEqual(before);
    expect(JSON.parse(repo.text('library/books/sicp/book.json')!).id).toBe('b2');
    expect(a.library.tombstones()).toEqual([]);
    expect(a.library.book('b2')).toBeDefined();
    const commits = repo.log().length;
    await a.sync.sync();
    expect(repo.log().length).toBe(commits);
    expect(runCheckPy(repo).ok).toBe(true);
  });

  it('L13: a pending deletion does not remove a new clipping that took the same folder', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    await b.library.putClipping(clipping('c1'), { markdown: 'first', assets: [] });
    await b.sync.sync();
    await a.sync.sync();
    await a.library.deleteClipping('c1');
    await b.library.deleteClipping('c1');
    await b.sync.sync();
    await b.library.putClipping(clipping('c2'), { markdown: 'second', assets: [] });
    await b.sync.sync();
    await a.sync.sync();
    expect(paths(repo, 'library/clippings/')).toContain('library/clippings/2026-10-21-notes/clipping.md');
    expect(JSON.parse(repo.text('library/clippings/2026-10-21-notes/meta.json')!).id).toBe('c2');
    expect(a.library.tombstones()).toEqual([]);
    expect(runCheckPy(repo).ok).toBe(true);
  });

  it('L13: deleting an item still removes its folder', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.library.putBook(book('b1'));
    await a.sync.sync();
    await a.library.deleteBook('b1');
    await a.sync.sync();
    expect(paths(repo, 'library/books/')).toEqual([]);
    expect(a.library.tombstones()).toEqual([]);
  });
});
