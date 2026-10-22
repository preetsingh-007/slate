import { describe, expect, it } from 'vitest';
import { beautifyShapes } from './beautify';
import { clusterStrokes } from './cluster';
import { geometryBBox, geometryToSvg } from './shapes';
import { sanitizeSvgFragment } from './svgsafe';
import { arc, arrowHeadV, densify, jitter, mulberry32, rectPath, toStroke, word } from './testing/synth';

function scene() {
  const rng = mulberry32(42);
  const rectA = toStroke(jitter(rectPath(100, 100, 200, 100), 2, rng), { id: 'rectA' });
  const rectB = toStroke(jitter(rectPath(460, 106, 200, 92), 2, rng), { id: 'rectB' });
  const shaft = toStroke(jitter(densify([{ x: 312, y: 152 }, { x: 440, y: 156 }]), 1.5, rng), { id: 'shaft' });
  const head = toStroke(arrowHeadV({ x: 312, y: 152 }, { x: 442, y: 155 }, 22), { id: 'head' });
  const circle = toStroke(jitter(arc(820, 160, 60, 58, 0.3, Math.PI * 2.06), 2, rng), { id: 'circle', color: '#e5484d' });
  const text = word('lasso', 100, 420, 30, rng);
  return { rectA, rectB, shaft, head, circle, text, all: [rectA, rectB, shaft, head, circle, ...text] };
}

describe('clusterStrokes', () => {
  it('separates shapes from writing; the "o" of a word stays a letter', () => {
    const s = scene();
    const r = clusterStrokes(s.all);
    expect(r.shapes.map((c) => c.recognition.kind).sort()).toEqual(['arrow', 'circle', 'rectangle', 'rectangle']);
    expect(r.shapes.find((c) => c.recognition.kind === 'arrow')!.strokes.map((x) => x.id).sort()).toEqual(['head', 'shaft']);
    expect(r.writing).toHaveLength(1);
    expect(r.writing[0].strokes).toHaveLength(5);
  });

  it('a lone small circle is still a shape', () => {
    const c = toStroke(arc(100, 100, 18, 18, 0, Math.PI * 2.05));
    expect(clusterStrokes([c]).shapes).toHaveLength(1);
  });
});

describe('beautifyShapes (C10, C16)', () => {
  it('snaps shapes, aligns neighbours, glues the arrow to both boxes and leaves writing as ink', () => {
    const s = scene();
    const res = beautifyShapes(s.all);
    expect(res.shapes.map((x) => x.shape).sort()).toEqual(['arrow', 'ellipse', 'rectangle', 'rectangle']);
    expect(res.leftover.sort()).toEqual(s.text.map((t) => t.id).sort());

    const rects = res.shapes.filter((x) => x.shape === 'rectangle');
    const [a, b] = rects.map((r) => geometryBBox(r.geometry));
    expect(a.y + a.h / 2).toBeCloseTo(b.y + b.h / 2, 0);
    expect(a.h).toBeCloseTo(b.h, 0);

    // shapes keep their ink colour
    expect(res.shapes.find((x) => x.shape === 'ellipse')!.color).toBe('#e5484d');
    expect(rects[0].color).toBe('currentInk');

    const arrow = res.shapes.find((x) => x.shape === 'arrow')!;
    if (arrow.geometry.kind !== 'arrow') throw new Error('not an arrow');
    expect(arrow.geometry.a.x).toBeGreaterThan(a.x + a.w - 8);
    expect(arrow.geometry.b.x).toBeLessThan(b.x + 8);
    const ia = res.shapes.indexOf(rects[0]);
    const ib = res.shapes.indexOf(rects[1]);
    expect(arrow.connects).toEqual([ia, ib]);
    expect(arrow.strokeIds.sort()).toEqual(['head', 'shaft']);
    expect(sanitizeSvgFragment(geometryToSvg(arrow.geometry, arrow.lineWidth))).toBe(geometryToSvg(arrow.geometry, arrow.lineWidth));
  });

  it('attaches arrows to shapes already on the canvas, which never move', () => {
    const rng = mulberry32(7);
    const shaft = toStroke(jitter(densify([{ x: 100, y: 300 }, { x: 290, y: 302 }]), 1, rng), { id: 'shaft' });
    const head = toStroke(arrowHeadV({ x: 100, y: 300 }, { x: 292, y: 302 }, 20), { id: 'head' });
    const box = { id: 'box1', geometry: { kind: 'rectangle' as const, cx: 360, cy: 300, w: 120, h: 80, rotation: 0 } };
    const res = beautifyShapes([shaft, head], { existing: [box] });
    expect(res.shapes).toHaveLength(1);
    expect(res.shapes[0].connects).toEqual([null, 'box1']);
    const g = res.shapes[0].geometry;
    if (g.kind !== 'arrow') throw new Error('not an arrow');
    expect(g.b.x).toBeCloseTo(300 - 2, 0);
    expect(box.geometry.cx).toBe(360);
  });

  it('highlighter strokes and writing are never turned into shapes', () => {
    const rng = mulberry32(3);
    const hl = toStroke(jitter(rectPath(0, 0, 200, 100), 2, rng), { id: 'hl', tool: 'highlighter' });
    const res = beautifyShapes([hl, ...word('sea', 0, 300, 30, rng)]);
    expect(res.shapes).toEqual([]);
    expect(res.leftover).toHaveLength(4);
  });
});
