import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeGitHub, type FakeRepo } from './git/fakeGitHub';
import { device, text, type TestDevice } from './testing/device';
import { useNodeBlob } from './testing/nodeBlob';
import { PNG_1X1, bookSource, clip, clippingSource, image, mark, stroke, text as textBox } from './testing/fixtures';
import { segmentDocId, TODO_DOC_ID, annotationsDocId } from '../stores/docIds';
import { checklistText } from '../stores/todo';
import { objectsMap } from '../canvas/segment';
import { isWritablePath } from './scope';
import { sha256Hex } from '../util/ids';
import type { BookMeta, ClippingMeta } from '../model/types';
import { decodePng } from './testing/stubRasterizer';
import { parseFrontMatter } from './derived/frontmatter';

beforeAll(useNodeBlob);

const T = (d: number, h = 10, month = 9) => new Date(2026, month, d, h).getTime();

const GYM_FILES = {
  'README.md': '# gym\n\n## Domains\n',
  'AGENTS.md': '# Agents\n',
  'math/README.md': '# Math\n\n![diagram](assets/fig.svg)\n',
  'math/assets/fig.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'math/linear-algebra/eigenvalues/notes.md': '# Eigenvalues\n\n## Spectral theorem\n',
  'scripts/check.py': 'print("ok")\n',
};

let devices: TestDevice[] = [];
afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

async function setup(files: Record<string, string> = GYM_FILES) {
  const gh = new FakeGitHub();
  const repo = await gh.createRepo('me/gym', { tokens: ['tok', 'tok2'], files, tokenExpiry: '2026-11-01 00:00:00 UTC' });
  const dev = async (name: string, opts: Parameters<typeof device>[2] = {}) => {
    const d = await device(gh, name, opts);
    devices.push(d);
    return d;
  };
  return { gh, repo, dev };
}

/** Every path written by the app's commits (everything after the initial commit). */
function appPaths(repo: FakeRepo): string[] {
  return repo
    .commitPaths()
    .filter((c) => c.message !== 'Initial commit' && !c.message.startsWith('external'))
    .flatMap((c) => c.paths);
}

function segText(d: TestDevice, slug: string, month: string, id: string): string | undefined {
  const doc = d.docs.getLoaded(segmentDocId(slug, month));
  const t = doc ? objectsMap(doc).get(id)?.get('content') : undefined;
  return t instanceof Y.Text ? t.toString() : undefined;
}

describe('sync with GitHub (R4, R8)', () => {
  it('pushes canvases, documents, settings and derived files in one commit per scope', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), 'Eigenvalues\n\n- [ ] prove the lemma'), stroke('s1', T(21), 0, 100)], [mark('m1', T(21, 11), 'note', ['t1'])]);
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'synced', needsToken: false });
    expect(repo.log()).toEqual(['journal: Add main canvas', 'library: Update settings', 'Initial commit']);
    expect(repo.refUpdates).toBe(1); // one push, one ref update (R8)
    const files = repo.files();
    for (const p of [
      'journal/README.md',
      'journal/queue.md',
      'journal/todos.md',
      'journal/main/canvas.json',
      'journal/main/2026-10/canvas.yjs',
      'journal/main/2026-10/days/2026-10-21.md',
      'journal/main/2026-10/days/2026-10-21.svg',
      'journal/main/2026-10/marks/m1.md',
      'journal/main/2026-10/marks/m1.png',
      'library/README.md',
      'library/settings.json',
    ]) {
      expect(files.has(p), p).toBe(true);
    }
    expect(text(files.get('journal/queue.md'))).toBe('# Queue\n\n- [m1](main/2026-10/marks/m1.md) · note · no topic · 2026-10-21\n');
    expect(text(files.get('journal/todos.md'))).toContain('- [ ] prove the lemma · [2026-10-21](main/2026-10/days/2026-10-21.md)');
    expect(JSON.parse(text(files.get('journal/main/canvas.json'))!)).toMatchObject({ id: 'main', title: 'Main', topics: [] });

    // nothing changed: no commit
    await a.sync.sync();
    expect(repo.log()).toHaveLength(3);

    // an edit produces one journal commit named after the canvas and month
    await a.draw([stroke('s2', T(22), 0, 300)]);
    await a.sync.sync();
    expect(repo.log()[0]).toBe('journal: Update main canvas, 2026-10');
    expect(repo.files().has('journal/main/2026-10/days/2026-10-22.md')).toBe(true);
  });

  it('never writes outside journal/ and library/ (R5)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), 'x')]);
    await a.sync.sync();
    await a.settings.update({ colors: ['#123456'] });
    await a.sync.sync();
    const paths = appPaths(repo);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) expect(isWritablePath(p), p).toBe(true);
    expect(text(repo.files().get('README.md'))).toBe(GYM_FILES['README.md']);
  });

  it('two devices editing the same canvas offline merge with nothing lost, in both orders (R2)', async () => {
    for (const order of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const) {
      const { repo, dev } = await setup();
      const a = await dev('a');
      await a.draw([textBox('shared', T(20), 'alpha'), stroke('base', T(20), 0, 0)]);
      await a.sync.sync();
      const b = await dev('b');
      await b.sync.sync();
      await b.draw([]); // open the canvas: downloads the segment on demand (R9)
      await b.canvases.model('main').load(['2026-10']);
      expect(segText(b, 'main', '2026-10', 'shared')).toBe('alpha');

      // offline: both edit the same text box, draw, mark, and tick to-dos
      const ta = a.canvases.model('main').textOf('shared')!;
      const tb = b.canvases.model('main').textOf('shared')!;
      ta.insert(5, ' [A]');
      tb.insert(0, '[B] ');
      await a.draw([stroke('sa', T(21), 10, 500)], [mark('ma', T(21, 12), 'question', ['sa'])]);
      await b.draw([stroke('sb', T(21), 600, 500), textBox('tb', T(21), '- [ ] from B', 0, 700)]);
      a.canvases.model('main').transact((tx) => tx.remove('base'));
      checklistText(await a.docs.open(TODO_DOC_ID)).insert(0, '- [ ] from A\n');

      const [first, second] = order[0] === 'a' ? [a, b] : [b, a];
      await first.sync.sync();
      await second.sync.sync(); // pulls the first device's commit, merges, pushes the merge
      await first.sync.sync();

      for (const d of [a, b]) {
        const m = d.canvases.model('main');
        expect(segText(d, 'main', '2026-10', 'shared')).toBe('[B] alpha [A]');
        expect(m.has('sa') && m.has('sb') && m.has('tb')).toBe(true);
        expect(m.has('base')).toBe(false);
        expect(m.mark('ma')?.kind).toBe('question');
      }
      // the repository holds the merged state and derived files from it
      const remoteDoc = new Y.Doc();
      Y.applyUpdate(remoteDoc, repo.files().get('journal/main/2026-10/canvas.yjs')!);
      expect([...objectsMap(remoteDoc).keys()].sort()).toEqual(['sa', 'sb', 'shared', 'tb']);
      const todos = text(repo.files().get('journal/todos.md'))!;
      expect(todos).toContain('- [ ] from A\n');
      expect(todos).toContain('- [ ] from B · [2026-10-21]');
      expect(text(repo.files().get('journal/queue.md'))).toContain('- [ma](main/2026-10/marks/ma.md) · question');
      // a further round is quiet on both
      const commits = repo.log().length;
      await a.sync.sync();
      await b.sync.sync();
      expect(repo.log().length).toBe(commits);
      for (const d of devices.splice(0)) await d.close();
    }
  });

  it('a rejected push (the branch moved) pulls, merges and retries (R4)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    const b = await dev('b');
    await a.draw([stroke('a1', T(21))]);
    await a.sync.sync();
    await b.sync.sync();
    await a.draw([stroke('a2', T(21), 0, 100)]);
    await b.draw([stroke('b2', T(21), 0, 200)]);
    // while A is pushing, B pushes first
    repo.beforeRefUpdate = () => b.sync.sync();
    await a.sync.sync();
    expect(repo.conflicts).toBe(1);
    expect(a.sync.getStatus().phase).toBe('synced');
    await b.sync.sync();
    for (const d of [a, b]) for (const id of ['a1', 'a2', 'b2']) expect(d.canvases.model('main').has(id), `${d.name} ${id}`).toBe(true);
    expect(repo.log().filter((m) => m.startsWith('journal:')).length).toBeGreaterThanOrEqual(3);
  });

  it('reports an error after repeated rejections and recovers on the next sync', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([stroke('a1', T(21))]);
    repo.rejectRefUpdates = 4;
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'error' });
    expect(a.sync.getStatus().reason).toMatch(/retry/);
    await a.sync.sync();
    expect(a.sync.getStatus().phase).toBe('synced');
    expect(repo.files().has('journal/main/2026-10/canvas.yjs')).toBe(true);
  });
});

describe('new device (R9, R3)', () => {
  it('downloads the library index and canvas list first, segments and clippings when opened', async () => {
    const { gh, repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('sep', T(30, 10, 8), 'September')]);
    await a.draw([textBox('oct', T(21), 'October')]);
    await a.canvases.create('Physics', 'physics');
    await a.draw([stroke('p1', T(21))], [], 'physics');
    const clipping: ClippingMeta = { id: 'c1', slug: '2026-10-21-attention', origin: 'clipboard', title: 'Attention', format: 'markdown', added: T(21), contentHash: 'h' };
    const assetBytes = PNG_1X1;
    const assetHash = await sha256Hex(assetBytes);
    await a.assets.putWithHash(assetHash, new Blob([assetBytes], { type: 'image/png' }));
    await a.library.putClipping(clipping, { markdown: '# Attention\n\n![fig](assets/' + assetHash + '.png)\n\n[relative](other.md)', assets: [{ path: `assets/${assetHash}.png`, hash: assetHash, mime: 'image/png' }] });
    await a.sync.sync();
    expect(text(repo.files().get(`library/clippings/${clipping.slug}/clipping.md`))).toContain('[relative]\\(other.md)');

    const before = gh.requests.length;
    const b = await dev('b');
    await b.sync.sync();
    const blobGets = gh.requests.slice(before).filter((r) => r.path.includes('/git/blobs/'));
    // index files were downloaded; canvas segments were not
    expect(b.canvases.list().map((c) => c.slug).sort()).toEqual(['main', 'physics']);
    expect(Object.keys(b.canvases.meta('main')!.segments!).sort()).toEqual(['2026-09', '2026-10']);
    expect(b.library.clipping('c1')?.title).toBe('Attention');
    expect(await b.docs.listDocIds()).not.toContain(segmentDocId('main', '2026-10'));
    expect(await b.library.clippingContent('c1')).toBeNull();
    expect(blobGets.length).toBeGreaterThan(0);

    // opening a month downloads just that segment (R3, R9)
    const model = b.canvases.model('main');
    await model.load(['2026-10']);
    expect(model.has('oct')).toBe(true);
    expect(model.has('sep')).toBe(false);
    await model.load(['2026-09']);
    expect(model.has('sep')).toBe(true);
    expect(await b.docs.listDocIds()).not.toContain(segmentDocId('physics', '2026-10'));

    // opening a clipping downloads its content and assets
    expect(await b.sync.ensureClipping('c1')).toBe(true);
    const content = await b.library.clippingContent('c1');
    expect(content?.markdown).toContain('# Attention');
    expect(await b.assets.has(assetHash)).toBe(true);

    // pushing from the new device changes nothing it did not touch
    const commits = repo.log().length;
    await b.sync.sync();
    expect(repo.log().length).toBe(commits);
  });

  it('carries queue and to-do lines for segments the device has not downloaded', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), '- [ ] task one')], [mark('m1', T(21), 'problem', ['t1'])]);
    await a.sync.sync();
    const b = await dev('b');
    await b.sync.sync();
    checklistText(await b.docs.open(TODO_DOC_ID)).insert(0, '- [ ] from the checklist\n');
    await b.sync.sync();
    const todos = text(repo.files().get('journal/todos.md'))!;
    expect(todos).toContain('- [ ] from the checklist');
    expect(todos).toContain('- [ ] task one · [2026-10-21](main/2026-10/days/2026-10-21.md)');
    expect(text(repo.files().get('journal/queue.md'))).toContain('- [m1](main/2026-10/marks/m1.md)');
  });
});

describe('authentication (R4)', () => {
  it('pauses on a rejected token, keeps local changes and resumes with a new token', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([stroke('s1', T(21))]);
    await a.sync.sync();
    repo.tokens = new Set(['tok2']); // the token was revoked
    await a.draw([stroke('s2', T(21), 0, 100)]);
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'error', needsToken: true });
    expect(a.sync.getStatus().reason).toMatch(/rejected the token/);
    expect(a.sync.hasLocalChanges()).toBe(true);
    // paused: no further requests are attempted
    await a.sync.sync();
    expect(a.sync.getStatus().needsToken).toBe(true);
    expect(a.canvases.model('main').has('s2')).toBe(true);

    await a.settings.setSecrets({ token: 'tok2' });
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'synced', needsToken: false });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, repo.files().get('journal/main/2026-10/canvas.yjs')!);
    expect(objectsMap(doc).has('s2')).toBe(true);
    expect(a.sync.hasLocalChanges()).toBe(false);
  });

  it('verifies write access through the repository permissions before connecting', async () => {
    const { gh, dev } = await setup();
    await gh.createRepo('me/readonly', { tokens: ['tok'], push: false });
    const a = await dev('a', { connect: false });
    expect(a.sync.getStatus().phase).toBe('off');
    expect(await a.sync.verify({ token: 'tok', repo: 'me/readonly', branch: 'main' })).toMatchObject({ ok: false, error: expect.stringMatching(/not write/) });
    expect(await a.sync.verify({ token: 'tok', repo: 'me/gym', branch: 'nope' })).toMatchObject({ ok: false, branchExists: false });
    expect(await a.sync.verify({ token: 'bad', repo: 'me/gym', branch: 'main' })).toMatchObject({ ok: false, error: expect.stringMatching(/rejected the token/) });
    expect(await a.sync.verify({ token: 'tok', repo: 'gym', branch: 'main' })).toMatchObject({ ok: false });
    const ok = await a.sync.connect({ token: 'tok', repo: 'me/gym', branch: 'main' });
    expect(ok).toMatchObject({ ok: true, branchExists: true, tokenExpiry: Date.UTC(2026, 10, 1) });
    expect(a.settings.getSecrets()).toMatchObject({ token: 'tok', repo: 'me/gym', branch: 'main', tokenExpiry: Date.UTC(2026, 10, 1) });
    a.sync.stop();
    expect(a.sync.getStatus().phase).toBe('synced');
  });

  it('warns 14 days before the token expires', async () => {
    const { dev } = await setup();
    const a = await dev('a', { now: () => Date.UTC(2026, 9, 21) });
    await a.sync.sync();
    expect(a.sync.getStatus().tokenExpiry).toBe(Date.UTC(2026, 10, 1));
    expect(a.sync.getStatus().expiryWarning).toMatch(/expires in 11 days/);
  });
});

describe('derived files (R6, G5, G6)', () => {
  it('regenerates days and marks from the documents and drops files of removed marks', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), 'note text'), textBox('t2', T(21), 'other', 0, 300)], [mark('m1', T(21), 'note', ['t1']), mark('m2', T(21), 'solution', ['t2'], { x: 0, y: 290, w: 300, h: 80 }, { problem: 'math/p/problems/001-x.md' })]);
    await a.sync.sync();
    const m1 = parseFrontMatter(text(repo.files().get('journal/main/2026-10/marks/m1.md'))!);
    expect(m1.fields).toMatchObject({ id: 'm1', kind: 'note', day: '../days/2026-10-21.md' });
    expect(m1.body).toContain('note text');
    const png = decodePng(repo.files().get('journal/main/2026-10/marks/m2.png')!);
    expect([png.width, png.height]).toEqual([600, 160]);

    a.canvases.model('main').transact((tx) => tx.removeMark('m2'));
    await a.sync.sync();
    expect(repo.files().has('journal/main/2026-10/marks/m2.md')).toBe(false);
    expect(repo.files().has('journal/main/2026-10/marks/m2.png')).toBe(false);
    expect(text(repo.files().get('journal/queue.md'))).not.toContain('m2');

    // a derived file edited on GitHub is regenerated, never merged
    await repo.commitFiles({ 'journal/main/2026-10/days/2026-10-21.md': 'edited by hand\n' }, 'external edit');
    await a.draw([textBox('t3', T(21), 'more', 0, 600)]);
    await a.sync.sync();
    expect(text(repo.files().get('journal/main/2026-10/days/2026-10-21.md'))).toContain('more');
    expect(text(repo.files().get('journal/main/2026-10/days/2026-10-21.md'))).not.toContain('edited by hand');
  });

  it('parses formalized.md on every pull and drops formalized marks from the queue (G6)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), 'x')], [mark('m1', T(21), 'note', ['t1']), mark('m2', T(21, 12), 'question', ['t1'])]);
    await a.sync.sync();
    await repo.commitFiles({ 'journal/formalized.md': '# Formalized\n\n- m1 → ../math/linear-algebra/eigenvalues/notes.md#spectral-theorem · 2026-10-22\n' }, 'external: formalize m1');
    await a.sync.sync();
    expect(a.formalized.get('m1')).toMatchObject({ dismissed: false, path: 'math/linear-algebra/eigenvalues/notes.md', heading: 'spectral-theorem' });
    const queue = text(repo.files().get('journal/queue.md'))!;
    expect(queue).not.toContain('[m1]');
    expect(queue).toContain('[m2]');
    expect(repo.log()[0]).toBe('journal: Update queue and to-dos');
    expect(text(repo.files().get('journal/README.md'))).toContain('[formalized.md](formalized.md)');
  });
});

describe('assets and library (R7, R11)', () => {
  it('uploads assets once, named by content hash, under the segment', async () => {
    const { gh, repo, dev } = await setup();
    const a = await dev('a');
    const hash = await a.assets.put(new Blob([PNG_1X1], { type: 'image/png' }));
    expect(await a.assets.put(new Blob([PNG_1X1], { type: 'image/png' }))).toBe(hash);
    await a.draw([image('i1', T(21), hash), image('i2', T(21), hash, 300)]);
    await a.sync.sync();
    expect(repo.files().get(`journal/main/2026-10/assets/${hash}.png`)).toEqual(PNG_1X1);
    const blobs = gh.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git/blobs')).length;
    await a.draw([image('i3', T(22), hash, 600)]);
    await a.sync.sync();
    // the image is not uploaded again; only the segment and derived files are
    const uploads = gh.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git/blobs')).length - blobs;
    expect(repo.commitPaths()[0].paths.some((p) => p.includes('/assets/'))).toBe(false);
    expect(uploads).toBeGreaterThan(0);
    expect(text(repo.files().get('journal/main/2026-10/days/2026-10-21.md'))).toContain(`![Board photo](../assets/${hash}.png)`);

    // another device gets the image when it opens the canvas
    const b = await dev('b');
    await b.sync.sync();
    await b.canvases.model('main').load(['2026-10']);
    expect(await b.assets.has(hash)).toBe(true);
  });

  it('refuses files over 50 MB unless Git LFS mode is on', async () => {
    const { dev } = await setup();
    const a = await dev('a');
    const big = { size: 51 * 1024 * 1024 } as Blob;
    await expect(a.assets.put(big)).rejects.toThrow(/50 MB/);
  });

  it('syncs library metadata and settings, removes deleted items, keeps secrets on the device (R11)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    const book: BookMeta = { id: 'b1', slug: 'sicp', format: 'pdf', title: 'SICP', authors: ['Abelson'], citation: 'Abelson, SICP, 2nd ed.', fileHash: 'f'.repeat(64), fileName: 'sicp.pdf', size: 10, added: T(1) };
    await a.library.putBook(book);
    await a.settings.update({ colors: ['#abcdef'], pens: [{ tool: 'pen', color: '#000000', size: 3 }] });
    await a.settings.setSecrets({ helperKey: 'secret-helper-key' });
    const ann = await a.docs.open(annotationsDocId('b1'));
    ann.getMap('annotations').set('x1', { id: 'x1', kind: 'highlight', locator: { type: 'pdf', page: 3, region: { x: 0, y: 0, w: 1, h: 0.1 }, quote: 'q' }, color: '#ff0', text: 'Lisp', created: 1 });
    await a.draw([clip('c1', T(21), bookSource('b1', 'SICP', 3), 'quote')]);
    await a.sync.sync();
    const files = repo.files();
    expect(JSON.parse(text(files.get('library/books/sicp/book.json'))!)).toMatchObject({ id: 'b1', title: 'SICP' });
    expect(text(files.get('library/books/sicp/annotations.md'))).toContain('- Highlight: “Lisp”');
    expect(files.has('library/books/sicp/annotations.yjs')).toBe(true);
    expect(files.has('library/books/sicp/book.pdf')).toBe(false); // book files stay on the device by default
    expect(JSON.parse(text(files.get('library/settings.json'))!).colors).toEqual(['#abcdef']);
    for (const [, bytes] of files) {
      expect(text(bytes)).not.toContain('secret-helper-key');
      expect(text(bytes)).not.toContain('"tok"');
    }
    expect(text(files.get('journal/main/2026-10/days/2026-10-21.md'))).toContain('[SICP, p. 3](../../../../library/books/sicp/)');
    expect(repo.log()[0]).toBe('journal: Add main canvas');
    expect(repo.log()[1]).toMatch(/^library: Add book sicp/);

    const b = await dev('b');
    await b.sync.sync();
    expect(b.library.book('b1')?.title).toBe('SICP');
    expect(b.settings.get().colors).toEqual(['#abcdef']);
    expect(b.settings.getSecrets().helperKey).toBeUndefined();

    // deleting the book removes its folder; the day file stops linking to it in an earlier commit
    await a.library.deleteBook('b1');
    await a.sync.sync();
    expect([...repo.files().keys()].some((p) => p.startsWith('library/books/sicp/'))).toBe(false);
    expect(text(repo.files().get('journal/main/2026-10/days/2026-10-21.md'))).toContain('SICP, p. 3 (source deleted)');
    expect(repo.log().slice(0, 2)).toEqual(['library: Remove book sicp', 'journal: Update main canvas, 2026-10']);
    expect(a.library.tombstones()).toEqual([]);
    await b.sync.sync();
    expect(b.library.book('b1')).toBeUndefined();
  });

  it('merges JSON edits from two devices field by field (R2)', async () => {
    const { dev } = await setup();
    const a = await dev('a');
    await a.sync.sync();
    const b = await dev('b');
    await b.sync.sync();
    await a.canvases.update('main', { title: 'Lectures' });
    await b.canvases.update('main', { topics: ['math/linear-algebra/eigenvalues'] });
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    for (const d of [a, b]) expect(d.canvases.meta('main')).toMatchObject({ title: 'Lectures', topics: ['math/linear-algebra/eigenvalues'] });
  });

  it('Git LFS mode uploads book files and commits pointers (against an LFS server that allows it)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.settings.update({ lfs: true });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await a.assets.put(new Blob([bytes], { type: 'application/pdf' }));
    await a.library.putBook({ id: 'b1', slug: 'notes', format: 'pdf', title: 'Notes', authors: [], citation: '', fileHash: hash, fileName: 'n.pdf', size: 4, added: 1 });
    await a.sync.sync();
    expect(a.sync.getStatus().warnings).toEqual([]);
    expect(text(repo.files().get('library/books/notes/book.pdf'))).toBe(`version https://git-lfs.github.com/spec/v1\noid sha256:${hash}\nsize 4\n`);
    expect(repo.lfs.get(hash)).toEqual(bytes);
    const b = await dev('b');
    await b.sync.sync();
    expect(await b.sync.ensureBookFile('b1')).toBe(true);
    expect(new Uint8Array(await (await b.assets.get(hash))!.arrayBuffer())).toEqual(bytes);
  });
});

describe('status (R10)', () => {
  it('shows off, syncing, synced, offline and a warning after a day unsynced', async () => {
    let now = Date.UTC(2026, 9, 21);
    const { gh, dev } = await setup();
    const a = await dev('a', { connect: false, now: () => now });
    const phases: string[] = [];
    a.sync.onStatus.on((s) => phases.push(s.phase));
    expect(a.sync.getStatus()).toMatchObject({ phase: 'off', reason: expect.stringMatching(/Not connected/) });
    await a.settings.setSecrets({ token: 'tok', repo: 'me/gym', branch: 'main' });
    await a.sync.sync();
    expect(phases).toContain('syncing');
    expect(a.sync.getStatus().phase).toBe('synced');
    gh.networkDown = true;
    await a.draw([stroke('s', T(21))]);
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'offline', stale: false });
    now += 25 * 60 * 60 * 1000;
    await a.sync.sync();
    expect(a.sync.getStatus().stale).toBe(true);
    gh.networkDown = false;
    await a.sync.sync();
    expect(a.sync.getStatus()).toMatchObject({ phase: 'synced', stale: false, unsyncedSince: undefined });
  });

  it('pushes about 20 s after the last change in the background (R4)', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a', { timings: { pushDelayMs: 50, pullIntervalMs: 60_000, initialDelayMs: 10 } });
    a.sync.start();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 100 && repo.log().length < 2; i++) await wait(10);
    const base = repo.log().length;
    await a.draw([stroke('s', T(21))]);
    for (let i = 0; i < 100 && repo.log().length === base; i++) await wait(10);
    expect(repo.log()[0]).toBe('journal: Update main canvas, 2026-10');
    a.sync.stop();
  });
});

describe('gym mirror (G1, G7, G8)', () => {
  it('mirrors gym Markdown and referenced images for offline reading', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.sync.sync();
    await a.sync.sync(); // the mirror follows the head after this device's own push
    expect(a.mirror.commit()).toBe(repo.refs.get('main'));
    expect(await a.mirror.readText('math/linear-algebra/eigenvalues/notes.md')).toContain('# Eigenvalues');
    expect(await (await a.mirror.readBlob('math/assets/fig.svg'))!.text()).toContain('<svg');
    expect(a.mirror.list().some((e) => e.path === 'scripts/check.py')).toBe(true);
    a.mirror.setFetcher(null);
    expect(await a.mirror.readText('scripts/check.py')).toBeNull(); // not mirrored, offline
    // changes are fetched by sha only when they changed
    await repo.commitFiles({ 'math/linear-algebra/eigenvalues/notes.md': '# Eigenvalues\n\nUpdated.\n', 'AGENTS.md': null }, 'external');
    await a.sync.sync();
    expect(await a.mirror.readText('math/linear-algebra/eigenvalues/notes.md')).toContain('Updated.');
    expect(await a.mirror.readText('AGENTS.md')).toBeNull();
  });
});

describe('local first (R1)', () => {
  it('a change is on disk within 1 s, and hiding the page flushes immediately', async () => {
    const { dev } = await setup();
    const a = await dev('a', { connect: false });
    await a.draw([stroke('s1', T(21))]);
    const id = segmentDocId('main', '2026-10');
    const t0 = Date.now();
    while ((await a.db.getUpdates(id)).length === 0 && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 10));
    expect(Date.now() - t0).toBeLessThan(1000);
    // a closed tab loses nothing: pagehide writes pending updates right away
    a.canvases.model('main').transact((tx) => tx.add(stroke('s2', T(21), 0, 50)));
    const before = (await a.db.getUpdates(id)).length;
    window.dispatchEvent(new Event('pagehide'));
    await a.docs.flush();
    expect((await a.db.getUpdates(id)).length).toBeGreaterThan(before);
  });
});

describe('clippings and the rebuild', () => {
  it('rebuilds the local cache from the repository', async () => {
    const { dev } = await setup();
    const a = await dev('a');
    await a.draw([textBox('t1', T(21), 'keep me')]);
    await a.library.putClipping({ id: 'c1', slug: '2026-10-21-x', origin: 'clipboard', title: 'X', format: 'plain', added: 1, contentHash: 'h' }, { markdown: 'text', assets: [] });
    await a.sync.sync();
    await a.sync.rebuild();
    expect(await a.db.listDocIds()).toEqual([]);
    expect(await a.db.get('canvases')).toBeUndefined();
    expect(a.settings.getSecrets().token).toBe('tok');
    expect(await a.db.get('secrets')).toBeDefined();
  });

  it('refuses to rebuild while changes are not on GitHub', async () => {
    const { gh, dev } = await setup();
    const a = await dev('a');
    await a.sync.sync();
    gh.networkDown = true;
    await a.draw([stroke('s', T(21))]);
    await expect(a.sync.rebuild()).rejects.toThrow(/not on GitHub/);
  });

  it('uses clipping sources in citations', async () => {
    const { repo, dev } = await setup();
    const a = await dev('a');
    await a.library.putClipping({ id: 'c1', slug: '2026-10-21-attention', origin: 'link', url: 'https://arxiv.org/abs/1706.03762', title: 'Attention', format: 'markdown', added: 1, contentHash: 'h' }, { markdown: '# A', assets: [] });
    await a.draw([clip('k1', T(21), clippingSource('c1', 'Attention'), 'weights')]);
    await a.sync.sync();
    expect(text(repo.files().get('journal/main/2026-10/days/2026-10-21.md'))).toContain('> — [Attention](../../../../library/clippings/2026-10-21-attention/clipping.md)');
  });
});
