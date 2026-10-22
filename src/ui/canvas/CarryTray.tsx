/**
 * The carry tray (S4): a strip at the screen edge holding captures not yet dropped on the
 * canvas. Drag an item onto the canvas (finger, Pencil or mouse), or place them all below the
 * latest content in order (S3).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import type { Capture } from '../../core/model/capture';
import { isNarrowScreen, useApp } from '../app/store';
import { canvasApi } from '../common/registries';
import { canvasVisible, dropOnCanvas } from '../sources/send';
import { toast } from '../common/toast';

/** Placing from the tray while the side pane fills the screen: show the canvas, where they land (P2). */
function showCanvas() {
  if (canvasVisible()) return;
  const app = useApp.getState();
  app.setLayout(isNarrowScreen() ? 'canvas' : 'split');
}

export function CarryTray() {
  const carry = useApp((s) => s.carry);
  if (!carry.length) return null;
  return (
    <aside className="cv-carry cv-ui" aria-label={`Carry tray, ${carry.length} capture${carry.length === 1 ? '' : 's'}`}>
      <div className="cv-carry-head">
        <span>Carry</span>
        <button
          type="button"
          className="icon-btn"
          title="Place all below the latest content"
          aria-label="Place all captures on the canvas"
          onClick={async () => {
            showCanvas();
            const api = canvasApi(useApp.getState().canvas);
            if (!api) return toast('Open the canvas to place captures.');
            const all = useApp.getState().carry;
            await api.insertCaptures(all);
            for (const c of all) useApp.getState().removeFromCarry(c.id);
          }}
        >
          <ArrowDownToLine size={16} />
        </button>
      </div>
      <ul>
        {carry.map((c) => (
          <CarryItem key={c.id} capture={c} />
        ))}
      </ul>
    </aside>
  );
}

function CarryItem({ capture }: { capture: Capture }) {
  const url = useMemo(() => (capture.image ? URL.createObjectURL(capture.image) : null), [capture.image]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  return (
    <li className="cv-carry-item">
      <div
        className="cv-carry-card"
        role="button"
        tabIndex={0}
        aria-label={`Capture from ${capture.source.title}. Drag onto the canvas, or press Enter to place it.`}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter') return;
          showCanvas();
          const api = canvasApi(useApp.getState().canvas);
          if (!api) return;
          await api.insertCaptures([capture]);
          useApp.getState().removeFromCarry(capture.id);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          if (drag || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) setDrag({ x: e.clientX, y: e.clientY });
        }}
        onPointerUp={async (e) => {
          const s = start.current;
          start.current = null;
          const d = drag;
          setDrag(null);
          if (!s || !d) return;
          if (await dropOnCanvas([capture], e.clientX, e.clientY)) useApp.getState().removeFromCarry(capture.id);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <p>{capture.text.slice(0, 120)}</p>}
        <span className="cv-carry-src">{capture.source.title}</span>
      </div>
      <button type="button" className="cv-carry-x icon-btn" aria-label="Remove from the tray" onClick={() => useApp.getState().removeFromCarry(capture.id)}>
        <X size={14} />
      </button>
      {drag && (
        <div className="cv-carry-ghost" style={{ transform: `translate(${drag.x - 60}px, ${drag.y - 40}px)` }} aria-hidden>
          {url ? <img src={url} alt="" /> : <p>{capture.text.slice(0, 80)}</p>}
        </div>
      )}
    </li>
  );
}
