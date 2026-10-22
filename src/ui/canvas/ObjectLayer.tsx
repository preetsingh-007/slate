/**
 * Text boxes, images and clips as DOM elements (C7, C8, C9, S8), mounted only while they are
 * near the view. The layer is one element transformed with the camera, so objects are laid
 * out in canvas units and zoom without re-rendering.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, Link2Off, Globe, Shapes } from 'lucide-react';
import type { CanvasObject, ClipObject, ImageObject, TextObject } from '../../core/model/types';
import type { ObjectPatch } from '../../core/canvas/model';
import { SpatialIndex } from '../../core/canvas/spatial';
import { renderMarkdown } from '../../core/markdown/render';
import { setTask } from '../../core/markdown/tasks';
import { replaceText } from '../../core/canvas/segment';
import { makeText, TEXT_FONT, TEXT_WIDTH } from '../../core/canvas/objects';
import { uid } from '../../core/util/ids';
import { openSource } from '../common/registries';
import { toast } from '../common/toast';
import { useCanvas, useFrame } from './context';
import { useTools } from './toolStore';

const isDom = (o: CanvasObject) => o.kind === 'text' || o.kind === 'image' || o.kind === 'clip';

export function ObjectLayer() {
  const { engine, ctl } = useCanvas();
  const layer = useRef<HTMLDivElement>(null);
  const index = useMemo(() => new SpatialIndex(), []);
  const [visible, setVisible] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [preview, setPreview] = useState<Map<string, ObjectPatch> | null>(null);
  const visibleRef = useRef<string[]>([]);

  const recompute = () => {
    const v = engine.view;
    const m = { x: v.x - v.w * 0.5, y: v.y - v.h * 0.5, w: v.w * 2, h: v.h * 2 };
    const ids = [...index.query(m)].sort();
    const prev = visibleRef.current;
    if (ids.length !== prev.length || ids.some((id, i) => id !== prev[i])) {
      visibleRef.current = ids;
      setVisible(ids);
    }
  };

  useEffect(() => {
    for (const o of ctl.model.objects()) if (isDom(o)) index.set(o.id, bounds(o));
    recompute();
    return ctl.model.onChange.on((c) => {
      let dom = false;
      for (const id of c.removed) {
        if (index.box(id)) dom = true;
        index.delete(id);
      }
      for (const id of c.changed) {
        const o = ctl.model.get(id);
        if (o && isDom(o)) {
          index.set(id, bounds(o));
          dom = true;
        } else if (index.box(id)) {
          index.delete(id);
          dom = true;
        }
      }
      if (dom) {
        recompute();
        setTick((t) => t + 1);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  useEffect(() => engine.preview.on(setPreview), [engine]);

  useFrame(engine, (cam) => {
    const el = layer.current;
    if (el) {
      const k = cam.zoom * engine.base;
      el.style.transform = `translate(${-cam.x * k}px, ${-cam.y * k}px) scale(${k})`;
    }
    recompute();
  });

  const { editing } = useCanvas();
  return (
    <div ref={layer} className="cv-objects">
      {editing && <EditorBox key={editing.id ?? `draft:${editing.at?.x}:${editing.at?.y}`} id={editing.id} at={editing.at} initial={editing.initial} />}
      {visible.map((id) => {
        const o = ctl.model.get(id);
        if (!o || id === editing?.id) return null;
        const p = preview?.get(id);
        return <ObjectView key={id} obj={p ? ({ ...o, ...p } as CanvasObject) : o} />;
      })}
    </div>
  );
}

function bounds(o: CanvasObject) {
  // rotation can make the drawn box larger than the frame
  const r = Math.hypot(o.w, o.h) / 2;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  return o.rotation ? { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r } : { x: o.x, y: o.y, w: o.w, h: o.h };
}

const ObjectView = memo(function ObjectView({ obj }: { obj: CanvasObject }) {
  switch (obj.kind) {
    case 'text':
      return <TextBoxView obj={obj} />;
    case 'image':
      return <ImageView obj={obj} />;
    case 'clip':
      return <ClipView obj={obj} />;
    default:
      return null;
  }
});

function frameStyle(o: CanvasObject): React.CSSProperties {
  return {
    left: o.x,
    top: o.y,
    width: o.w,
    transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
  };
}

/** Writes a measured height (layout, not an undo step; C7: height follows the content). */
function useMeasuredHeight(obj: CanvasObject, el: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const { ctl, services } = useCanvas();
  const objRef = useRef(obj);
  objRef.current = obj;
  useEffect(() => {
    const node = el.current;
    if (!node || !enabled || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const o = objRef.current;
      const h = Math.round(node.offsetHeight * 10) / 10;
      // only the device that made or is editing the box writes, so devices with other fonts do not fight
      if (!h || Math.abs(h - o.h) <= 2 || !ctl.model.has(o.id)) return;
      if (o.device !== services.device && !node.classList.contains('editing')) return;
      ctl.model.transact((tx) => tx.update(o.id, { h }), { undoable: false, touch: false });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [ctl, services, el, enabled]);
}

// ---------------------------------------------------------------- text boxes (C7)

function TextBoxView({ obj }: { obj: TextObject }) {
  const { ctl } = useCanvas();
  const ref = useRef<HTMLDivElement>(null);
  useMeasuredHeight(obj, ref, true);
  const html = useMemo(() => renderMarkdown(obj.content), [obj.content]);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.classList.contains('md-task')) {
      // C7: checkboxes are tappable; the change is written back into the Markdown
      const n = Number(t.dataset.task);
      const next = setTask(obj.content, n, t.checked);
      if (next !== obj.content) ctl.update([[obj.id, { content: next }]]);
      return;
    }
    const a = t.closest('a');
    if (a && a.getAttribute('href') === '#') e.preventDefault();
  };

  return (
    <div ref={ref} className="cv-obj cv-text" data-id={obj.id} style={{ ...frameStyle(obj), fontSize: obj.fontSize }}>
      <div className="md cv-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '<p>&nbsp;</p>' }} />
    </div>
  );
}

/**
 * Editing a text box: a plain <textarea> bound to the box's Y.Text, so iPadOS Scribble works
 * and edits merge with other devices; typing is undoable ('local' origin). A new box is a
 * draft until the first character, which creates the object (and today's line, C19) without
 * swapping the element, so no keystroke or Scribble input is lost.
 */
function EditorBox({ id, at, initial }: { id?: string; at?: { x: number; y: number }; initial?: string }) {
  const { ctl, engine, setEditing, services } = useCanvas();
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [bound, setBound] = useState<string | undefined>(id);
  const obj = bound ? (ctl.get(bound) as TextObject | undefined) : undefined;
  const ytext = bound ? ctl.model.textOf(bound) : null;
  useMeasuredHeight(obj ?? ({ id: '', h: 0, device: services.device } as unknown as TextObject), box, !!obj);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    if (ytext) {
      if (el.value !== ytext.toString()) el.value = ytext.toString();
    } else if (initial) {
      el.value = initial;
      queueMicrotask(() => create(el));
    }
    el.setSelectionRange(el.value.length, el.value.length);
    grow(el);
    el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ta.current;
    if (!el || !ytext) return;
    const onY = () => {
      const v = ytext.toString();
      if (v === el.value) return;
      // a remote or undo change: keep the caret near where it was
      const pos = el.selectionStart;
      const delta = v.length - el.value.length;
      el.value = v;
      const p = Math.max(0, Math.min(v.length, pos + (pos > 0 ? delta : 0)));
      el.setSelectionRange(p, p);
      grow(el);
    };
    ytext.observe(onY);
    return () => ytext.unobserve(onY);
  }, [ytext]);

  const create = (el: HTMLTextAreaElement) => {
    if (bound || !at || !el.value) return;
    const t = makeText({ id: uid(), now: Date.now(), device: ctl.device, z: ctl.model.topZ() }, { x: Math.round(at.x), y: Math.round(at.y), content: el.value });
    ctl.addObjects([t]);
    setBound(t.id);
  };

  const finish = () => {
    setEditing(null);
    const o = bound ? ctl.get(bound) : undefined;
    if (o?.kind === 'text' && !o.content.trim()) ctl.remove([o.id]);
    else if (o) engine.select([o.id]);
  };

  const style: React.CSSProperties = obj ? { ...frameStyle(obj), fontSize: obj.fontSize } : { left: at?.x ?? 0, top: at?.y ?? 0, width: TEXT_WIDTH, fontSize: TEXT_FONT };
  return (
    <div ref={box} className="cv-obj cv-text editing" data-id={bound} style={style}>
      <textarea
        ref={ta}
        className="cv-textarea"
        aria-label="Text box (Markdown with $maths$ and - [ ] to-dos)"
        placeholder="Type, or write with the Pencil"
        spellCheck
        onInput={(e) => {
          const el = e.currentTarget;
          if (!bound) create(el);
          else if (ytext) {
            const cur = ytext.toString();
            if (cur !== el.value) ytext.doc!.transact(() => replaceText(ytext, cur, el.value), 'local');
          } else if (obj && obj.content !== el.value) {
            // W1: the box's month is still opening (just after midnight): its text waits with it
            ctl.update([[bound, { content: el.value }]]);
          }
          grow(el);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) ctl.model.redo();
            else ctl.model.undo();
          }
          e.stopPropagation();
        }}
        onBlur={finish}
      />
    </div>
  );
}

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ---------------------------------------------------------------- images (C8)

export function useAssetUrl(hash: string | undefined): string | null {
  const { services } = useCanvas();
  const [url, setUrl] = useState<string | null>(() => (hash ? services.assets.cachedUrl(hash) ?? null : null));
  useEffect(() => {
    let alive = true;
    if (!hash) return;
    void services.assets.url(hash).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [hash, services]);
  return url;
}

function ImageView({ obj }: { obj: ImageObject }) {
  const url = useAssetUrl(obj.asset);
  const c = obj.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const iw = obj.w / c.w;
  const ih = obj.h / c.h;
  return (
    <div className="cv-obj cv-image" data-id={obj.id} style={{ ...frameStyle(obj), height: obj.h }}>
      {url ? (
        <img src={url} alt={obj.alt ?? ''} draggable={false} style={{ width: iw, height: ih, left: -c.x * iw, top: -c.y * ih }} />
      ) : (
        <div className="cv-missing">Image not on this device yet</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- clips (C9, S8, L13)

function sourceIcon(type: ClipObject['source']['type']) {
  return type === 'book' ? BookOpen : type === 'clipping' ? Globe : type === 'gym' ? FileText : Shapes;
}

function ClipView({ obj }: { obj: ClipObject }) {
  const { services } = useCanvas();
  const ref = useRef<HTMLDivElement>(null);
  const url = useAssetUrl(obj.asset);
  const showImage = !!obj.asset && obj.display !== 'text';
  const showText = !!obj.text && (obj.display !== 'image' || !obj.asset);
  const html = useMemo(() => (showText ? renderMarkdown(obj.text) : ''), [obj.text, showText]);
  const [, bump] = useState(0);
  useEffect(() => services.library.onChange.on(() => bump((x) => x + 1)), [services]);
  const tool = useTools((s) => s.tool);
  useMeasuredHeight(obj, ref, true);
  const s = obj.source;
  // L13: a book or clipping deleted from the library leaves the clip; its badge says so
  const deleted = (s.type === 'book' && !services.library.book(s.id)) || (s.type === 'clipping' && !services.library.clipping(s.id));
  const Icon = deleted ? Link2Off : sourceIcon(s.type);
  const label = s.type === 'book' && s.locator.type === 'pdf' ? `${s.title}, p. ${s.locator.page}` : s.title;
  return (
    <div ref={ref} className={`cv-obj cv-clip${tool === 'text' || tool === 'hand' ? ' selectable' : ''}`} data-id={obj.id} style={frameStyle(obj)}>
      {showImage && (url ? <img src={url} alt={obj.text ? '' : `Clip from ${s.title}`} draggable={false} /> : <div className="cv-missing">Image not on this device yet</div>)}
      {showText && <div className="md cv-md cv-clip-text" {...(tool === 'text' ? { 'data-interactive': '' } : {})} dangerouslySetInnerHTML={{ __html: html }} />}
      <button
        type="button"
        className={`cv-badge${deleted ? ' deleted' : ''}`}
        data-interactive
        title={deleted ? 'The source was deleted from the library' : `Open ${label}`}
        aria-label={deleted ? `Source deleted: ${label}` : `Open source: ${label}`}
        onClick={async () => {
          if (deleted) return toast('Source deleted: the clip keeps its image and text.');
          if (!(await openSource(s))) toast('This source cannot be opened yet.');
        }}
      >
        <Icon size={12} aria-hidden />
        <span>{deleted ? 'source deleted' : label}</span>
      </button>
    </div>
  );
}
