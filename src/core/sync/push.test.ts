/** Push edge cases: deletions of library items whose folder was reused, clipping content. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from './git/fakeGitHub';
import { device, type TestDevice } from './testing/device';
import { useNodeBlob } from './testing/nodeBlob';
import { runCheckPy } from './testing/checkpy';
import { annotationsDocId } from '../stores/docIds';
import { mark, text as textBox } from './testing/fixtures';
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

describe('clipping content round trip (L11, G9)', () => {
  const cases: [string, ClippingMeta['format'], string][] = [
    ['code', 'plain', 'for (const h of list) handlers[0](event);\nresult = funcs[i](x)\n'],
    ['links', 'markdown', '# Notes\n\nSee [the docs](docs/intro.md) and ![fig](img/a.png)\n\n```\n[kept](in-fence.md)\n```\nand `[x](y.md)` and [web](https://e.org/a)   \n\n\n'],
    ['escaped', 'markdown', 'Already escaped: [a]\\(b.md) and \\\\(c) and a [t](x.md "title")\r\nwindows\rline [r](r.md)'],
    ['whitespace', 'plain', '\n\n  leading and trailing  \t\n\n'],
    ['brackets', 'markdown', 'a [b\n\nc](d.md) [e]( f.md ) [g](<h i.md>)'],
  ];
  for (const [name, format, original] of cases) {
    it(`L11: ${name} content comes back byte for byte on another device, and check.py accepts it (G9)`, async () => {
      const { repo, dev } = await setup();
      const a = await dev('a');
      const b = await dev('b');
      const meta: ClippingMeta = { id: 'c1', slug: `2026-10-21-${name}`, origin: 'clipboard', title: 'Code [x](y.md) `z`', format, added: 1, contentHash: 'x', url: 'https://e.org/a[1]' };
      await a.library.putClipping(meta, { markdown: original, assets: [] });
      await a.sync.sync();
      await b.sync.sync();
      expect(await b.sync.ensureClipping('c1')).toBe(true);
      expect((await b.library.clippingContent('c1'))!.markdown).toBe(original);
      const check = runCheckPy(repo);
      expect(check.ok, check.output).toBe(true);
    });
  }
});

describe("Python's line semantics in generated Markdown (G9)", () => {
  const T = (d: number, h = 10) => new Date(2026, 9, d, h).getTime();

  it('G9: line separators in a mark comment and code-like text in a text box pass check.py', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    const content = 'Para one\u2028```\n[link](nowhere.md)\n```\nend `x\r[l2](missing2.md)\ry` and \u0085[l3](missing3.md) `a\u2028[l4](missing4.md)`';
    await a.draw([textBox('t1', T(21), content)], [mark('m1', T(21, 11), 'note', ['t1'], undefined, { comment: 'see p.\u2028id: other\u0085kind: x\u000bday: y\fz\x1ctopic: w' })]);
    await a.sync.sync();
    const md = repo.text('journal/main/2026-10/marks/m1.md')!;
    const fm = md.split('---\n')[1];
    expect(fm.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/).filter((l) => l.startsWith('id:'))).toEqual(['id: m1']);
    const check = runCheckPy(repo);
    expect(check.ok, check.output).toBe(true);
  });
});
