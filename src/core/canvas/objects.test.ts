import { describe, expect, it } from 'vitest';
import type { CanvasObject, ClipObject, ImageObject, ShapeObject, StrokeObject, TextObject } from '../model/types';
import { densify } from '../ink/testing/synth';
import { extractUrl, looksLikeMarkdown, makePayload, parsePayload, pastedTextContent, pasteObjects, payloadFromHtml, payloadHtml, plainToMarkdown, regionMarkdown, selectionMarkdown } from './clipboard';
import { contentBottom, dayLineFor, lineForDate, previewLineY, DAY_LINE_OFFSET } from './daylines';
import { splitStroke } from './erase';
import { expandGroups, hitObject, lassoSelect, rectPolygon, topHit } from './hit';
import { gymTabPath, makeMark, markEditable, markStatus } from './marks';
import { makeClip, makeImage, makeShape, makeStroke, makeText } from './objects';
import { applyAffine, transformGeometry, transformObject, transformSelection, type ObjectLookup } from './transform';
import { renderMarkdown } from '../markdown/render';

let n = 0;
const ctx = (z = 'm') => ({ id: `o${++n}`, now: 1_000, device: 'd', z });
const flat = (pts: { x: number; y: number }[]) => pts.flatMap((p) => [p.x, p.y, 0.5]);
const line = (x0: number, y0: number, x1: number, y1: number, extra: Partial<StrokeObject> = {}): StrokeObject => ({
  ...makeStroke(ctx(), { pts: flat(densify([{ x: x0, y: y0 }, { x: x1, y: y1 }], 2)), tool: 'pen', color: '#000000', size: 2 }),
  ...extra,
});
const text = (x: number, y: number, content = 'hi'): TextObject => ({ ...makeText(ctx(), { x, y, content, w: 80 }), h: 40 });
const image = (x: number, y: number, w = 200, h = 100): ImageObject => makeImage(ctx(), { asset: 'abc', mime: 'image/png', natural: { w: 400, h: 200 }, x, y, w, h });

describe('hit testing (C14)', () => {
  it('hits strokes near their line, frames inside their (rotated) frame', () => {
    const s = line(0, 0, 100, 0);
    expect(hitObject(s, { x: 50, y: 3 }, 2)).toBe(true);
    expect(hitObject(s, { x: 50, y: 8 }, 2)).toBe(false);
    const t = { ...text(0, 0), w: 100, h: 20, rotation: 90 };
    // rotated 90° around (50, 10): now spans x 40..60, y -40..60
    expect(hitObject(t, { x: 50, y: 50 }, 0)).toBe(true);
    expect(hitObject(t, { x: 90, y: 10 }, 0)).toBe(false);
  });

  it('hits shapes on their outline or inside closed shapes', () => {
    const rect = makeShape(ctx(), { geometry: { kind: 'rectangle', cx: 100, cy: 100, w: 100, h: 60, rotation: 0 }, color: '#000000', lineWidth: 2, originals: [] });
    expect(hitObject(rect, { x: 100, y: 100 }, 2)).toBe(true);
    expect(hitObject(rect, { x: 151, y: 100 }, 2)).toBe(true);
    expect(hitObject(rect, { x: 170, y: 100 }, 2)).toBe(false);
  });

  it('a tap selects the topmost ink before text, images and clips', () => {
    const img = image(0, 0);
    const s = line(10, 50, 150, 50);
    expect(topHit([img, s], { x: 60, y: 51 }, 3)!.id).toBe(s.id);
    expect(topHit([img, s], { x: 60, y: 80 }, 3)!.id).toBe(img.id);
    expect(topHit([img, s], { x: 600, y: 80 }, 3)).toBeNull();
  });

  it('never hits strokes hidden by Beautify', () => {
    const s = line(0, 0, 100, 0, { beautifiedInto: 'shape1' });
    expect(hitObject(s, { x: 50, y: 0 }, 2)).toBe(false);
  });
});

describe('lasso selection (C14)', () => {
  const objs: CanvasObject[] = [line(10, 10, 90, 90), line(50, 50, 250, 50), text(20, 120), image(300, 300)];
  it('free-form lasso selects any mix of kinds by enclosure', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 200 },
      { x: 0, y: 200 },
    ];
    const ids = lassoSelect(objs, poly);
    expect(ids).toEqual([objs[0].id, objs[2].id]);
  });

  it('rectangle lasso', () => {
    expect(lassoSelect(objs, rectPolygon({ x: 0, y: 0, w: 600, h: 600 }))).toHaveLength(4);
    expect(lassoSelect(objs, rectPolygon({ x: 290, y: 290, w: 300, h: 300 }))).toEqual([objs[3].id]);
  });

  it('expands to whole groups', () => {
    const a = { ...line(0, 0, 10, 10), group: 'g' };
    const b = { ...line(100, 100, 110, 110), group: 'g' };
    const all = new Map([a, b].map((o) => [o.id, o]));
    expect(expandGroups([a.id], (id) => all.get(id), () => [a.id, b.id]).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('partial eraser splits strokes (C12)', () => {
  const pts = flat(densify([{ x: 0, y: 0 }, { x: 100, y: 0 }], 2));
  it('cuts a stroke where the eraser passed', () => {
    const pieces = splitStroke(pts, [{ x: 50, y: -20 }, { x: 50, y: 20 }], 5)!;
    expect(pieces).toHaveLength(2);
    const ends = pieces.map((p) => [p[0], p[p.length - 3]]);
    expect(ends[0][1]).toBeLessThan(46);
    expect(ends[1][0]).toBeGreaterThan(54);
    expect(ends[0][1]).toBeGreaterThan(43);
  });

  it('cuts precisely even between sparse points', () => {
    const sparse = [0, 0, 0.5, 100, 0, 0.5];
    const pieces = splitStroke(sparse, [{ x: 50, y: 10 }, { x: 50, y: -10 }], 4)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0][pieces[0].length - 3]).toBeGreaterThan(44);
  });

  it('returns null when untouched and nothing when erased entirely', () => {
    expect(splitStroke(pts, [{ x: 50, y: 30 }], 5)).toBeNull();
    expect(splitStroke(pts, [{ x: -10, y: 0 }, { x: 110, y: 0 }], 5)).toEqual([]);
  });

  it('erasing an end leaves one piece', () => {
    const pieces = splitStroke(pts, [{ x: 0, y: 0 }], 10)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0][0]).toBeGreaterThan(9);
  });
});

describe('selection transforms (C15, C8, C10)', () => {
  it('moves, scales and rotates strokes by their points', () => {
    const s = line(0, 0, 100, 0);
    const p = transformObject(s, { ox: 0, oy: 0, s: 2, rot: 90, dx: 10, dy: 0 });
    const pts = p.pts as number[];
    expect(pts[pts.length - 3]).toBeCloseTo(10);
    expect(pts[pts.length - 2]).toBeCloseTo(200);
    expect(p.size).toBe(4);
    expect(p.h).toBeCloseTo(200);
  });

  it('frames rotate around their centre and scale fonts', () => {
    const t = text(0, 0);
    const p = transformObject({ ...t, w: 100, h: 40 }, { ox: 0, oy: 0, s: 2, rot: 30, dx: 0, dy: 0 });
    expect(p.w).toBe(200);
    expect(p.fontSize).toBe(36);
    expect(p.rotation).toBe(30);
    const c = applyAffine({ ox: 0, oy: 0, s: 2, rot: 30, dx: 0, dy: 0 }, { x: 50, y: 20 });
    expect((p.x as number) + 100).toBeCloseTo(c.x, 0);
  });

  it('shapes transform their geometry; quarter turns swap a diamond', () => {
    const g = transformGeometry({ kind: 'diamond', cx: 0, cy: 0, w: 100, h: 50 }, { ox: 0, oy: 0, s: 1, rot: 90, dx: 0, dy: 0 });
    expect(g).toEqual({ kind: 'diamond', cx: 0, cy: 0, w: 50, h: 100 });
    const r = transformGeometry({ kind: 'rectangle', cx: 10, cy: 0, w: 100, h: 50, rotation: 0 }, { ox: 0, oy: 0, s: 1, rot: 45, dx: 0, dy: 0 });
    expect(r.kind === 'rectangle' && r.rotation).toBe(45);
  });

  it('strokes drawn on an image move with it; connected arrow ends follow shapes', () => {
    const img = image(0, 0);
    const ink = line(10, 10, 50, 50, { attached: img.id });
    const box = makeShape(ctx(), { geometry: { kind: 'rectangle', cx: 500, cy: 500, w: 100, h: 100, rotation: 0 }, color: '#000000', lineWidth: 2, originals: [] });
    const arrow: ShapeObject = makeShape(ctx(), { geometry: { kind: 'arrow', a: { x: 300, y: 500 }, b: { x: 448, y: 500 }, heads: 'end' }, color: '#000000', lineWidth: 2, originals: [], connects: [null, box.id] });
    const lookup: ObjectLookup = {
      get: () => undefined,
      attachedTo: (id) => (id === img.id ? [ink] : []),
      connectedTo: (id) => (id === box.id ? [arrow] : []),
    };
    const patches = transformSelection([img, box], { ox: 0, oy: 0, s: 1, rot: 0, dx: 100, dy: 0 }, lookup);
    expect((patches.get(ink.id)!.pts as number[])[0]).toBe(110);
    const g = patches.get(arrow.id)!.geometry as { a: { x: number }; b: { x: number } };
    expect(g.a.x).toBe(300);
    expect(g.b.x).toBe(548);
  });
});

describe('day lines (C19, C20, C21)', () => {
  const lines = new Map([['2026-10-20', 400]]);
  it('creates a line 24 units above the first object of a day below all content', () => {
    expect(dayLineFor('2026-10-21', 900, 800, lines)).toBe(900 - DAY_LINE_OFFSET);
    expect(dayLineFor('2026-10-21', 500, 800, lines)).toBeNull(); // elsewhere on the canvas
    expect(dayLineFor('2026-10-20', 900, 800, lines)).toBeNull(); // at most one per date
    expect(dayLineFor('2026-10-21', 10, null, new Map())).toBe(-14); // empty canvas
  });

  it('content bottom covers months that are not loaded', () => {
    expect(contentBottom({ x: 0, y: 0, w: 10, h: 100 }, [{ x: 0, y: 500, w: 1, h: 50 }, null])).toBe(550);
    expect(contentBottom(null, [])).toBeNull();
    expect(previewLineY(550)).toBeGreaterThan(550);
  });

  it('jumps to a day, or the closest earlier day', () => {
    const all = new Map([
      ['2026-10-01', 0],
      ['2026-10-10', 500],
    ]);
    expect(lineForDate(all, '2026-10-10')).toEqual({ date: '2026-10-10', y: 500 });
    expect(lineForDate(all, '2026-10-05')).toEqual({ date: '2026-10-01', y: 0 });
    expect(lineForDate(all, '2026-09-05')).toEqual({ date: '2026-10-01', y: 0 });
  });
});

describe('marks (G3, G6)', () => {
  it('covers the marked objects and is editable until formalized', () => {
    const m = makeMark('abc123', [text(0, 0), image(100, 100)], { kind: 'solution', topic: ' math/la/eig/ ', problem: 'math/la/eig/problems/01.md', comment: ' ok ' }, 5)!;
    expect(m.region).toEqual({ x: -8, y: -8, w: 316, h: 216 });
    expect(m.topic).toBe('math/la/eig');
    expect(m.comment).toBe('ok');
    expect(m.problem).toBe('math/la/eig/problems/01.md');
    expect(markEditable(undefined)).toBe(true);
    const rec = { id: 'abc123', dismissed: false as const, path: 'math/la/notes.md', heading: 'eigen', date: '2026-10-22' };
    expect(markEditable(rec)).toBe(false);
    expect(markStatus(rec).state).toBe('formalized');
    expect(gymTabPath(rec)).toBe('math/la/notes.md#eigen');
    expect(markStatus({ id: 'x', dismissed: true, date: '2026-10-22' }).state).toBe('dismissed');
    expect(makeMark('x', [text(0, 0)], { kind: 'note', topic: '', problem: 'p', comment: '' }, 1)!.problem).toBe('');
  });
});

describe('clipboard (C15, S9, S11)', () => {
  it('Markdown of a selection: text boxes and quoted clips in reading order', () => {
    const clip: ClipObject = makeClip(ctx(), {
      x: 0,
      y: 200,
      w: 100,
      h: 50,
      text: 'Eigen *values*\nline two',
      display: 'both',
      source: { type: 'book', id: 'b1', title: 'Axler, LADR', locator: { type: 'pdf', page: 3, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }, capturedAt: 0, contentHash: '' },
    });
    const md = selectionMarkdown([clip, text(300, 0, '## Second'), text(0, 0, '# First'), line(0, 0, 1, 1)]);
    expect(md).toBe('# First\n\n## Second\n\n> Eigen *values*\n> line two\n>\n> — Axler, LADR');
    // S2 for a canvas source: the region's own text, clips unquoted (the new clip links back)
    expect(regionMarkdown([clip, text(300, 0, '## Second'), text(0, 0, '# First'), line(0, 0, 1, 1)])).toBe('# First\n\n## Second\n\nEigen *values*\nline two');
  });

  it('round-trips objects through JSON and HTML, pasting with new ids and references', () => {
    const img = image(0, 0);
    const ink = line(10, 10, 50, 50, { attached: img.id, group: 'g1' });
    const orphan = line(0, 0, 5, 5, { attached: 'elsewhere' });
    const payload = makePayload('main', [img, ink, orphan]);
    expect(parsePayload(JSON.stringify(payload))).toEqual(payload);
    expect(payloadFromHtml(payloadHtml(payload, 'x — ü', 'data:image/png;base64,AAAA'))).toEqual(payload);
    expect(parsePayload('{"v":2}')).toBeNull();
    let i = 0;
    let z = 0;
    const out = pasteObjects(payload.objects, { x: 1000, y: 2000 }, { now: 9, device: 'd2', newId: () => `n${++i}`, nextZ: () => `z${++z}` });
    expect(out.map((o) => o.id).every((id) => id.startsWith('n'))).toBe(true);
    const pImg = out.find((o) => o.kind === 'image')!;
    const pInk = out.find((o) => o.kind === 'stroke' && o.attached) as StrokeObject;
    expect(pInk.attached).toBe(pImg.id);
    expect(pInk.group).not.toBe('g1');
    expect((out.find((o) => o !== pInk && o.kind === 'stroke') as StrokeObject).attached).toBeUndefined();
    // the payload's drawn bounds (strokes include their half width) land at the paste point
    expect(pImg.x).toBe(1001);
    expect(pImg.created).toBe(9);
    expect(pInk.pts[0]).toBe(1011);
  });

  it('pasted text: Markdown is kept, plain text is escaped so it renders literally, URLs are detected', () => {
    expect(looksLikeMarkdown('# Title\n\nSome *text*')).toBe(true);
    expect(looksLikeMarkdown('- [ ] buy milk')).toBe(true);
    expect(looksLikeMarkdown('Price: 5 * 3 = 15, see a_b')).toBe(false);
    const plain = 'Price: 5 * 3 = $15 and $20\n# not a heading\n1. not a list';
    const md = plainToMarkdown(plain);
    expect(pastedTextContent('**bold**')).toBe('**bold**');
    const html = renderMarkdown(md);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<ol');
    expect(html).not.toContain('katex');
    expect(html).toContain('5 * 3');
    expect(extractUrl('  https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(extractUrl('see https://example.com')).toBeNull();
  });
});
