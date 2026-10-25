/**
 * Preview of lassoed captures (S3): **Send to canvas** places them below the latest content
 * (or in the carry tray when the canvas is hidden); dragging the preview onto the canvas drops
 * them there. Several captures keep their order.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X, GripVertical } from 'lucide-react';
import type { Capture } from '../../core/model/capture';
import { renderMarkdown } from '../../core/markdown/render';
import { dropOnCanvas, sendToCanvas } from '../sources/send';
import { toast } from '../common/toast';
import { useLibraryUi } from './state';

function Thumb({ c }: { c: Capture }) {
  const url = useMemo(() => (c.image ? URL.createObjectURL(c.image) : null), [c.image]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const html = useMemo(() => (c.text ? renderMarkdown(c.text.length > 600 ? `${c.text.slice(0, 600)}…` : c.text) : ''), [c.text]);
  return (
    <div className="cap-item">
      {url && <img src={url} alt="Captured region" draggable={false} />}
      {html && <div className="cap-text md" dangerouslySetInnerHTML={{ __html: html }} />}
      {!url && !html && <div className="cap-text muted">Empty capture</div>}
    </div>
  );
}

export function CapturePreview() {
  const captures = useLibraryUi((s) => s.captures);
  const at = useLibraryUi((s) => s.previewAt);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // S3: the card's real height keeps it (and Send to canvas) on screen; a tall capture can
  // make it up to 420 px high
  const [height, setHeight] = useState(260);
  useLayoutEffect(() => {
    if (ref.current && ref.current.offsetHeight !== height) setHeight(ref.current.offsetHeight);
  });

  // keyboard: Escape dismisses
  useEffect(() => {
    if (!captures.length) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && useLibraryUi.getState().clearCaptures();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [captures.length]);

  // keyboard: the preview takes focus on Send to canvas, and gives it back when it goes
  const shown = captures.length > 0 && !!at;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || el.contains(now))) opener.focus({ preventScroll: true });
    };
  }, [shown]);

  if (!shown) return null;

  const send = async () => {
    setBusy(true);
    try {
      await sendToCanvas(captures);
      useLibraryUi.getState().clearCaptures();
    } catch (err) {
      toast(`Could not send: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = ref.current!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top });
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY });
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag(null);
    const moved = Math.hypot(e.clientX - (at.x + drag.dx), e.clientY - (at.y + drag.dy)) > 8;
    if (!moved) return;
    // the preview itself is under the pointer: hit-test what is below it
    const dropped = await dropOnCanvas(captures, e.clientX, e.clientY);
    if (dropped) {
      toast(captures.length === 1 ? 'Dropped on the canvas' : `Dropped ${captures.length} clips on the canvas`);
      useLibraryUi.getState().clearCaptures();
    }
  };

  const w = 300;
  const left = drag ? drag.x - drag.dx : Math.max(8, Math.min(window.innerWidth - w - 8, at.x));
  const top = drag ? drag.y - drag.dy : Math.max(56, Math.min(window.innerHeight - height - 8, at.y));

  return createPortal(
    <div
      ref={ref}
      className={`cap-preview${drag ? ' dragging' : ''}`}
      style={{ left, top, width: w }}
      role="dialog"
      aria-label="Lassoed content"
      data-testid="capture-preview"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="cap-head">
        <GripVertical size={14} aria-hidden />
        <span>{captures.length === 1 ? 'Capture' : `${captures.length} captures`}</span>
        <span className="spacer" />
        <button className="icon-btn small" aria-label="Discard captures" title="Discard" onClick={() => useLibraryUi.getState().clearCaptures()}>
          <X size={14} />
        </button>
      </div>
      <div className="cap-list">
        {captures.map((c) => (
          <div key={c.id} className="cap-row">
            <Thumb c={c} />
            {captures.length > 1 && (
              <button className="icon-btn small" aria-label="Remove this capture" onClick={() => useLibraryUi.getState().removeCapture(c.id)}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="cap-actions">
        <span className="muted small">Drag onto the canvas, or</span>
        <button className="btn primary" disabled={busy} onClick={send} data-autofocus>
          <Send size={14} /> Send to canvas
        </button>
      </div>
    </div>,
    document.body,
  );
}
