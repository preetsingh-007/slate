import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('across a month boundary (W1)', () => {
    afterEach(() => vi.useRealTimers());
    const OCT31 = new Date(2026, 9, 31, 23, 59, 30).getTime();
    const NOV1 = new Date(2026, 10, 1, 0, 0, 30).getTime();
    const settle = async (until: () => boolean) => {
      for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setImmediate(r));
    };

    it('W1: loads the new month at midnight while the app stays open', async () => {
      const services = await createServices(`ctl-test-${Math.random()}`);
      let now = OCT31;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const ctl = new CanvasController(services, 'main', () => now);
      await ctl.loadForView(null);
      expect(ctl.model.loadedMonths()).toEqual(['2026-10']);
      now = NOV1;
      vi.advanceTimersByTime(31_000);
      await settle(() => ctl.model.isLoaded('2026-11'));
      expect(ctl.model.isLoaded('2026-11')).toBe(true);
      ctl.dispose();
    });

    it('W1: loads the new month when the app comes back to the foreground', async () => {
      const services = await createServices(`ctl-test-${Math.random()}`);
      let now = OCT31;
      const ctl = new CanvasController(services, 'main', () => now);
      await ctl.loadForView(null);
      now = NOV1;
      document.dispatchEvent(new Event('visibilitychange'));
      await settle(() => ctl.model.isLoaded('2026-11'));
      expect(ctl.model.isLoaded('2026-11')).toBe(true);
      ctl.dispose();
    });

    it('W1: a stroke drawn after midnight before the month loads is kept, with its day line, as one undo step', async () => {
      const services = await createServices(`ctl-test-${Math.random()}`);
      let now = OCT31;
      const ctl = new CanvasController(services, 'main', () => now);
      await ctl.loadForView(null);
      ctl.addObjects([stroke(100, OCT31)]);
      now = NOV1;
      const late = stroke(400, NOV1);
      expect(() => ctl.addObjects([late])).not.toThrow();
      expect(ctl.get(late.id)).toBeDefined();
      await settle(() => ctl.model.isLoaded('2026-11') && !ctl.model.hasQueued());
      expect(ctl.model.monthOf(late.id)).toBe('2026-11');
      const doc = await services.docs.open('seg:main:2026-11');
      expect(doc.getMap('objects').has(late.id)).toBe(true);
      expect(ctl.model.dayLines().get('2026-11-01')).toBe(400 - 1 - 24);
      ctl.model.undo();
      expect(ctl.get(late.id)).toBeUndefined();
      expect(ctl.model.dayLines().has('2026-11-01')).toBe(false);
      expect(ctl.model.count).toBe(1);
      ctl.dispose();
    });
  });
});
