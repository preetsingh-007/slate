/**
 * G9: everything the app writes passes gym's `scripts/check.py`. This test builds a realistic
 * repository with the sync engine against the in-memory GitHub (two devices; canvases with
 * strokes, text with to-dos, images, clips from a book, a clipping and a gym file, marks of every
 * kind, a formalized mark, settings, books with annotations, clippings with assets, a deleted
 * book), checks the invariants it can check here, and, when $SLATE_GYM_OUT is set, writes the
 * repository there with a minimal gym skeleton so `scripts/gym-compat.mjs` (npm run test:gym)
 * runs the real checker on it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from './git/fakeGitHub';
import { device, text } from './testing/device';
import { useNodeBlob } from './testing/nodeBlob';
import { PNG_1X1, bookSource, clip, clippingSource, image, mark, shape, stroke, text as textBox } from './testing/fixtures';
import { checklistText } from '../stores/todo';
import { TODO_DOC_ID, annotationsDocId } from '../stores/docIds';
import type { BookMeta, ClippingMeta, SourceLink } from '../model/types';
import { findLinks, isExternal, linkPath, pathExists } from './derived/links';
import { parseFrontMatter } from './derived/frontmatter';
import { isWritablePath } from './scope';
import { sha256Hex } from '../util/ids';

beforeAll(useNodeBlob);

const T = (month: number, d: number, h = 10) => new Date(2026, month - 1, d, h).getTime();

const SKELETON = {
  'README.md': '# gym\n\nNotes, problems, and implementations from self-study.\n\n## Domains\n\nNone yet.\n',
};

const gymSource = (path: string): SourceLink => ({
  type: 'gym',
  id: path,
  title: 'gym README',
  locator: { type: 'gym', path, commit: 'abc', quote: { exact: 'gym', prefix: '', suffix: '' } },
  capturedAt: 0,
  contentHash: 'h',
});

async function buildRepository() {
  const gh = new FakeGitHub();
  const repo = await gh.createRepo('me/gym', { tokens: ['tok'], files: SKELETON });
  const a = await device(gh, 'ipad');

  // library: two books (one deleted later), a link clipping with assets, a clipboard clipping
  const book: BookMeta = { id: 'b1', slug: 'linear-algebra-done-right', format: 'pdf', title: 'Linear Algebra Done Right', authors: ['Sheldon Axler'], year: 2024, edition: '4th', citation: 'Axler, Linear Algebra Done Right, 4th ed.', fileHash: 'e'.repeat(64), fileName: 'ladr.pdf', size: 1000, pages: 400, added: T(10, 1) };
  const gone: BookMeta = { ...book, id: 'b2', slug: 'old-notes', title: 'Old notes', fileHash: 'd'.repeat(64) };
  await a.library.putBook(book);
  await a.library.putBook(gone);
  const ann = await a.docs.open(annotationsDocId('b1'));
  ann.getMap('annotations').set('h1', { id: 'h1', kind: 'highlight', locator: { type: 'pdf', page: 132, region: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 }, quote: 'eigenvalue' }, color: '#f5d742', text: 'An eigenvalue of T is…', created: T(10, 2) });
  ann.getMap('annotations').set('n1', { id: 'n1', kind: 'note', locator: { type: 'pdf', page: 133, region: { x: 0, y: 0.5, w: 0.1, h: 0.1 }, quote: '' }, color: '#2f6fde', text: 'Compare with [5A](notes.md) and $Tv = \\lambda v$', created: T(10, 3) });

  const fig = PNG_1X1;
  const figHash = await sha256Hex(fig);
  await a.assets.putWithHash(figHash, new Blob([fig], { type: 'image/png' }));
  const css = new TextEncoder().encode('body{font:16px serif}');
  const cssHash = await sha256Hex(css);
  await a.assets.putWithHash(cssHash, new Blob([css], { type: 'text/css' }));
  const article: ClippingMeta = { id: 'c1', slug: '2026-10-21-attention-is-all-you-need', origin: 'link', title: 'Attention Is All You Need', format: 'markdown', url: 'https://arxiv.org/abs/1706.03762', site: 'arXiv', author: 'Vaswani et al.', fetched: T(10, 21), added: T(10, 21), contentHash: 'h1' };
  await a.library.putClipping(article, {
    markdown: `# Attention Is All You Need\n\n![Figure 1](assets/${figHash}.png)\n\nSee [the code](/code) and [section 3](#model). $\\mathrm{softmax}(QK^T)$\n\n\`\`\`\n[not a link](x.md)\n\`\`\``,
    snapshotHtml: `<html><head><link rel="stylesheet" href="assets/${cssHash}.css"></head><body><img src="assets/${figHash}.png"></body></html>`,
    assets: [
      { path: `assets/${figHash}.png`, hash: figHash, mime: 'image/png', url: 'https://arxiv.org/fig1.png' },
      { path: `assets/${cssHash}.css`, hash: cssHash, mime: 'text/css' },
    ],
  });
  const chat: ClippingMeta = { id: 'c2', slug: '2026-10-22-spectral-theorem-chat', origin: 'clipboard', title: 'Spectral theorem (chat)', format: 'markdown', sourceLabel: 'Claude', added: T(10, 22), contentHash: 'h2' };
  await a.library.putClipping(chat, { markdown: 'The spectral theorem says [see](../../journal/README.md) …', assets: [] });

  // settings
  await a.settings.update({ colors: ['#7a3cff'], readingPositions: { b1: { sourceId: 'b1', locator: { type: 'pdf', page: 132, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }, updated: T(10, 21), device: 'ipad' } } });

  // canvases: main (September and October) and a second canvas
  const photo = new Uint8Array([...PNG_1X1, 0]); // a different image
  const photoHash = await a.assets.put(new Blob([photo], { type: 'image/png' }));
  await a.draw(
    [
      textBox('sept', T(9, 30, 9), '# Week 5\n\n- [ ] finish problem set 4\n- [x] read 5A'),
      stroke('s-sep', T(9, 30), 0, 200),
    ],
    [mark('mq', T(9, 30, 12), 'question', ['s-sep'], { x: -5, y: 195, w: 60, h: 40 }, { comment: 'Why: is this "true"?' })],
  );
  await a.draw(
    [
      textBox('t1', T(10, 21, 9), 'Eigenvalues: $Tv = \\lambda v$\n\n- [ ] prove 5.6 [hint](hint.md)\n- [ ] ask in office hours', 0, 1000),
      stroke('s1', T(10, 21), 0, 1100),
      stroke('h1', T(10, 21), 10, 1100, '#f5d742'),
      shape('sh1', T(10, 21), 300, 1100),
      image('img', T(10, 21), photoHash, 400, 1000),
      clip('k1', T(10, 21), bookSource('b1', 'Linear Algebra Done Right', 132), 'An **eigenvalue** of $T$ is…', 0, 1300, figHash),
      clip('k2', T(10, 21), clippingSource('c1', 'Attention'), 'Attention(Q, K, V) = softmax(QK^T)V', 0, 1500),
      clip('k3', T(10, 21), bookSource('b2', 'Old notes', 2), 'from a book deleted later', 0, 1700),
      clip('k4', T(10, 22), gymSource('README.md'), 'gym', 0, 1900),
      clip('k5', T(10, 22), clippingSource('c2', 'Spectral theorem (chat)'), 'A normal operator…', 0, 2100),
      textBox('t2', T(10, 23), 'Proof attempt\n\n```\n[x](y)\n', 0, 2300),
    ],
    [
      mark('m-note', T(10, 21, 11), 'note', ['t1', 'k1'], { x: -10, y: 990, w: 700, h: 500 }, { topic: 'math/linear-algebra/eigenvalues' }),
      mark('m-problem', T(10, 21, 12), 'problem', ['t1'], { x: -10, y: 990, w: 320, h: 80 }, { topic: 'math/linear-algebra/eigenvalues', comment: 'from lecture' }),
      mark('m-solution', T(10, 23, 15), 'solution', ['t2'], { x: -10, y: 2290, w: 320, h: 80 }, { topic: 'math/linear-algebra/eigenvalues', problem: 'math/linear-algebra/eigenvalues/problems/001-x.md' }),
      mark('m-cross', T(10, 22, 9), 'question', ['sept', 't1'], { x: -10, y: -10, w: 400, h: 1100 }),
    ],
  );
  await a.canvases.create('Physics lectures', 'physics');
  await a.canvases.update('physics', { topics: ['physics/mechanics/kinematics'] });
  await a.draw([textBox('p1', T(10, 20), 'Kinematics\n\n- [ ] derive $v^2 = u^2 + 2as$')], [mark('p-note', T(10, 20, 11), 'note', ['p1'])], 'physics');
  a.canvases.model('main').transact((tx) => tx.setDayTopics('2026-10-21', ['math/linear-algebra/eigenvalues']));
  checklistText(await a.docs.open(TODO_DOC_ID)).insert(0, '- [ ] buy chalk\n- [x] email TA\n- [ ] read [chapter 6](ch6.md)\n');
  await a.sync.sync();

  // gym formalizes one mark (its target must exist in gym)
  await repo.commitFiles({ 'journal/formalized.md': '# Formalized\n\n- m-problem → ../README.md#domains · 2026-10-24\n- mq → dismissed · 2026-10-24\n' }, 'external: journal: Formalize m-problem');

  // a second device that has only some segments, edits and syncs
  const b = await device(gh, 'mac');
  await b.sync.sync();
  await b.draw([textBox('b-oct', T(10, 24), 'From the Mac\n\n- [ ] check sign', 0, 2600)], [mark('m-mac', T(10, 24, 10), 'note', ['b-oct'], { x: -10, y: 2590, w: 320, h: 80 })]);
  await b.sync.sync();
  await a.sync.sync();

  // the first device deletes a book that a clip cites
  await a.library.deleteBook('b2');
  await a.sync.sync();
  await b.sync.sync();

  for (const d of [a, b]) expect(d.sync.getStatus(), d.name).toMatchObject({ phase: 'synced' });
  // derived files are stable: devices with different segments do not rewrite each other's output
  const commits = repo.log().length;
  await a.sync.sync();
  await b.sync.sync();
  await a.sync.sync();
  expect(repo.log().length).toBe(commits);
  await a.close();
  await b.close();
  return repo;
}

describe('gym compatibility (G9)', () => {
  it('writes a repository gym\'s check.py accepts', async () => {
    const repo = await buildRepository();
    const files = repo.files();
    const paths = [...files.keys()];
    const exists = pathExists(paths);

    // every app commit writes only journal/ and library/ (R5)
    for (const c of repo.commitPaths()) if (!c.message.startsWith('external') && c.message !== 'Initial commit') for (const p of c.paths) expect(isWritablePath(p), p).toBe(true);
    // commit messages use the journal and library scopes (R8)
    for (const m of repo.log()) if (!m.startsWith('external') && m !== 'Initial commit') expect(m).toMatch(/^(journal|library): [A-Z].{1,80}$/);

    // every relative link in every Markdown file resolves (what check.py's link check does)
    for (const p of paths.filter((x) => x.endsWith('.md'))) {
      for (const l of findLinks(text(files.get(p))!)) {
        if (isExternal(l.target)) continue;
        const target = linkPath(p, l.target);
        expect(target !== null && exists(target), `${p} → ${l.target}`).toBe(true);
      }
    }
    // front matter of day and mark files, on one line per field
    for (const p of paths) {
      const md = /\/(days|marks)\/[^/]+\.md$/.exec(p);
      if (!md) continue;
      const { fields } = parseFrontMatter(text(files.get(p))!);
      const need = md[1] === 'days' ? ['canvas', 'date', 'topics'] : ['id', 'kind', 'topic', 'problem', 'comment', 'created', 'day'];
      for (const k of need) expect(k in fields, `${p}: ${k}`).toBe(true);
      if (md[1] === 'marks') expect(exists(linkPath(p, fields.day)!), `${p} day`).toBe(true);
    }
    expect(text(files.get('journal/queue.md'))).not.toContain('m-problem');
    expect(text(files.get('journal/queue.md'))).toContain('[m-mac]');
    expect(paths.some((p) => p.startsWith('library/books/old-notes/'))).toBe(false);

    const out = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SLATE_GYM_OUT;
    if (out) {
      const fsName = 'node:fs';
      const pathName = 'node:path';
      const fs = (await import(/* @vite-ignore */ fsName)) as {
        mkdirSync(p: string, o: { recursive: boolean }): void;
        writeFileSync(p: string, b: Uint8Array): void;
        copyFileSync(a: string, b: string): void;
      };
      const path = (await import(/* @vite-ignore */ pathName)) as { join(...p: string[]): string; dirname(p: string): string; resolve(p: string): string };
      const write = (dir: string, tree: Map<string, Uint8Array>) => {
        for (const [p, bytes] of tree) {
          const dest = path.join(dir, p);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, bytes);
        }
        fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
        fs.copyFileSync(path.resolve('tests/gym/check.py'), path.join(dir, 'scripts', 'check.py'));
      };
      write(out, files);
      // G9: gym's CI must pass on every app commit, not only the last one
      const appCommits = repo.history().filter((c) => c.message !== 'Initial commit' && !c.message.startsWith('external'));
      appCommits.reverse().forEach((c, i) => write(path.join(`${out}-commits`, `${String(i + 1).padStart(2, '0')}-${c.message.split(':')[0]}`), repo.filesAt(c.sha)));
    }
  }, 60_000);
});
