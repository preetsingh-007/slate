/**
 * Cropping an image (C8): the whole image is shown with the crop rectangle on top; corners
 * resize it and dragging inside moves it. Done keeps the visible part where it is.
 */
import { useRef, useState } from 'react';
import type { Crop, ImageObject } from '../../core/model/types';
import { applyAffine } from '../../core/canvas/transform';
import { useCanvas, useFrame } from './context';
import { useAssetUrl } from './ObjectLayer';

const MIN = 0.05;

export function CropOverlay() {
  const { cropping, setCropping, ctl } = useCanvas();
  const o = cropping ? ctl.get(cropping) : undefined;
  if (!o || o.kind !== 'image') return null;
  return <CropBox key={o.id} img={o} onDone={() => setCropping(null)} />;
}

function CropBox({ img, onDone }: { img: ImageObject; onDone(): void }) {
  const { engine, ctl } = useCanvas();
  const url = useAssetUrl(img.asset);
  const c0 = img.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const fw = img.w / c0.w;
  const fh = img.h / c0.h;
  const fx = img.x - c0.x * fw;
  const fy = img.y - c0.y * fh;
  const [r, setR] = useState<Crop>(c0);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; r0: Crop } | null>(null);

  useFrame(engine, (cam) => {
    const el = host.current;
    if (!el) return;
    const k = cam.zoom * engine.base;
    const cx = img.x + img.w / 2;
    const cy = img.y + img.h / 2;
    Object.assign(el.style, {
      transform: `translate(${(fx - cam.x) * k}px, ${(fy - cam.y) * k}px) rotate(${img.rotation}deg)`,
      transformOrigin: `${(cx - fx) * k}px ${(cy - fy) * k}px`,
      width: `${fw * k}px`,
      height: `${fh * k}px`,
    });
  });

  const onDown = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r0: r };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = engine.pxPerUnit;
    // pointer delta in the image's own (unrotated) axes, normalised to the whole image
    const a = (-img.rotation * Math.PI) / 180;
    const sx = e.clientX - d.sx;
    const sy = e.clientY - d.sy;
    const dx = (sx * Math.cos(a) - sy * Math.sin(a)) / (fw * k);
    const dy = (sx * Math.sin(a) + sy * Math.cos(a)) / (fh * k);
    let { x, y, w, h } = d.r0;
    if (d.mode === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (d.mode.includes('w')) {
        const nx = clamp(x + dx, 0, x + w - MIN);
        w += x - nx;
        x = nx;
      }
      if (d.mode.includes('e')) w = clamp(w + dx, MIN, 1 - x);
      if (d.mode.includes('n')) {
        const ny = clamp(y + dy, 0, y + h - MIN);
        h += y - ny;
        y = ny;
      }
      if (d.mode.includes('s')) h = clamp(h + dy, MIN, 1 - y);
    }
    setR({ x, y, w, h });
  };
  const onUp = () => {
    drag.current = null;
  };

  const apply = (crop: Crop) => {
    const w = crop.w * fw;
    const h = crop.h * fh;
    // the new frame's centre, rotated around the old centre like the image itself
    const local = { x: fx + crop.x * fw + w / 2, y: fy + crop.y * fh + h / 2 };
    const centre = { x: img.x + img.w / 2, y: img.y + img.h / 2 };
    const c = applyAffine({ ox: centre.x, oy: centre.y, s: 1, rot: img.rotation, dx: 0, dy: 0 }, local);
    const full = crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1;
    ctl.update([[img.id, { crop: full ? undefined : crop, x: Math.round((c.x - w / 2) * 10) / 10, y: Math.round((c.y - h / 2) * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 }]]);
    engine.select([img.id]);
    onDone();
  };

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="cv-crop-layer cv-ui" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div ref={host} className="cv-crop">
        {url && <img src={url} alt="" draggable={false} />}
        <div className="cv-crop-shade" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(r.x)} ${pct(r.y)}, ${pct(r.x)} ${pct(r.y + r.h)}, ${pct(r.x + r.w)} ${pct(r.y + r.h)}, ${pct(r.x + r.w)} ${pct(r.y)}, ${pct(r.x)} ${pct(r.y)})` }} />
        <div className="cv-crop-rect" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }} onPointerDown={onDown('move')}>
          {['nw', 'ne', 'sw', 'se'].map((h) => (
            <div key={h} className={`cv-handle cv-h-${h}`} onPointerDown={onDown(h)} />
          ))}
        </div>
      </div>
      <div className="cv-crop-bar" role="toolbar" aria-label="Crop">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => setR({ x: 0, y: 0, w: 1, h: 1 })}>
          Reset
        </button>
        <button type="button" className="btn primary" onClick={() => apply(r)}>
          Done
        </button>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
