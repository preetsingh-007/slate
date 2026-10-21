/**
 * One canvas, fully usable: in the main pane, or as a second canvas in the side pane (P1).
 * Wires the engine to React: the object layer, overlays, toolbar, dialogs, keyboard
 * shortcuts (C11), paste and drop (S9, S10), the canvas API other areas call (S3, S6, G4) and
 * segment loading as the view moves (R3).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Pt } from '../../core/model/types';
import type { Capture } from '../../core/model/capture';
import { useServices } from '../../app/services';
import { useApp } from '../app/store';
import { makeMark } from '../../core/canvas/marks';
import { uid } from '../../core/util/ids';
import * as registries from '../common/registries';
import { registerCanvasApi, unregisterCanvasApi, type CanvasApi } from '../common/registries';
import { canvasPositionId, readingPosition, saveReadingPosition } from '../../core/library/positions';
import { toast } from '../common/toast';
import { CanvasCtx, setActiveView, isActiveView, getActiveView, type CanvasCtxValue, type TopicTarget } from './context';
import { CanvasController } from './controller';
import { CanvasEngine } from './engine/engine';
import { ObjectLayer } from './ObjectLayer';
import { SelectionOverlay } from './SelectionOverlay';
import { DayLines, FlashLayer, HintBubble, MarksLayer, TagChips } from './Annotations';
import { CropOverlay } from './CropOverlay';
import { Toolbar } from './Toolbar';
import { Minimap } from './Minimap';
import { MarkDialog, TopicDialog, type MarkDraft } from './Dialogs';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  pasteData,
  restack,
  ungroupSelection,
  type ActionCtx,
} from './actions';
import { insertCaptures } from './captures';
import { translateObject } from '../../core/canvas/transform';
import { readingOrder } from '../../core/canvas/clipboard';
import { panBy } from '../../core/canvas/camera';
import { useTools, type Tool } from './toolStore';
import './canvas.css';

const TOOL_KEYS: Record<string, Tool> = { p: 'pen', m: 'highlighter', e: 'eraser', l: 'lasso', t: 'text', s: 'space', h: 'hand' };

/** Test builds expose each open canvas for Playwright (seeding, inspecting, frame timing). */
const testHook: Record<string, { engine: CanvasEngine; ctl: CanvasController; actions: ActionCtx; api: CanvasApi }> = {};
if (import.meta.env.VITE_SLATE_E2E && typeof window !== 'undefined') Object.assign(window, { __slateCanvas: testHook, __slateApp: useApp, __slateRegistries: registries });

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function isEditable(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .dialog');
}

export function CanvasView({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  const services = useServices();
  const root = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLCanvasElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  const viewId = useMemo(() => `${embedded ? 'side' : 'main'}:${slug}:${uid(4)}`, [slug, embedded]);
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const ctl = useMemo(() => new CanvasController(services, slug), [services, slug]);
  const [ready, setReady] = useState(false);
  // requests from other areas (reveal a region or an object) wait for the first view, which
  // would otherwise replace their scroll
  const firstView = useMemo(() => deferred(), [ctl]);

  useLayoutEffect(() => {
    if (!root.current || !display.current || !wet.current) return;
    const e = new CanvasEngine({ root: root.current, display: display.current, wet: wet.current, controller: ctl, prefs: () => services.settings.getPrefs() });
    setEngine(e);
    return () => {
      e.destroy();
      ctl.dispose();
    };
  }, [ctl, services]);

  // size, theme and the first view (C20: just below the latest content)
  useEffect(() => {
    const el = root.current;
    if (!engine || !el) return;
    const measure = () => engine.resize(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    const mo = new MutationObserver(() => engine.resolveColors());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => engine.resolveColors();
    mq.addEventListener('change', onMq);
    let alive = true;
    void (async () => {
      await ctl.loadForView(null);
      if (!alive) return;
      // P3: a canvas in the side pane reopens where it was; the main canvas follows C20
      const saved = embedded ? readingPosition(services.settings, canvasPositionId(slug))?.locator : undefined;
      if (saved?.type === 'canvas' && saved.region.w > 0) {
        const zoom = engine.width ? engine.width / (saved.region.w * engine.base) : 1;
        engine.setCamera({ x: saved.region.x, y: saved.region.y, zoom });
      } else engine.jumpToNow(false);
      await ctl.loadForView(engine.view);
      if (!alive) return;
      firstView.resolve();
      setReady(true);
    })();
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const offSettle = engine.settled.on((v) => {
      void ctl.loadForView({ x: v.x - v.w, y: v.y - v.h, w: v.w * 3, h: v.h * 3 });
      if (!embedded || !engine.width) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const region = { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) };
        void saveReadingPosition(services.settings, canvasPositionId(slug), { type: 'canvas', canvas: slug, region }, services.device);
      }, 1000);
    });
    if (!getActiveView() && !embedded) setActiveView(viewId);
    return () => {
      alive = false;
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener('change', onMq);
      window.removeEventListener('resize', onWin);
      offSettle();
      clearTimeout(saveTimer);
    };
  }, [engine, ctl, embedded, viewId, firstView, services, slug]);

  const [editing, setEditing] = useState<CanvasCtxValue['editing']>(null);
  const [markDialog, setMarkDialog] = useState<{ id?: string } | null>(null);
  const [topics, setTopics] = useState<TopicTarget | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const [minimap, setMinimapState] = useState(services.settings.getPrefs().minimap);
  const armed = useRef<Pt | null>(null);
  const caret = useRef<HTMLDivElement>(null);
  const tool = useTools((s) => s.tool);

  const actions: ActionCtx | null = useMemo(() => (engine ? { engine, ctl, services, slug } : null), [engine, ctl, services, slug]);

  const openTopics = useCallback((t: TopicTarget) => setTopics(t), []);
  const ctx: CanvasCtxValue | null = useMemo(
    () =>
      engine && actions
        ? {
            engine,
            ctl,
            services,
            slug,
            actions,
            embedded,
            editing,
            setEditing,
            openMarkDialog: (id?: string) => setMarkDialog({ id }),
            openTopics,
            cropping,
            setCropping,
          }
        : null,
    [engine, actions, ctl, services, slug, embedded, editing, openTopics, cropping],
  );

  // text requests from taps and double taps
  useEffect(() => {
    if (!engine) return;
    const offText = engine.textRequest.on(({ at, id }) => {
      engine.clearSelection();
      setEditing(id ? { id } : { at: { x: at.x, y: at.y - 12 } });
    });
    const offTap = engine.tapEmpty.on((p) => {
      armed.current = p;
      placeCaret();
    });
    const offSel = engine.selection.on(() => {
      armed.current = null;
      placeCaret();
    });
    const offFrame = engine.frame.on(placeCaret);
    return () => {
      offText();
      offTap();
      offSel();
      offFrame();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const placeCaret = () => {
    const el = caret.current;
    if (!el || !engine) return;
    const p = armed.current;
    const t = useTools.getState().tool;
    if (!p || editing || (t !== 'lasso' && t !== 'hand' && t !== 'text')) {
      el.style.display = 'none';
      return;
    }
    const k = engine.pxPerUnit;
    el.style.display = '';
    el.style.transform = `translate(${(p.x - engine.camera.x) * k}px, ${(p.y - engine.camera.y) * k - 10}px)`;
  };

  // the canvas API other areas call (S3, S6, G4)
  useEffect(() => {
    if (!engine || !actions) return;
    const api: CanvasApi = {
      insertCaptures: (caps: Capture[], at?: { x: number; y: number }) => insertCaptures(actions, caps, at),
      revealObject: (id: string) => {
        void (async () => {
          await firstView.promise;
          if (!ctl.model.has(id)) await ctl.loadAll();
          const o = ctl.get(id);
          if (!o) return toast('That item is no longer on the canvas.');
          engine.select([id]);
          engine.revealRegion(ctl.boundsOf([id])!);
        })();
      },
      revealRegion: (r) => {
        void firstView.promise.then(() => ctl.loadForView(r)).then(() => engine.revealRegion(r));
      },
      clientToCanvas: (x, y) => engine.clientToCanvas(x, y),
      embedded,
    };
    registerCanvasApi(slug, api);
    if (!embedded || !testHook[slug]) testHook[slug] = { engine, ctl, actions, api };
    if (embedded) testHook[`side:${slug}`] = { engine, ctl, actions, api };
    return () => {
      unregisterCanvasApi(slug, api);
      if (testHook[slug]?.engine === engine) delete testHook[slug];
      if (testHook[`side:${slug}`]?.engine === engine) delete testHook[`side:${slug}`];
    };
  }, [engine, actions, ctl, slug, embedded, firstView]);

  // keyboard (C11), clipboard (C15, S9) — only for the canvas used last
  useEffect(() => {
    if (!engine || !actions) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isActiveView(viewId) || e.defaultPrevented) return;
      if (markDialog || topics || isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const sel = engine.getSelection();
      // typing on an empty spot starts a text box there (C7)
      if (armed.current && k.length === 1 && !mod && !e.altKey && k !== ' ') {
        e.preventDefault();
        setEditing({ at: armed.current, initial: k });
        armed.current = null;
        placeCaret();
        return;
      }
      if (k === ' ' && !(e.target instanceof HTMLButtonElement)) {
        if (!e.repeat) engine.spaceKey = true;
        e.preventDefault();
        return;
      }
      if (mod) {
        const key = k.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) ctl.model.redo();
          else ctl.model.undo();
        } else if (key === 'y') {
          e.preventDefault();
          ctl.model.redo();
        } else if ((key === 'c' || key === 'x') && sel.length && !window.getSelection()?.toString()) {
          e.preventDefault();
          void copySelection(actions, key === 'x');
        } else if (key === 'd' && sel.length) {
          e.preventDefault();
          duplicateSelection(actions);
        } else if (key === 'g') {
          e.preventDefault();
          if (e.shiftKey) ungroupSelection(actions);
          else groupSelection(actions);
        } else if (key === 'a') {
          e.preventDefault();
          engine.select([...ctl.model.query(engine.view)].filter((o) => !(o.kind === 'stroke' && o.beautifiedInto)).map((o) => o.id));
        } else if (key === '0') {
          e.preventDefault();
          engine.zoomAtScreen(1);
        } else if (key === '=' || key === '+') {
          e.preventDefault();
          engine.zoomBy(1.25);
        } else if (key === '-') {
          e.preventDefault();
          engine.zoomBy(0.8);
        }
        return;
      }
      if (e.altKey && !k.startsWith('Arrow')) return;
      if (k === 'Escape') {
        if (cropping) setCropping(null);
        else engine.clearSelection();
        armed.current = null;
        placeCaret();
        return;
      }
      if ((k === 'Delete' || k === 'Backspace') && sel.length) {
        e.preventDefault();
        deleteSelection(actions);
        return;
      }
      if (k === ']' || k === '[') {
        restack(actions, k === ']' ? 1 : -1);
        return;
      }
      if (k === 'Home') {
        engine.jumpToNow();
        return;
      }
      if (e.shiftKey && e.code === 'Digit1') {
        void engine.fitAll();
        return;
      }
      if (e.shiftKey && e.code === 'Digit2') {
        engine.fitSelection();
        return;
      }
      if (k === 'Enter' && sel.length === 1 && ctl.get(sel[0])?.kind === 'text') {
        e.preventDefault();
        setEditing({ id: sel[0] });
        return;
      }
      if (e.altKey && (k === 'ArrowRight' || k === 'ArrowLeft')) {
        // keyboard selection: the next or previous object in view, in reading order
        e.preventDefault();
        const inView = readingOrder(ctl.model.query(engine.view).filter((o) => !(o.kind === 'stroke' && o.beautifiedInto)));
        if (!inView.length) return;
        const cur = inView.findIndex((o) => o.id === sel[0]);
        const next = cur < 0 ? (k === 'ArrowRight' ? 0 : inView.length - 1) : (cur + (k === 'ArrowRight' ? 1 : -1) + inView.length) % inView.length;
        engine.select([inView[next].id]);
        return;
      }
      if (k.startsWith('Arrow')) {
        e.preventDefault();
        const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        if (sel.length) {
          const step = (e.shiftKey ? 20 : 2) / engine.pxPerUnit;
          ctl.update(ctl.objectsOf(sel).map((o) => [o.id, translateObject(o, dx * step, dy * step)] as [string, Record<string, unknown>]));
        } else engine.setCamera(panBy(engine.camera, engine.base, -dx * engine.width * 0.1, -dy * engine.height * 0.1));
        return;
      }
      if (k === '?') {
        setHelpSignal((x) => x + 1);
        return;
      }
      const t = TOOL_KEYS[k.toLowerCase()];
      if (t) {
        const tools = useTools.getState();
        if (e.shiftKey && t === 'eraser') tools.setEraserMode(tools.eraserMode === 'stroke' ? 'partial' : 'stroke');
        if (e.shiftKey && t === 'lasso') tools.setLassoMode(tools.lassoMode === 'free' ? 'rect' : 'free');
        tools.setTool(t);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') engine.spaceKey = false;
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!isActiveView(viewId) || isEditable(e.target) || !e.clipboardData) return;
      e.preventDefault();
      void pasteData(actions, e.clipboardData, null).then((ok) => !ok && toast('Nothing to paste.'));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, actions, ctl, viewId, markDialog, topics, cropping]);

  const [helpSignal, setHelpSignal] = useState(0);

  // drop from other apps (S10)
  const onDragOver = (e: React.DragEvent) => {
    const types = [...e.dataTransfer.types];
    if (types.some((t) => t === 'Files' || t === 'text/plain' || t === 'text/uri-list' || t === 'text/html')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!engine || !actions) return;
    e.preventDefault();
    setActiveView(viewId);
    const at = engine.clientToCanvas(e.clientX, e.clientY);
    void pasteData(actions, e.dataTransfer, at);
  };

  const mark = markDialog?.id ? ctl.model.mark(markDialog.id) : undefined;
  const saveMark = (d: MarkDraft) => {
    if (!engine) return;
    if (mark) {
      ctl.model.transact((tx) => tx.setMark({ ...mark, kind: d.kind, topic: d.topic.trim(), problem: d.kind === 'solution' ? d.problem.trim() : '', comment: d.comment.trim() }));
    } else {
      const objs = ctl.objectsOf(engine.getSelection());
      const m = makeMark(uid(), objs, d, Date.now());
      if (!m) return toast('Select something to mark first.');
      ctl.model.transact((tx) => tx.setMark(m));
      toast(`Marked as ${d.kind} for gym`);
    }
    setMarkDialog(null);
  };

  const topicInitial = (t: TopicTarget): string[] => {
    if (t.kind === 'canvas') return services.canvases.meta(slug)?.topics ?? [];
    if (t.kind === 'day') return ctl.model.dayTopics(t.date!);
    const all = new Set<string>();
    for (const o of ctl.objectsOf(t.ids ?? [])) for (const x of o.topics ?? []) all.add(x);
    return [...all];
  };
  const saveTopics = (t: TopicTarget, list: string[]) => {
    if (t.kind === 'canvas') void services.canvases.update(slug, { topics: list });
    else if (t.kind === 'day') ctl.model.transact((tx) => tx.setDayTopics(t.date!, list));
    else ctl.update((t.ids ?? []).map((id) => [id, { topics: list }] as [string, Record<string, unknown>]));
    setTopics(null);
  };

  return (
    <div
      className={`cv-view${embedded ? ' embedded' : ''}`}
      onPointerDownCapture={() => setActiveView(viewId)}
      onFocusCapture={() => setActiveView(viewId)}
      data-canvas={slug}
      data-ready={ready ? 'true' : 'false'}
    >
      {ctx && (
        <CanvasCtx.Provider value={ctx}>
          <Toolbar
            minimap={minimap}
            helpSignal={helpSignal}
            setMinimap={(v) => {
              setMinimapState(v);
              void services.settings.setPrefs({ minimap: v });
            }}
          />
        </CanvasCtx.Provider>
      )}
      <div
        ref={root}
        className={`cv-root tool-${tool}`}
        tabIndex={0}
        role="application"
        aria-label={`Canvas ${services.canvases.meta(slug)?.title ?? slug}`}
        aria-roledescription="canvas"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <canvas ref={display} className="cv-ink" aria-hidden />
        <canvas ref={wet} className="cv-wet" aria-hidden />
        {ctx && (
          <CanvasCtx.Provider value={ctx}>
            <ObjectLayer />
            <div className="cv-overlay">
              <DayLines />
              <TagChips />
              <MarksLayer onOpen={(id) => openMark(id)} />
              <FlashLayer />
              <SelectionOverlay />
              <CropOverlay />
              <div ref={caret} className="cv-caret" style={{ display: 'none' }} aria-hidden />
            </div>
            {minimap && <Minimap />}
            <HintBubble />
          </CanvasCtx.Provider>
        )}
      </div>
      {ctx && markDialog && (
        <CanvasCtx.Provider value={ctx}>
          <MarkDialog
            initial={mark}
            onClose={() => setMarkDialog(null)}
            onSave={saveMark}
            onRemove={
              mark
                ? () => {
                    ctl.model.transact((tx) => tx.removeMark(mark.id));
                    setMarkDialog(null);
                  }
                : undefined
            }
          />
        </CanvasCtx.Provider>
      )}
      {ctx && topics && (
        <TopicDialog
          title={topics.kind === 'canvas' ? 'Canvas topics' : topics.kind === 'day' ? `Topics of ${topics.date}` : 'Tag with topics'}
          initial={topicInitial(topics)}
          onClose={() => setTopics(null)}
          onSave={(list) => saveTopics(topics, list)}
        />
      )}
    </div>
  );

  function openMark(id: string) {
    const rec = services.formalized.get(id);
    if (rec?.dismissed) return toast(`Dismissed in gym on ${rec.date}.`);
    if (rec) return;
    setMarkDialog({ id });
  }
}
