/**
 * Minimap (C5, C21): an overview of the whole canvas with the current view and a marker for
 * every day line. Tap or drag on it to jump there; tap a day marker to go to that day.
 */
import { useEffect, useRef, useState } from 'react';
import type { Rect } from '../../core/model/types';
import { objectBounds, unionRect } from '../../core/canvas/bounds';
import { dayLabel } from '../../core/util/time';
import { centerOn } from '../../core/canvas/camera';
import { useCanvas, useFrame } from './context';

const W = 168;
const H = 120;

export function Minimap() {
  const { engine, ctl } = useCanvas();
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const [world, setWorld] = useState<Rect | null>(null);
  const [days, setDays] = useState<{ date: string; y: number }[]>([]);
  const worldRef = useRef<Rect | null>(null);

  // the overview of the content, redrawn when the content changes
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const render = () => {
      const b = ctl.allContentBounds();
      const v = engine.view;
      let r = b ? unionRect(b, v) : v;
      const pad = Math.max(r.w, r.h) * 0.06 + 40;
      r = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
      worldRef.current = r;
      setWorld(r);
      setDays([...ctl.model.dayLines()].map(([date, y]) => ({ date, y })));
      const c = base.current ?? (base.current = document.createElement('canvas'));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const k = Math.min(W / r.w, H / r.h);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, -r.x * dpr * k, -r.y * dpr * k);
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim() || '#626a73';
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.25;
      const loaded = new Set(ctl.model.loadedMonths());
      for (const [m, s] of Object.entries(ctl.recordedSegments())) if (s && !loaded.has(m)) ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = 0.55;
      const min = 1.2 / k;
      for (const o of ctl.model.objects()) {
        if (o.kind === 'stroke' && o.beautifiedInto) continue;
        const ob = objectBounds(o);
        ctx.fillRect(ob.x, ob.y, Math.max(min, ob.w), Math.max(min, ob.h));
      }
      draw();
    };
    render();
    const off = ctl.model.onChange.on(() => {
      clearTimeout(t);
      t = setTimeout(render, 400);
    });
    // the view left the overview: widen it
    const offSettle = engine.settled.on((v) => {
      const w = worldRef.current;
      if (!w || v.x < w.x || v.y < w.y || v.x + v.w > w.x + w.w || v.y + v.h > w.y + w.h) render();
    });
    return () => {
      off();
      offSettle();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, engine]);

  const draw = () => {
    const c = canvas.current;
    const r = worldRef.current;
    if (!c || !r) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== W * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (base.current) ctx.drawImage(base.current, 0, 0);
    const k = Math.min(W / r.w, H / r.h) * dpr;
    const v = engine.view;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6fde';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect((v.x - r.x) * k, (v.y - r.y) * k, Math.max(2, v.w * k), Math.max(2, v.h * k));
  };
  useFrame(engine, draw);

  const jump = (e: React.PointerEvent) => {
    const r = worldRef.current;
    if (!r) return;
    const box = e.currentTarget.getBoundingClientRect();
    const k = Math.min(W / r.w, H / r.h);
    const p = { x: r.x + (e.clientX - box.left) / k, y: r.y + (e.clientY - box.top) / k };
    engine.setCamera(centerOn(p, engine.width, engine.height, engine.base, engine.camera.zoom));
  };

  const k = world ? Math.min(W / world.w, H / world.h) : 1;
  return (
    <div className="cv-minimap cv-ui" aria-label="Minimap">
      <canvas
        ref={canvas}
        style={{ width: W, height: H }}
        role="img"
        aria-label="Overview of the canvas; tap to jump"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => e.buttons && jump(e)}
      />
      {world &&
        days.map((d) => {
          const top = (d.y - world.y) * k;
          if (top < 0 || top > H) return null;
          return (
            <button
              key={d.date}
              type="button"
              className="cv-mini-day"
              style={{ top }}
              aria-label={`Jump to ${dayLabel(d.date)}`}
              title={dayLabel(d.date)}
              onClick={() => engine.setCamera({ x: engine.camera.x, y: d.y - (engine.height * 0.15) / engine.pxPerUnit, zoom: engine.camera.zoom }, true)}
            />
          );
        })}
    </div>
  );
}
