import { describe, expect, it } from 'vitest';
import { createServices } from '../../app/services';
import { makeImage, makeShape, makeStroke } from '../../core/canvas/objects';
import { CanvasController } from './controller';

const NOW = new Date(2026, 9, 21, 10).getTime();
const YESTERDAY = NOW - 86_400_000;

let n = 0;
const ctx = (created = NOW) => ({ id: `o${++n}`, now: created, device: 'd', z: `m${n}` });
const stroke = (y: number, created = NOW, attached?: string) => makeStroke(ctx(created), { pts: [0, y, 0.5, 100, y + 10, 0.5], tool: 'pen', color: '#000000', size: 2, attached });

async function open() {
  const services = await createServices(`ctl-test-${Math.random()}`);
  const ctl = new CanvasController(services, 'main', () => NOW);
  await ctl.loadForView(null);
  return ctl;
}

describe('CanvasController', () => {
  it('creates today’s line 24 units above the first of today’s objects below all content, in the same undo step (C19)', async () => {
    const ctl = await open();
    ctl.addObjects([stroke(100, YESTERDAY)]);
    expect(ctl.model.dayLines().size).toBe(0); // not made today
    ctl.addObjects([stroke(50)]); // today, but above the content
    expect(ctl.model.dayLines().size).toBe(0);
    ctl.addObjects([stroke(300)]); // today, below everything
    expect(ctl.model.dayLines().get('2026-10-21')).toBe(300 - 1 - 24);
    ctl.addObjects([stroke(600)]);
    expect([...ctl.model.dayLines().values()]).toEqual([275]);
    ctl.model.undo();
    ctl.model.undo();
    expect(ctl.model.dayLines().size).toBe(0);
  });

  it('deleting an image deletes the ink drawn on it; deleting a shape deletes the strokes it replaced (C8, C16)', async () => {
    const ctl = await open();
    const img = makeImage(ctx(), { asset: 'h', mime: 'image/png', natural: { w: 10, h: 10 }, x: 0, y: 0, w: 100, h: 100 });
    const ink = stroke(10, NOW, img.id);
    const other = stroke(500);
    const hidden = { ...stroke(800), beautifiedInto: 'x' };
    const shape = makeShape(ctx(), { geometry: { kind: 'line', a: { x: 0, y: 800 }, b: { x: 100, y: 810 } }, color: '#000000', lineWidth: 2, originals: [hidden.id] });
    ctl.addObjects([img, ink, other, hidden, shape]);
    expect(ctl.attachedTo(img.id).map((s) => s.id)).toEqual([ink.id]);
    ctl.remove([img.id, shape.id]);
    expect([...ctl.model.objects()].map((o) => o.id)).toEqual([other.id]);
    ctl.model.undo();
    expect(ctl.model.count).toBe(5);
  });

  it('knows content in months that are not loaded (R3, C20)', async () => {
    const ctl = await open();
    await ctl.services.canvases.update('main', { segments: { '2026-08': { x: 0, y: 4000, w: 100, h: 500 } } });
    ctl.addObjects([stroke(100)]);
    expect(ctl.contentBottom()).toBe(4500);
    expect(ctl.allContentBounds()!.h).toBeGreaterThan(4000);
  });
});
