/** Pieces shared by the PDF, EPUB and clipping viewers. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Highlighter, StickyNote, Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS } from '../../core/library/annotations';
import { LassoOverlay, type LassoMode, type LassoResult } from '../sources/LassoOverlay';

/**
 * Hosts the lasso over the visible part of a scroll container (S1). It sits in a sticky,
 * zero-height wrapper inside the container, so wheel and two-finger scrolling still reach the
 * container while the lasso is on.
 */
export function LassoHost({ active, mode = 'free', onLasso }: { scrollRef?: RefObject<HTMLElement | null>; active: boolean; mode?: LassoMode; onLasso(r: LassoResult): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  // measure the scroll container (this element's parent): a child's layout effect runs before
  // the parent's ref is attached, so the parent is found through the DOM
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="lasso-sticky" data-no-text>
      {active && (
        <div className="lasso-sticky-inner" style={{ height: h }}>
          <LassoOverlay mode={mode} onLasso={onLasso} label="Lasso: draw around content to capture it" />
        </div>
      )}
    </div>
  );
}

/** A floating panel anchored to a client rect; closes on outside pointer or Escape. */
export function Popover({ anchor, onClose, children, label, width = 260 }: { anchor: DOMRect | { left: number; top: number; bottom: number; width: number }; onClose(): void; children: ReactNode; label: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 8 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let top = anchor.top - h - 8;
    if (top < 52) top = anchor.bottom + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // defer so the click that opened the popover does not close it
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true));
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="lib-popover" style={{ ...pos, width }} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

/** Highlight colours, note and copy for a text selection (L4, L5, L11). */
export function SelectionMenu({ anchor, onHighlight, onNote, onCopy, onClose }: { anchor: DOMRect; onHighlight(color: string): void; onNote(): void; onCopy(): void; onClose(): void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} label="Selection actions" width={250}>
      <div className="sel-menu" role="toolbar" aria-label="Highlight" onPointerDown={(e) => e.preventDefault()}>
        {HIGHLIGHT_COLORS.map((c) => (
          <button key={c.id} className="sel-swatch" style={{ background: c.value }} aria-label={`Highlight ${c.label.toLowerCase()}`} title={`Highlight ${c.label.toLowerCase()}`} onClick={() => onHighlight(c.value)}>
            <Highlighter size={13} />
          </button>
        ))}
        <span className="sel-sep" />
        <button className="icon-btn small" aria-label="Add a note" title="Add a note" onClick={onNote}>
          <StickyNote size={15} />
        </button>
        <button className="icon-btn small" aria-label="Copy" title="Copy" onClick={onCopy}>
          <Copy size={15} />
        </button>
      </div>
    </Popover>
  );
}

/** Actions on an existing highlight: recolour, note, remove. */
export function HighlightMenu({ anchor, onColor, onNote, onRemove, onClose }: { anchor: DOMRect; onColor(c: string): void; onNote(): void; onRemove(): void; onClose(): void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} label="Highlight actions" width={250}>
      <div className="sel-menu" role="toolbar" aria-label="Highlight">
        {HIGHLIGHT_COLORS.map((c) => (
          <button key={c.id} className="sel-swatch" style={{ background: c.value }} aria-label={`Colour ${c.label.toLowerCase()}`} onClick={() => onColor(c.value)} />
        ))}
        <span className="sel-sep" />
        <button className="icon-btn small" aria-label="Add a note" title="Add a note" onClick={onNote}>
          <StickyNote size={15} />
        </button>
        <button className="icon-btn small" aria-label="Remove highlight" title="Remove highlight" onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
    </Popover>
  );
}

/** Margin note editor (L4, L5, L11). */
export function NoteEditor({ anchor, initial, quote, onSave, onDelete, onClose }: { anchor: DOMRect; initial: string; quote?: string; onSave(text: string): void; onDelete?(): void; onClose(): void }) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const save = () => {
    onSave(text.trim());
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={save} label="Note" width={280}>
      <div className="note-editor">
        {quote && <blockquote className="note-quote">{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}</blockquote>}
        <textarea
          ref={area}
          aria-label="Note text"
          value={text}
          rows={4}
          placeholder="Write a note…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <div className="actions">
          {onDelete && (
            <button
              className="btn danger"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} aria-label="Cancel">
            <X size={14} />
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Popover>
  );
}

/** Copies text to the clipboard (best effort). */
export function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}
