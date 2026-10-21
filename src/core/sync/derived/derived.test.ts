import { describe, expect, it } from 'vitest';
import type { BookMeta, CanvasMeta, ClippingMeta } from '../../model/types';
import { dayMarkdown, daySvg, dayTopics, segmentDays } from './days';
import { markMarkdown, markPngSize, markSvg } from './marks';
import { parseQueue, parseTodos, queueMarkdown, todosMarkdown, uncheckedTasks } from './lists';
import { annotationsMarkdown, clippingMarkdown, libraryReadme, parseClippingMarkdown } from './library';
import { journalReadme } from './journalReadme';
import { findLinks, neutralizeLinks, pathExists } from './links';
import { frontMatter, parseFrontMatter, yamlScalar } from './frontmatter';
import { dayOf, type DerivedEnv, type SegmentContent } from './segment';
import { bookSource, clip, clippingSource, image, mark, stroke, text } from '../testing/fixtures';
import { decodePng, stubRasterizer } from '../testing/stubRasterizer';

const T = (d: number, h = 10) => new Date(2026, 9, d, h).getTime();

const book: BookMeta = { id: 'b1', slug: 'sicp', format: 'pdf', title: 'Structure and Interpretation', authors: ['Abelson', 'Sussman'], citation: '', fileHash: 'f', fileName: 'sicp.pdf', size: 1, added: T(1) };
const clipping: ClippingMeta = { id: 'c1', slug: '2026-10-21-attention', origin: 'link', title: 'Attention Is All You Need', format: 'markdown', url: 'https://arxiv.org/abs/1706.03762', site: 'arXiv', added: T(21), contentHash: 'h' };
const canvas: CanvasMeta = { id: 'main', slug: 'main', title: 'Main', topics: ['math/linear-algebra/eigenvalues'] };

function env(files: string[]): DerivedEnv {
  const exists = pathExists(files);
  return { exists, book: (id) => (id === 'b1' ? book : undefined), clipping: (id) => (id === 'c1' ? clipping : undefined), canvas: (s) => (s === 'main' ? canvas : undefined) };
}

const HASH = 'a'.repeat(64);
const files = ['library/books/sicp/book.json', 'library/clippings/2026-10-21-attention/clipping.md', `journal/main/2026-10/assets/${HASH}.png`];

function segment(): SegmentContent {
  const objects = [
    stroke('s1', T(21), 10, 400),
    text('t2', T(21, 11), 'Second box\n\n- [ ] read chapter 5\n- [x] done', 0, 200),
    text('t1', T(21, 9), 'Eigen *values* $\\lambda$', 0, 0),
    image('i1', T(21), HASH, 400, 0),
    clip('c1', T(21), bookSource('b1', 'SICP', 12), 'A procedure is…\nsecond line', 0, 600, HASH),
    clip('c2', T(21), clippingSource('c1', 'Attention'), 'Attention weights', 0, 800),
    clip('c3', T(21), bookSource('gone', 'Deleted book', 3), 'orphan', 0, 900),
    text('t3', T(22), 'Next day [broken](nowhere.md) and [ok](../../canvas.json)', 0, 1000),
    { ...stroke('s2', T(21), 0, 0), beautifiedInto: 'x' },
  ];
  objects[2].topics = ['cs/sicp/procedures'];
  return {
    slug: 'main',
    month: '2026-10',
    objects,
    marks: [mark('m1', T(21, 12), 'note', ['t1', 'c1'], { x: -10, y: -10, w: 420, h: 220 }, { topic: 'math/linear-algebra/eigenvalues', comment: 'check: proof # later\nsecond line' }), mark('m2', T(22), 'solution', ['t3'], undefined, { problem: 'math/x/problems/001-a.md' })],
    dayTopics: new Map([['2026-10-21', ['math/analysis/limits']]]),
  };
}

describe('day files (G5)', () => {
  it('lists the days with objects or marks', () => {
    expect(segmentDays(segment())).toEqual(['2026-10-21', '2026-10-22']);
  });

  it('writes front matter, the SVG link, objects in reading order, citations and marks', () => {
    const md = dayMarkdown(segment(), '2026-10-21', canvas.topics, env(files));
    expect(md).toBe(
      [
        '---',
        'canvas: main',
        'date: 2026-10-21',
        'topics: [cs/sicp/procedures, math/analysis/limits, math/linear-algebra/eigenvalues]',
        '---',
        '',
        '![Main, 2026-10-21](2026-10-21.svg)',
        '',
        'Eigen *values* $\\lambda$',
        '',
        `![Board photo](../assets/${HASH}.png)`,
        '',
        'Second box\n\n- [ ] read chapter 5\n- [x] done',
        '',
        `![Clip: SICP](../assets/${HASH}.png)`,
        '',
        '> A procedure is…\n> second line\n>\n> — [Structure and Interpretation, p. 12](../../../../library/books/sicp/)',
        '',
        '> Attention weights\n>\n> — [Attention Is All You Need](../../../../library/clippings/2026-10-21-attention/clipping.md)',
        '',
        '> orphan\n>\n> — Deleted book, p. 3 (source deleted)',
        '',
        '## Marks',
        '',
        '- [m1](../marks/m1.md) · note · math/linear-algebra/eigenvalues',
        '',
      ].join('\n'),
    );
  });

  it('uses the day\'s tags and the canvas topics as the front matter topics (G2)', () => {
    expect(dayTopics(segment(), '2026-10-22', [])).toEqual([]);
    expect(dayTopics(segment(), '2026-10-21', ['a/b'])).toContain('a/b');
  });

  it('renders the day\'s objects to SVG with relative asset links', () => {
    const svg = daySvg(segment(), '2026-10-21');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`href="../assets/${HASH}.png"`);
    expect(svg.match(/<path /g)!.length).toBe(1); // s1 only: s2 is replaced by a shape
    expect(svg).not.toContain('Next day');
  });

  it('marks an image that is not in the repository instead of linking to it', () => {
    const md = dayMarkdown(segment(), '2026-10-21', [], env([]));
    expect(md).toContain('*Board photo (image not synced)*');
    expect(md).not.toContain('../assets/');
  });

  it('keeps day files inside the segment month for devices in other time zones', () => {
    expect(dayOf(new Date(2026, 9, 31, 23).getTime(), '2026-10')).toBe('2026-10-31');
    expect(dayOf(new Date(2026, 10, 1, 1).getTime(), '2026-10')).toBe('2026-10-31');
    expect(dayOf(new Date(2026, 8, 30, 23).getTime(), '2026-10')).toBe('2026-10-01');
  });
});

describe('mark files (G5)', () => {
  it('writes front matter on one line per field and the mark\'s text and clips', () => {
    const seg = segment();
    const m1 = seg.marks[0];
    const objs = seg.objects.filter((o) => m1.objects.includes(o.id)).map((object) => ({ object, seg }));
    const md = markMarkdown(seg, m1, objs, env(files));
    const { fields, body } = parseFrontMatter(md);
    expect(fields).toEqual({
      id: 'm1',
      kind: 'note',
      topic: 'math/linear-algebra/eigenvalues',
      problem: '',
      comment: 'check: proof # later second line',
      created: new Date(T(21, 12)).toISOString().replace('.000Z', 'Z'),
      day: '../days/2026-10-21.md',
    });
    expect(md.split('---')[1].split('\n').filter(Boolean)).toHaveLength(7);
    expect(body).toBe(['![Mark m1](m1.png)', '', 'Eigen *values* $\\lambda$', '', '> A procedure is…\n> second line\n>\n> — [Structure and Interpretation, p. 12](../../../../library/books/sicp/)', ''].join('\n'));
  });

  it('renders the marked region at twice the 100% zoom resolution', async () => {
    const seg = segment();
    const m1 = seg.marks[0];
    const svg = markSvg(m1, seg.objects, () => 'data:image/png;base64,AAAA');
    expect(svg).toContain('viewBox="-10 -10 420 220"');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    const size = markPngSize(m1.region);
    expect(size).toEqual({ w: 840, h: 440 });
    const png = decodePng(await stubRasterizer(svg, size.w, size.h));
    expect([png.width, png.height]).toEqual([840, 440]);
    expect(markPngSize({ x: 0, y: 0, w: 10000, h: 100 })).toEqual({ w: 8192, h: 82 });
    const big = markPngSize({ x: 0, y: 0, w: 4000, h: 4000 });
    expect(big.w * big.h).toBeLessThanOrEqual(16_000_000);
  });
});

describe('queue.md and todos.md (G5, G4)', () => {
  it('lists marks oldest first in the exact line format, carrying over other lines', () => {
    const md = queueMarkdown(
      [
        { id: 'm2', kind: 'solution', topic: '', created: T(22), path: 'journal/main/2026-10/marks/m2.md', date: '2026-10-22' },
        { id: 'm1', kind: 'note', topic: 'math/a/b', created: T(21), path: 'journal/main/2026-10/marks/m1.md', date: '2026-10-21' },
      ],
      [{ id: 'old', path: 'journal/main/2026-09/marks/old.md', date: '2026-09-30', line: '- [old](main/2026-09/marks/old.md) · question · no topic · 2026-09-30' }],
    );
    expect(md).toBe(
      [
        '# Queue',
        '',
        '- [old](main/2026-09/marks/old.md) · question · no topic · 2026-09-30',
        '- [m1](main/2026-10/marks/m1.md) · note · math/a/b · 2026-10-21',
        '- [m2](main/2026-10/marks/m2.md) · solution · no topic · 2026-10-22',
        '',
      ].join('\n'),
    );
    expect(parseQueue(md).map((l) => [l.id, l.path])).toEqual([
      ['old', 'journal/main/2026-09/marks/old.md'],
      ['m1', 'journal/main/2026-10/marks/m1.md'],
      ['m2', 'journal/main/2026-10/marks/m2.md'],
    ]);
    expect(queueMarkdown([])).toBe('# Queue\n');
  });

  it('writes the checklist and the canvas to-dos with links to their day files', () => {
    expect(uncheckedTasks('- [ ] a\n- [x] b\n```\n- [ ] in code\n```\n  * [ ] c')).toEqual(['a', 'c']);
    const md = todosMarkdown(
      ['buy chalk', 'email TA'],
      [
        { text: 'read chapter 5', date: '2026-10-21', dayPath: 'journal/main/2026-10/days/2026-10-21.md', y: 200, x: 0 },
        { text: 'later one', date: '2026-10-22', dayPath: 'journal/main/2026-10/days/2026-10-22.md', y: 0, x: 0 },
      ],
      [{ date: '2026-09-02', dayPath: 'journal/main/2026-09/days/2026-09-02.md', line: '- [ ] old · [2026-09-02](main/2026-09/days/2026-09-02.md)' }],
    );
    expect(md).toBe(
      [
        '# To-dos',
        '',
        '## Checklist',
        '',
        '- [ ] buy chalk',
        '- [ ] email TA',
        '',
        '## From the canvas',
        '',
        '- [ ] later one · [2026-10-22](main/2026-10/days/2026-10-22.md)',
        '- [ ] read chapter 5 · [2026-10-21](main/2026-10/days/2026-10-21.md)',
        '- [ ] old · [2026-09-02](main/2026-09/days/2026-09-02.md)',
        '',
      ].join('\n'),
    );
    expect(parseTodos(md).map((l) => l.dayPath)).toEqual(['journal/main/2026-10/days/2026-10-22.md', 'journal/main/2026-10/days/2026-10-21.md', 'journal/main/2026-09/days/2026-09-02.md']);
  });
});

describe('READMEs, annotations and clippings', () => {
  it('lists canvases and library items with valid relative links', () => {
    const j = journalReadme([{ meta: canvas, months: ['2026-09', '2026-10'] }], false);
    expect(j).toContain('| [main](main/canvas.json) | Main | 2026-09, 2026-10 |');
    expect(j).toContain('- [queue.md](queue.md)');
    expect(j).toContain('`formalized.md`');
    const l = libraryReadme([book], [clipping]);
    expect(l).toContain('| [Structure and Interpretation](books/sicp/book.json) | Abelson, Sussman | PDF |');
    expect(l).toContain('[Attention Is All You Need](clippings/2026-10-21-attention/clipping.md) | [arXiv](https://arxiv.org/abs/1706.03762)');
  });

  it('groups a book\'s annotations by page', () => {
    const md = annotationsMarkdown(book, [
      { id: 'a2', kind: 'note', locator: { type: 'pdf', page: 10, region: { x: 0, y: 0.5, w: 0, h: 0 }, quote: '' }, color: '#fff', text: 'see 3.2', created: 2 },
      { id: 'a1', kind: 'highlight', locator: { type: 'pdf', page: 2, region: { x: 0, y: 0.1, w: 0, h: 0 }, quote: '' }, color: '#ff0', text: 'Lisp', created: 1 },
      { id: 'a3', kind: 'ink', locator: { type: 'pdf', page: 10, region: { x: 0, y: 0.2, w: 0, h: 0 }, quote: '' }, color: '#000', strokes: [{ pts: [], color: '#000', size: 1, tool: 'pen' }], created: 3 },
    ]);
    expect(md).toBe(['# Annotations: Structure and Interpretation', '', '## Page 2', '', '- Highlight: “Lisp”', '', '## Page 10', '', '- Ink (1 stroke)', '- Note: see 3.2', ''].join('\n'));
  });

  it('round-trips clipping.md', () => {
    const md = clippingMarkdown(clipping, '# Attention\n\nText with $x$.');
    expect(md.startsWith('---\ntitle: Attention Is All You Need\norigin: link\nsource: https://arxiv.org/abs/1706.03762\nadded: ')).toBe(true);
    expect(parseClippingMarkdown(md)).toBe('# Attention\n\nText with $x$.');
  });
});

describe('links and front matter (G9)', () => {
  it('finds links like check.py, ignoring code', () => {
    const md = '[a](x.md) `[b](y.md)`\n```\n[c](z.md)\n```\n![i](img.png "t") [u](https://e.com) [h](#top)';
    expect(findLinks(md).map((l) => l.target)).toEqual(['x.md', 'img.png', 'https://e.com', '#top']);
  });

  it('escapes broken relative links and keeps valid ones', () => {
    const exists = pathExists(['journal/main/canvas.json', 'journal/main/2026-10/days/2026-10-22.md']);
    const file = 'journal/main/2026-10/days/2026-10-22.md';
    const md = '[broken](nowhere.md) [ok](../../canvas.json) [up](../../../../../etc) [web](https://x.y/z) `[code](no.md)` [self](2026-10-22.md#x)';
    expect(neutralizeLinks(md, file, exists)).toBe('[broken]\\(nowhere.md) [ok](../../canvas.json) [up]\\(../../../../../etc) [web](https://x.y/z) `[code](no.md)` [self](2026-10-22.md#x)');
    expect(findLinks(neutralizeLinks(md, file, exists)).map((l) => l.target)).toEqual(['../../canvas.json', 'https://x.y/z', '2026-10-22.md#x']);
  });

  it('writes one-line YAML values that parse back', () => {
    expect(yamlScalar('math/a/b')).toBe('math/a/b');
    expect(yamlScalar('2026-10-21T10:00:00Z')).toBe('2026-10-21T10:00:00Z');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(yamlScalar('42')).toBe('"42"');
    expect(yamlScalar('line\nbreak')).toBe('line break');
    const fm = frontMatter([
      ['a', ''],
      ['b', ['x/y', 'p, q']],
      ['c', '"quoted"'],
    ]);
    expect(fm).toBe('---\na:\nb: [x/y, "p, q"]\nc: "\\"quoted\\""\n---\n');
    expect(parseFrontMatter(fm + 'body').fields).toEqual({ a: '', b: '[x/y, "p, q"]', c: '"quoted"' });
  });
});
