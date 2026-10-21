/**
 * The selection box with its handles (move, scale, rotate, text width, line ends) and the
 * action bar (C15): every action works with a tap, and from the keyboard on laptops.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  BringToFront,
  Copy,
  CopyPlus,
  Crop,
  Download,
  Ellipsis,
  Flag,
  GripVertical,
  Group,
  Maximize,
  Palette,
  RotateCcw,
  Scissors,
  Send,
  SendToBack,
  Tag,
  Trash2,
  Ungroup,
  WandSparkles,
} from 'lucide-react';
import type { CanvasObject, ClipDisplay, Rect } from '../../core/model/types';
import { CURRENT_INK } from '../../core/ink/render';
import { payloadHtml, makePayload, selectionMarkdown } from '../../core/canvas/clipboard';
import { getSelectionActions } from '../common/registries';
import { toast } from '../common/toast';
import { useCanvas, useFrame } from './context';
import {
  beautifySelection,
  copySelection,
  deleteSelection,
  duplicateSelection,
  exportSelection,
  groupSelection,
  recolorSelection,
  restack,
  restoreSelection,
  setClipDisplay,
  setLineWidth,
  ungroupSelection,
} from './actions';
import { pngDataUrl } from './io';
import { captureSelection } from './sourceCapture';
import { useApp } from '../app/store';
import { dropOnCanvas, sendToCanvas } from '../sources/send';
import { createPortal } from 'react-dom';
import { COLOR_NAMES, PEN_COLORS } from './toolStore';

export function SelectionOverlay() {
  const { engine, ctl } = useCanvas();
  const [ids, setIds] = useState<string[]>(engine.getSelection());
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const handles = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);

  useEffect(() => engine.selection.on((s) => setIds([...s])), [engine]);
  useEffect(() => engine.preview.on((p) => setDragging(!!p)), [engine]);
  useEffect(() => ctl.model.onChange.on((c) => (ids.some((id) => c.changed.has(id)) ? bump((x) => x + 1) : undefined)), [ctl, ids]);

  const place = () => {
    const b = engine.getSelectionBounds();
    if (!b || !box.current) return;
    const k = engine.pxPerUnit;
    const cam = engine.camera;
    const x = (b.x - cam.x) * k - 6;
    const y = (b.y - cam.y) * k - 6;
    const w = b.w * k + 12;
    const h = b.h * k + 12;
    Object.assign(box.current.style, { transform: `translate(${x}px, ${y}px)`, width: `${w}px`, height: `${h}px` });
    if (handles.current) Object.assign(handles.current.style, { transform: `translate(${x}px, ${y}px)`, width: `${w}px`, height: `${h}px` });
    const el = bar.current;
    if (el) {
      const bw = el.offsetWidth || 320;
      const bh = el.offsetHeight || 44;
      const left = Math.max(8, Math.min(engine.width - bw - 8, x + w / 2 - bw / 2));
      // clear of the rotation handle above the box
      let top = y - bh - 52;
      if (top < 8) top = Math.min(engine.height - bh - 8, y + h + 16);
      if (top < 8 || top > engine.height - bh - 8) top = 8;
      el.style.transform = `translate(${left}px, ${top}px)`;
    }
    // line ends
    const objs = ctl.objectsOf(engine.getSelection());
    const one = objs.length === 1 ? objs[0] : null;
    if (one?.kind === 'shape' && (one.geometry.kind === 'line' || one.geometry.kind === 'arrow')) {
      for (const end of ['a', 'b'] as const) {
        const hEl = handles.current?.querySelector<HTMLElement>(`[data-handle="${end}"]`);
        const p = one.geometry[end];
        if (hEl) hEl.style.transform = `translate(${(p.x - b.x) * k + 6}px, ${(p.y - b.y) * k + 6}px)`;
      }
    }
  };
  useFrame(engine, place);
  useEffect(place);

  if (!ids.length || dragging) return null;
  const objs = ctl.objectsOf(ids);
  if (!objs.length) return null;
  const one = objs.length === 1 ? objs[0] : null;
  const isLine = one?.kind === 'shape' && (one.geometry.kind === 'line' || one.geometry.kind === 'arrow');
  const widthHandle = one && (one.kind === 'text' || one.kind === 'clip') && !one.rotation;

  return (
    <>
      <div ref={box} className="cv-selbox" aria-hidden />
      <div ref={handles} className="cv-handles">
        {!isLine && (
          <>
            {['nw', 'ne', 'sw', 'se'].map((h) => (
              <div key={h} className={`cv-handle cv-h-${h}`} data-handle={h} role="presentation" />
            ))}
            <div className="cv-handle cv-h-rotate" data-handle="rotate" role="presentation" title="Rotate" />
          </>
        )}
        {widthHandle && <div className="cv-handle cv-h-width" data-handle="width" role="presentation" title="Width" />}
        {isLine && (
          <>
            <div className="cv-handle cv-h-end" data-handle="a" role="presentation" />
            <div className="cv-handle cv-h-end" data-handle="b" role="presentation" />
          </>
        )}
      </div>
      <ActionBar barRef={bar} objs={objs} />
    </>
  );
}

function ActionBar({ barRef, objs }: { barRef: React.RefObject<HTMLDivElement | null>; objs: CanvasObject[] }) {
  const c = useCanvas();
  const { actions, engine, services, slug } = c;
  const [menu, setMenu] = useState<'more' | 'color' | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const hasInk = objs.some((o) => o.kind === 'stroke' || o.kind === 'shape');
  const strokes = objs.filter((o) => o.kind === 'stroke');
  const beautified = objs.filter((o) => o.kind === 'shape' && o.originals.length);
  const shapes = objs.filter((o) => o.kind === 'shape');
  const clips = objs.filter((o) => o.kind === 'clip');
  const images = objs.filter((o) => o.kind === 'image');
  const grouped = objs.some((o) => o.group);
  const custom = services.settings.get().colors;
  const bounds = engine.getSelectionBounds() as Rect;
  const mainCanvas = useApp((s) => s.canvas);

  useEffect(() => {
    setMenu(null);
    setPng(null);
    if (objs.length > 2000) return;
    let alive = true;
    const t = setTimeout(() => void pngDataUrl(services, objs).then((u) => alive && setPng(u)), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objs.map((o) => o.id).join(), services]);

  const run = (fn: () => unknown) => () => {
    setMenu(null);
    void fn();
  };
  const btn = (label: string, Icon: ComponentType<{ size?: number }>, fn: () => unknown, extra?: { pressed?: boolean; disabled?: boolean }) => (
    <button type="button" className="cv-btn" aria-label={label} title={label} onClick={run(fn)} disabled={extra?.disabled} aria-pressed={extra?.pressed}>
      <Icon size={18} />
    </button>
  );
  const item = (label: string, fn: () => unknown, Icon?: ComponentType<{ size?: number }>) => (
    <button type="button" role="menuitem" onClick={run(fn)}>
      {Icon && <Icon size={16} />}
      {label}
    </button>
  );
  const other = getSelectionActions().filter((a) => !a.when || a.when({ canvas: slug, objects: objs, bounds }));

  return (
    <div ref={barRef} className="cv-actionbar cv-ui" role="toolbar" aria-label="Selection">
      <span className="cv-sel-count" aria-live="polite">
        {objs.length === 1 ? kindLabel(objs[0]) : `${objs.length} items`}
      </span>
      {btn('Copy (⌘C)', Copy, () => copySelection(actions))}
      {btn('Cut (⌘X)', Scissors, () => copySelection(actions, true))}
      {btn('Duplicate (⌘D)', CopyPlus, () => duplicateSelection(actions))}
      {btn('Delete (⌫)', Trash2, () => deleteSelection(actions))}
      {hasInk && (
        <button type="button" className="cv-btn" aria-label="Colour" title="Colour" aria-haspopup="menu" aria-expanded={menu === 'color'} onClick={() => setMenu(menu === 'color' ? null : 'color')}>
          <Palette size={18} />
        </button>
      )}
      {strokes.length > 0 && btn('Beautify: snap shapes', WandSparkles, () => beautifySelection(actions))}
      {beautified.length > 0 && btn('Restore original ink', RotateCcw, () => restoreSelection(actions))}
      {c.embedded && slug !== mainCanvas && <SendToMainCanvas />}
      {btn('Mark for gym', Flag, () => c.openMarkDialog())}
      {btn('Tag with topics', Tag, () => c.openTopics({ kind: 'objects', ids: objs.map((o) => o.id) }))}
      <span
        className="cv-btn cv-grip"
        role="button"
        tabIndex={0}
        aria-label="Drag out to another app"
        title="Drag to another app (image and Markdown)"
        draggable
        onDragStart={(e) => {
          const md = selectionMarkdown(objs);
          e.dataTransfer.setData('text/plain', md);
          e.dataTransfer.setData('text/html', payloadHtml(makePayload(slug, objs), md, png ?? undefined));
          if (png) e.dataTransfer.setData('DownloadURL', `image/png:${slug}-selection.png:${png}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <GripVertical size={18} />
      </span>
      <button type="button" className="cv-btn" aria-label="More actions" title="More" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
        <Ellipsis size={18} />
      </button>
      {menu === 'color' && (
        <div className="cv-popover cv-swatches" role="menu" aria-label="Colour">
          {[...PEN_COLORS, ...custom].map((col) => (
            <button
              key={col}
              type="button"
              role="menuitem"
              className="cv-swatch"
              aria-label={COLOR_NAMES[col] ?? col}
              title={COLOR_NAMES[col] ?? col}
              style={{ ['--swatch' as string]: col === CURRENT_INK ? 'var(--ink-default)' : col }}
              onClick={run(() => recolorSelection(actions, col))}
            />
          ))}
          {shapes.length > 0 && (
            <div className="cv-row">
              <span>Line</span>
              {[1.5, 2.5, 4, 6].map((w) => (
                <button key={w} type="button" className="cv-chip" onClick={run(() => setLineWidth(actions, w))} aria-label={`Line width ${w}`}>
                  {w}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {menu === 'more' && (
        <div className="cv-popover cv-menu" role="menu" aria-label="More actions">
          {objs.length > 1 && item('Group (⌘G)', () => groupSelection(actions), Group)}
          {grouped && item('Ungroup (⇧⌘G)', () => ungroupSelection(actions), Ungroup)}
          {item('Bring forward (])', () => restack(actions, 1), BringToFront)}
          {item('Send back ([)', () => restack(actions, -1), SendToBack)}
          {item('Fit selection (⇧2)', () => engine.fitSelection(), Maximize)}
          {images.length === 1 && objs.length === 1 && item('Crop', () => c.setCropping(images[0].id), Crop)}
          {clips.length > 0 &&
            (['image', 'text', 'both'] as ClipDisplay[]).map((d) => (
              <button key={d} type="button" role="menuitemradio" aria-checked={clips.every((x) => x.kind === 'clip' && x.display === d)} onClick={run(() => setClipDisplay(actions, d))}>
                Show {d === 'both' ? 'image and text' : d}
              </button>
            ))}
          {item('Export PNG', () => exportSelection(actions, 'png'), Download)}
          {item('Export SVG', () => exportSelection(actions, 'svg'), Download)}
          {other.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={run(() => {
                try {
                  a.run({ canvas: slug, objects: objs, bounds });
                } catch (err) {
                  toast(String((err as Error).message ?? err));
                }
              })}
            >
              {a.icon && <a.icon size={16} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * S1, S3 for a canvas in the side pane: a tap sends the selected region to the main canvas as
 * a clip (below the latest content, or into the carry tray when the main canvas is hidden);
 * dragging the button drops it where it is released on the main canvas.
 */
function SendToMainCanvas() {
  const { actions } = useCanvas();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const busy = useRef(false);
  const capture = async () => {
    const cap = await captureSelection(actions);
    if (!cap) toast('Select something to send first.');
    return cap;
  };
  const send = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const cap = await capture();
      if (cap) await sendToCanvas([cap]);
    } finally {
      busy.current = false;
    }
  };
  return (
    <>
      <button
        type="button"
        className="cv-btn"
        aria-label="Send to canvas"
        title="Send to the main canvas, or drag onto it"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          void send();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const st = start.current;
          if (!st || st.id !== e.pointerId) return;
          if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
          st.moved = true;
          setDrag({ x: e.clientX, y: e.clientY });
        }}
        onPointerUp={async (e) => {
          const st = start.current;
          start.current = null;
          setDrag(null);
          if (!st) return;
          if (!st.moved) return void send();
          const cap = await capture();
          if (!cap) return;
          if (await dropOnCanvas([cap], e.clientX, e.clientY)) toast('Dropped on the canvas');
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        <Send size={18} />
      </button>
      {drag &&
        createPortal(
          <div className="cv-carry-ghost cv-send-ghost" style={{ transform: `translate(${drag.x - 30}px, ${drag.y - 20}px)` }} aria-hidden>
            <Send size={16} />
          </div>,
          document.body,
        )}
    </>
  );
}

function kindLabel(o: CanvasObject): string {
  switch (o.kind) {
    case 'stroke':
      return o.tool === 'highlighter' ? 'Highlight' : 'Ink';
    case 'text':
      return 'Text';
    case 'image':
      return 'Image';
    case 'clip':
      return 'Clip';
    case 'shape':
      return o.shape[0].toUpperCase() + o.shape.slice(1);
  }
}
