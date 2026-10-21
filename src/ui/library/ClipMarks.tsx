/**
 * Links back from a source (S7): light marks in the margin of a book or clipping where clips
 * were taken. Tapping a mark lists its clips; choosing one opens its canvas and reveals it.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipRef } from '../../core/stores/canvases';
import { useApp } from '../app/store';
import { canvasApi } from '../common/registries';
import { toast } from '../common/toast';

/** Opens the clip's canvas (if needed) and reveals the clip. */
export async function revealClip(ref: ClipRef): Promise<void> {
  const app = useApp.getState();
  if (app.canvas !== ref.canvas) app.setCanvas(ref.canvas);
  if (app.layout === 'pane') app.setLayout('split');
  if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches) app.setLayout('canvas');
  // the canvas registers its API once mounted
  for (let i = 0; i < 40; i++) {
    const api = canvasApi(ref.canvas);
    if (api) {
      api.revealObject(ref.clip.id);
      return;
    }
    await new Promise((r) => setTimeout(r, 75));
  }
  toast('The canvas is not available to show this clip.');
}

export function clipLabel(ref: ClipRef): string {
  const t = ref.clip.text.replace(/[#>*_`$\\[\]()!]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 70 ? `${t.slice(0, 70)}…` : t) : 'Image clip';
}

/** A mark: a thin bar in the margin with the number of clips. */
export function ClipMark({ clips, style, className = '' }: { clips: ClipRef[]; style: React.CSSProperties; className?: string }) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const label = clips.length === 1 ? '1 clip from here' : `${clips.length} clips from here`;
  return (
    <>
      <button
        className={`clip-mark ${className}`}
        style={style}
        aria-label={label}
        title={label}
        data-testid="clip-mark"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(e.currentTarget.getBoundingClientRect());
        }}
      />
      {open && <ClipList clips={clips} anchor={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ClipList({ clips, anchor, onClose }: { clips: ClipRef[]; anchor: DOMRect; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(window.innerWidth - 288, anchor.left - 280));
  const top = Math.max(56, Math.min(window.innerHeight - 200, anchor.top));
  return createPortal(
    <div ref={ref} className="menu clip-list" style={{ left, top, width: 280 }} role="menu" aria-label="Clips taken from here">
      {clips.map((c) => (
        <button
          key={`${c.canvas}/${c.clip.id}`}
          role="menuitem"
          onClick={() => {
            onClose();
            void revealClip(c);
          }}
        >
          <span className="clip-list-text">{clipLabel(c)}</span>
          <span className="muted small">{c.canvas}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
