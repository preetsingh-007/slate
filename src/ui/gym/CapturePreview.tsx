/**
 * Captures lassoed from a gym file, waiting to move (S3): drag one onto the canvas, or press
 * Send to canvas (below the latest content, or into the carry tray when the canvas is not on
 * screen). Several captures keep their order.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X } from 'lucide-react';
import type { Capture } from '../../core/model/capture';
import { renderMarkdown } from '../../core/markdown/render';
import { dropOnCanvas, sendToCanvas } from '../sources/send';
import { toast } from '../common/toast';

export function CapturePreview({ captures, onChange }: { captures: Capture[]; onChange(list: Capture[]): void }) {
  return (
    <div className="gym-captures" role="region" aria-label="Captures">
      <div className="gym-captures-list">
        {captures.map((c) => (
          <CaptureCard key={c.id} capture={c} onDone={() => onChange(captures.filter((x) => x.id !== c.id))} />
        ))}
      </div>
      <div className="gym-captures-actions">
        <button
          className="btn primary"
          onClick={async () => {
            await sendToCanvas(captures);
            onChange([]);
          }}
        >
          <Send size={14} aria-hidden /> Send to canvas
        </button>
        <button className="btn" onClick={() => onChange([])}>
          Discard
        </button>
      </div>
    </div>
  );
}

function CaptureCard({ capture, onDone }: { capture: Capture; onDone(): void }) {
  const url = useMemo(() => (capture.image ? URL.createObjectURL(capture.image) : null), [capture.image]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button') || e.button !== 0) return;
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    s.moved = true;
    setDrag({ x: e.clientX, y: e.clientY });
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s || !s.moved) return;
    if (await dropOnCanvas([capture], e.clientX, e.clientY)) {
      toast('Placed on the canvas');
      onDone();
    }
  };

  const summary = capture.text.split('\n').find((l) => l.trim()) ?? '';
  return (
    <div
      className="gym-capture"
      aria-label={`Capture: ${summary.slice(0, 60)}. Drag onto the canvas.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      style={{ opacity: drag ? 0.4 : 1 }}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="gym-capture-text gym-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(capture.text) }} />}
      <button className="gym-capture-x" aria-label="Discard capture" onClick={onDone}>
        <X size={12} />
      </button>
      {drag &&
        createPortal(
          <div className="gym-capture-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
            {url ? <img src={url} alt="" /> : <span>{summary}</span>}
          </div>,
          document.body,
        )}
    </div>
  );
}
