/** Pull edge cases: local changes made while a pull is downloading, items replaced in a folder. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from './git/fakeGitHub';
import { device, type TestDevice } from './testing/device';
import { useNodeBlob } from './testing/nodeBlob';
import { runCheckPy } from './testing/checkpy';
import { stroke } from './testing/fixtures';
import type { BookMeta, ClippingMeta } from '../model/types';

beforeAll(useNodeBlob);

const T = (d: number, h = 10) => new Date(2026, 9, d, h).getTime();
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

/** Runs `fn` once, just before the first request matching `match` (a download in flight). */
function beforeRequest(gh: FakeGitHub, match: (method: string, url: string) => boolean, fn: () => Promise<unknown>) {
  const handle = gh.handle.bind(gh);
  let fired = false;
  gh.handle = async (method, url, headers, body) => {
    if (!fired && match(method, url)) {
      fired = true;
      await fn();
    }
    return handle(method, url, headers, body);
  };
  return () => fired;
}

const blobGet = (method: string, url: string) => method === 'GET' && /\/git\/blobs\//.test(url);

describe('pull with local changes in flight (R1, G9)', () => {
  it('R1: a canvas created while canvas.json downloads is kept and pushed with its canvas.json (G9)', async () => {
    const { gh, repo, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    await a.sync.sync();
    await b.sync.sync();
    await b.canvases.update('main', { title: 'Lectures' });
    await b.sync.sync();
    const fired = beforeRequest(gh, blobGet, () => a.canvases.create('Physics', 'physics'));
    await a.sync.sync();
    expect(fired()).toBe(true);
    expect(a.canvases.meta('physics')).toBeDefined();
    expect(a.canvases.meta('main')!.title).toBe('Lectures');
    await a.draw([stroke('s1', T(21))], [], 'physics');
    await a.sync.sync();
    expect(repo.text('journal/physics/canvas.json')).toBeDefined();
    const check = runCheckPy(repo);
    expect(check.output).not.toContain('missing canvas.json');
    expect(check.ok, check.output).toBe(true);
  });

  it('R1: a canvas renamed while canvas.json downloads keeps the new title', async () => {
    const { gh, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    await a.canvases.create('Physics', 'physics');
    await a.sync.sync();
    await b.sync.sync();
    await b.canvases.update('main', { topics: ['math/x'] });
    await b.sync.sync();
    beforeRequest(gh, blobGet, () => a.canvases.update('physics', { title: 'Physics lectures' }));
    await a.sync.sync();
    expect(a.canvases.meta('physics')!.title).toBe('Physics lectures');
    expect(a.canvases.meta('main')!.topics).toEqual(['math/x']);
    await a.sync.sync();
    await b.sync.sync();
    expect(b.canvases.meta('physics')!.title).toBe('Physics lectures');
  });

  it('R1: a library item deleted while the library index downloads stays deleted', async () => {
    const { gh, repo, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    const book: BookMeta = { id: 'b1', slug: 'sicp', format: 'pdf', title: 'SICP', authors: [], citation: '', fileHash: 'a'.repeat(64), fileName: 's.pdf', size: 1, added: 1 };
    await b.library.putBook(book);
    await b.sync.sync();
    await a.sync.sync();
    await b.library.putBook({ ...book, title: 'Structure and Interpretation' });
    await b.sync.sync();
    beforeRequest(gh, blobGet, () => a.library.deleteBook('b1'));
    await a.sync.sync();
    expect(a.library.book('b1')).toBeUndefined();
    await a.sync.sync();
    expect([...repo.files().keys()].some((p) => p.startsWith('library/books/sicp/'))).toBe(false);
    expect(a.library.tombstones()).toEqual([]);
  });

  it('R9: a clipping deleted while its content downloads stays deleted', async () => {
    const { gh, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    const meta: ClippingMeta = { id: 'c1', slug: '2026-10-21-notes', origin: 'clipboard', title: 'Notes', format: 'plain', added: 1, contentHash: 'h' };
    await b.library.putClipping(meta, { markdown: 'text', assets: [] });
    await b.sync.sync();
    await a.sync.sync();
    beforeRequest(gh, blobGet, () => a.library.deleteClipping('c1'));
    expect(await a.sync.ensureClipping('c1')).toBe(false);
    expect(a.library.clipping('c1')).toBeUndefined();
    expect(await a.library.clippingContent('c1')).toBeNull();
  });
});
