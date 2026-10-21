/**
 * A clipping in the side pane (L7, L8, L9, L11, S1, S2, S6, S7): Reader view (the article or
 * pasted answer as rendered Markdown, or plain text) and, for link clippings, the Original view
 * (the saved page in the sandboxed frame). The content is read-only; highlights and notes go on
 * top, anchored with text quotes so they show in both views where the text matches.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileCode2, Highlighter, Lasso, MousePointer2, NotebookPen, StickyNote, X } from 'lucide-react';
import type { Annotation, ClippingLocator, ClippingMeta, PaneTab } from '../../../core/model/types';
import type { Capture } from '../../../core/model/capture';
import type { ClippingContent } from '../../../core/stores/library';
import type { ClipRef } from '../../../core/stores/canvases';
import { HIGHLIGHT_COLORS, newAnnotation, putAnnotation, removeAnnotation } from '../../../core/library/annotations';
import { readingPosition, saveReadingPosition } from '../../../core/library/positions';
import { prepareSnapshotHtml } from '../../../core/library/snapshot';
import { htmlToMarkdown, nodeToMarkdown } from '../../../core/html/toMarkdown';
import { renderMarkdown } from '../../../core/markdown/render';
import { findQuote, makeQuote } from '../../../core/locators/textQuote';
import { uid } from '../../../core/util/ids';
import { useServices } from '../../../app/services';
import { toast } from '../../common/toast';
import { getTopicPicker } from '../../common/registries';
import type { PaneProps } from '../../panes/registry';
import { rasterizeRegion } from '../../sources/rasterize';
import type { LassoResult } from '../../sources/LassoOverlay';
import { ClipList, ClipMark } from '../ClipMarks';
import { useAnnotations, useClipRefs, useClipping, useLocalPref } from '../hooks';
import { useLibraryUi } from '../state';
import { buildTextMap, hitInPolygon, rangeFragment, offsetOf, rangeFromOffsets, rangeRectsIn, type TextMap } from '../textMap';
import { HighlightMenu, LassoHost, NoteEditor, SelectionMenu, copyText } from '../viewerParts';
import { AnnotationList } from '../pdf/PdfViewer';
import { SnapshotFrame, type FrameController, type FrameHighlight, type FrameMark } from './SnapshotFrame';

type View = 'reader' | 'original';
type Tool = 'select' | 'highlight' | 'lasso';

export function ClippingPane({ tab }: PaneProps<Extract<PaneTab, { kind: 'clipping' }>>) {
  const meta = useClipping(tab.id);
  const { library } = useServices();
  const [content, setContent] = useState<ClippingContent | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void library.clippingContent(tab.id).then((c) => alive && setContent(c));
    return () => {
      alive = false;
    };
  }, [library, tab.id]);
  if (!meta) return <div className="empty">This clipping was deleted.</div>;
  if (content === undefined) return <div className="empty">Opening…</div>;
  if (!content) return <div className="empty">The content of this clipping is not on this device yet. It downloads with the next sync.</div>;
  return <ClippingView meta={meta} content={content} />;
}

/** Rewrites rendered Markdown for the Reader view: local assets as blob URLs, no remote images. */
async function readerHtml(markdown: string, assetUrl: (hash: string) => Promise<string | null>): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${renderMarkdown(markdown)}</body>`, 'text/html');
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const rel = img.getAttribute('data-rel-src');
    const hash = rel ? /^assets\/([0-9a-f]{16,64})\.[a-z0-9]+$/.exec(rel)?.[1] : undefined;
    const url = hash ? await assetUrl(hash) : null;
    if (url) {
      img.setAttribute('src', url);
      img.removeAttribute('data-rel-src');
      continue;
    }
    // the app loads nothing from other sites: remote images become links
    const src = img.getAttribute('src');
    const alt = img.getAttribute('alt') || 'image';
    const a = doc.createElement(src && /^https?:/.test(src) ? 'a' : 'span');
    a.textContent = `[${alt}]`;
    if (src && /^https?:/.test(src)) {
      a.setAttribute('href', src);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    img.replaceWith(a);
  }
  return doc.body.innerHTML;
}

function ClippingView({ meta, content }: { meta: ClippingMeta; content: ClippingContent }) {
  const services = useServices();
  const { library, assets, settings, device } = services;
  const hasOriginal = !!content.snapshotHtml;
  const [view, setView] = useLocalPref<View>(`slate-clip-view:${meta.id}`, 'reader');
  const shownView: View = view === 'original' && hasOriginal ? 'original' : 'reader';
  const [tool, setTool] = useState<Tool>('select');
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const [drawer, setDrawer] = useState(false);
  const [title, setTitle] = useState(meta.title);
  const { doc: annDoc, list: annotations } = useAnnotations(meta.id);
  const clipRefs = useClipRefs(meta.id);
  const jump = useLibraryUi((s) => s.jumps[meta.id]);
  const [selection, setSelection] = useState<{ start: number; end: number; text: string; anchor: DOMRect } | null>(null);
  const [hlMenu, setHlMenu] = useState<{ a: Annotation; anchor: DOMRect } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ a: Annotation; anchor: DOMRect; isNew: boolean } | null>(null);
  const [markList, setMarkList] = useState<{ clips: ClipRef[]; anchor: DOMRect } | null>(null);

  useEffect(() => setTitle(meta.title), [meta.title]);
  // the toggle answers at once; the stored setting follows
  const [scriptsOn, setScriptsOn] = useState(!!meta.scripts);
  useEffect(() => setScriptsOn(!!meta.scripts), [meta.scripts]);

  const saveMeta = (patch: Partial<ClippingMeta>) => void library.putClipping({ ...meta, ...patch });

  // ---------------------------------------------------------------- Reader view
  const scroll = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [map, setMap] = useState<TextMap | null>(null);
  useEffect(() => {
    if (meta.format === 'plain') return setHtml(null);
    let alive = true;
    void readerHtml(content.markdown, (h) => assets.url(h)).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [content.markdown, meta.format, assets]);
  useLayoutEffect(() => {
    if (shownView !== 'reader' || !article.current) return setMap(null);
    setMap(buildTextMap(article.current));
  }, [shownView, html, meta.format]);

  // ---------------------------------------------------------------- Original view
  const frame = useRef<FrameController | null>(null);
  const [frameText, setFrameText] = useState<string | null>(null);
  // a (re)loaded frame has no text until it says so: jumps and anchors wait for it
  useEffect(() => setFrameText(null), [shownView, meta.scripts]);
  const prepared = useMemo(() => (content.snapshotHtml ? prepareSnapshotHtml(content.snapshotHtml, !!meta.scripts) : ''), [content.snapshotHtml, meta.scripts]);
  const [frameAssets, setFrameAssets] = useState<Record<string, Blob> | null>(null);
  useEffect(() => {
    if (shownView !== 'original') return;
    let alive = true;
    void (async () => {
      const out: Record<string, Blob> = {};
      for (const a of content.assets) {
        const b = await assets.get(a.hash);
        if (b) out[a.path.replace(/^assets\//, '')] = b.type ? b : new Blob([b], { type: a.mime });
      }
      if (alive) setFrameAssets(out);
    })();
    return () => {
      alive = false;
    };
  }, [shownView, content.assets, assets]);

  /** Text of the current view (anchors are quotes in it). */
  const viewText = shownView === 'original' ? frameText : (map?.text ?? null);

  // ---------------------------------------------------------------- anchoring
  const anchor = useCallback(
    (loc: ClippingLocator, text: string): { start: number; end: number; exact: boolean } | null => {
      const hint = loc.view === shownView ? loc.offset : undefined;
      const m = loc.quote.exact ? findQuote(text, loc.quote, hint) : null;
      return m ? { start: m.start, end: m.end, exact: m.exact } : null;
    },
    [shownView],
  );

  const placed = useMemo(() => {
    if (viewText == null) return { highlights: [] as FrameHighlight[], notes: [] as { a: Annotation; start: number; end: number }[], marks: [] as { clips: ClipRef[]; start: number; end: number }[] };
    const highlights: FrameHighlight[] = [];
    const notes: { a: Annotation; start: number; end: number }[] = [];
    for (const a of annotations) {
      if (a.locator.type !== 'clipping') continue;
      const m = anchor(a.locator, viewText);
      if (!m) continue;
      if (a.kind === 'highlight') highlights.push({ id: a.id, start: m.start, end: m.end, color: a.color });
      else if (a.kind === 'note') notes.push({ a, start: m.start, end: m.end });
    }
    const marks: { clips: ClipRef[]; start: number; end: number }[] = [];
    for (const c of clipRefs) {
      const l = c.clip.source.locator;
      if (l.type !== 'clipping') continue;
      const m = anchor(l, viewText);
      const start = m?.start ?? Math.min(l.offset, viewText.length);
      const end = m?.end ?? Math.min(viewText.length, start + l.quote.exact.length);
      const last = marks[marks.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
        last.clips.push(c);
      } else marks.push({ clips: [c], start, end });
    }
    marks.sort((a, b) => a.start - b.start);
    return { highlights, notes, marks };
  }, [annotations, clipRefs, viewText, anchor]);

  // reader overlays (rects relative to the scroll container)
  const [layoutTick, setLayoutTick] = useState(0);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [flash, setFlash] = useState<{ start: number; end: number; nonce: number } | null>(null);
  const readerOverlay = useMemo(() => {
    void layoutTick;
    const el = scroll.current;
    if (!map || !el || shownView !== 'reader') return null;
    const rectsFor = (s: number, e: number) => {
      const r = rangeFromOffsets(map, s, e);
      return r ? rangeRectsIn(r, el) : [];
    };
    return {
      highlights: placed.highlights.flatMap((h) => rectsFor(h.start, h.end).map((r) => ({ ...r, id: h.id, color: h.color }))),
      notes: placed.notes.map((n) => ({ a: n.a, y: rectsFor(n.start, n.end)[0]?.y ?? 0 })),
      marks: placed.marks.map((m) => {
        const rs = rectsFor(m.start, m.end);
        const y = rs[0]?.y ?? 0;
        return { clips: m.clips, y, h: rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h - y : 16 };
      }),
      flash: flash ? rectsFor(flash.start, flash.end) : [],
    };
  }, [map, placed, shownView, layoutTick, flash]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2100);
    return () => clearTimeout(t);
  }, [flash]);

  const reveal = useCallback(
    (start: number, end: number) => {
      if (shownView === 'original') return frame.current?.reveal(start, end);
      const el = scroll.current;
      if (!map || !el) return;
      const r = rangeFromOffsets(map, start, end);
      if (!r) return;
      const b = r.getBoundingClientRect();
      el.scrollTo({ top: Math.max(0, b.top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight / 3) });
      setFlash({ start, end, nonce: Date.now() });
    },
    [map, shownView],
  );

  // ---------------------------------------------------------------- S6: jumps
  useEffect(() => {
    if (!jump || jump.locator.type !== 'clipping') return;
    const want: View = jump.locator.view === 'original' && hasOriginal ? 'original' : 'reader';
    if (want !== shownView) return setView(want);
    if (viewText == null) return; // wait for the view's text
    const j = useLibraryUi.getState().takeJump(meta.id);
    if (!j || j.locator.type !== 'clipping') return;
    const loc = j.locator;
    const m = findQuote(viewText, loc.quote, loc.offset);
    if (m) {
      if (!m.exact) toast('The exact text was not found; showing the closest match.');
      requestAnimationFrame(() => reveal(m.start, m.end));
    } else {
      // character offset as the fallback (S5)
      const start = Math.min(loc.offset, Math.max(0, viewText.length - 1));
      toast('The quoted text was not found; showing the saved position.');
      requestAnimationFrame(() => reveal(start, Math.min(viewText.length, start + Math.max(1, loc.quote.exact.length))));
    }
  }, [jump, shownView, viewText, hasOriginal, meta.id, reveal, setView]);

  // ---------------------------------------------------------------- reading position
  const posTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savePos = (fraction: number) => {
    clearTimeout(posTimer.current);
    posTimer.current = setTimeout(() => void saveReadingPosition(settings, meta.id, { type: 'scroll', fraction: Math.round(fraction * 1000) / 1000 }, device), 800);
  };
  useEffect(() => () => clearTimeout(posTimer.current), []);
  const savedFraction = useMemo(() => {
    const p = readingPosition(settings, meta.id)?.locator;
    return p?.type === 'scroll' ? p.fraction : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (restored.current || !el || shownView !== 'reader' || (meta.format !== 'plain' && html == null)) return;
    restored.current = true;
    if (useLibraryUi.getState().jumps[meta.id]) return;
    el.scrollTop = savedFraction * (el.scrollHeight - el.clientHeight);
  }, [html, shownView, meta.format, meta.id, savedFraction]);

  // ---------------------------------------------------------------- selection (L11)
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const hlColorRef = useRef(hlColor);
  hlColorRef.current = hlColor;

  const locator = (text: string, start: number, end: number, region?: ClippingLocator['region']): ClippingLocator => {
    const l: ClippingLocator = { type: 'clipping', quote: makeQuote(text, start, end), offset: start, view: shownView };
    if (region) l.region = region;
    return l;
  };
  const addHighlight = (s: { start: number; end: number; text: string }, color: string) => {
    if (!annDoc || viewText == null) return;
    putAnnotation(annDoc, newAnnotation('highlight', locator(viewText, s.start, s.end), { color, text: s.text.slice(0, 500) }));
  };
  const onSelected = (s: { start: number; end: number; text: string; anchor: DOMRect } | null) => {
    if (!s) return setSelection(null);
    if (toolRef.current === 'highlight') {
      addHighlight(s, hlColorRef.current);
      window.getSelection()?.removeAllRanges();
      return setSelection(null);
    }
    setSelection(s);
  };
  useEffect(() => {
    const el = scroll.current;
    if (!el || shownView !== 'reader') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        const host = article.current;
        if (!s || s.isCollapsed || !s.rangeCount || !host || !map) return onSelected(null);
        const r = s.getRangeAt(0);
        if (!host.contains(r.startContainer)) return onSelected(null);
        const start = offsetOf(map, r.startContainer, r.startOffset);
        const end = host.contains(r.endContainer) ? offsetOf(map, r.endContainer, r.endOffset) : map.text.length;
        if (end <= start) return onSelected(null);
        onSelected({ start, end, text: map.text.slice(start, end), anchor: r.getBoundingClientRect() });
      }, 60);
    };
    el.addEventListener('pointerup', check);
    el.addEventListener('keyup', check);
    return () => {
      el.removeEventListener('pointerup', check);
      el.removeEventListener('keyup', check);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownView, map, annDoc]);

  const onReaderClick = (e: React.MouseEvent) => {
    if (window.getSelection()?.isCollapsed === false || !readerOverlay || !scroll.current) return;
    const sb = scroll.current.getBoundingClientRect();
    const x = e.clientX - sb.left + scroll.current.scrollLeft;
    const y = e.clientY - sb.top + scroll.current.scrollTop;
    const hit = readerOverlay.highlights.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    const a = hit && annotations.find((x) => x.id === hit.id);
    if (a) setHlMenu({ a, anchor: new DOMRect(e.clientX, e.clientY, 1, 1) });
  };

  // ---------------------------------------------------------------- lasso → capture (S1, S2, S5)
  const source = (locator: ClippingLocator): Capture['source'] => ({ type: 'clipping', id: meta.id, title: meta.title, locator, capturedAt: Date.now(), contentHash: meta.contentHash });

  const onReaderLasso = async ({ points, rect }: LassoResult) => {
    const host = article.current;
    const el = scroll.current;
    if (!host || !el || !map) return;
    const hit = hitInPolygon(host, map, points);
    const sb = el.getBoundingClientRect();
    const region = {
      x: (rect.left - sb.left + el.scrollLeft) / Math.max(1, el.scrollWidth),
      y: (rect.top - sb.top + el.scrollTop) / Math.max(1, el.scrollHeight),
      w: rect.width / Math.max(1, el.scrollWidth),
      h: rect.height / Math.max(1, el.scrollHeight),
    };
    const text = hit ? (meta.format === 'plain' ? map.text.slice(hit.start, hit.end) : nodeToMarkdown(rangeFragment(hit.range, host))) : '';
    const loc = hit ? locator(map.text, hit.start, hit.end, region) : { type: 'clipping' as const, quote: { exact: '', prefix: '', suffix: '' }, offset: 0, view: 'reader' as const, region };
    const image = await rasterizeRegion(host, rect, 2);
    const capture: Capture = { id: uid(), text, source: source(loc), created: Date.now() };
    if (image) {
      capture.image = image.blob;
      capture.imageSize = { w: Math.round(image.w), h: Math.round(image.h) };
    }
    if (!capture.text && !capture.image) return toast('Nothing was captured.');
    useLibraryUi.getState().addCapture(capture, { x: rect.right + 12, y: rect.top });
  };

  const onOriginalLasso = async ({ points, rect }: LassoResult) => {
    const r = await frame.current?.capture(points, 2);
    if (!r) return toast('Nothing was captured.');
    const text = r.start >= 0 && r.html ? htmlToMarkdown(r.html, { baseUrl: meta.canonicalUrl ?? meta.url, image: () => null }) : '';
    const region = { x: r.rect.x / Math.max(1, r.docW), y: r.rect.y / Math.max(1, r.docH), w: r.rect.w / Math.max(1, r.docW), h: r.rect.h / Math.max(1, r.docH) };
    const loc: ClippingLocator =
      r.start >= 0 && frameText != null ? locator(frameText, r.start, r.end, region) : { type: 'clipping', quote: { exact: '', prefix: '', suffix: '' }, offset: 0, view: 'original', region };
    const capture: Capture = { id: uid(), text, source: source(loc), created: Date.now() };
    if (r.image) {
      capture.image = r.image;
      capture.imageSize = r.imageSize;
    }
    if (!capture.text && !capture.image) return toast('Nothing was captured.');
    useLibraryUi.getState().addCapture(capture, { x: rect.right + 12, y: rect.top });
  };

  // ---------------------------------------------------------------- render
  const TopicPicker = getTopicPicker();
  const frameMarks: FrameMark[] = useMemo(
    () => placed.marks.map((m, i) => ({ key: String(i), start: m.start, end: m.end, label: m.clips.length === 1 ? '1 clip from here' : `${m.clips.length} clips from here` })),
    [placed.marks],
  );
  const frameHighlights: FrameHighlight[] = useMemo(
    () => [...placed.highlights, ...placed.notes.map((n) => ({ id: n.a.id, start: n.start, end: n.end, color: 'transparent', note: n.a.text || 'Note' }))],
    [placed.highlights, placed.notes],
  );
  const toolBtn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button className="icon-btn" aria-label={label} title={label} aria-pressed={tool === t} onClick={() => setTool(tool === t && t !== 'select' ? 'select' : t)}>
      {icon}
    </button>
  );

  return (
    <div className="viewer clipping" data-testid="clipping-pane">
      <header className="clip-head">
        <input
          className="clip-title"
          aria-label="Clipping title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== meta.title && saveMeta({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="clip-meta muted small">
          {meta.sourceLabel && <span className="chip">{meta.sourceLabel}</span>}
          {meta.site && <span>{meta.site}</span>}
          {meta.author && <span>{meta.author}</span>}
          {meta.published && <span>{meta.published.slice(0, 10)}</span>}
          {(meta.canonicalUrl ?? meta.url) && (
            <a href={meta.canonicalUrl ?? meta.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> {new URL(meta.canonicalUrl ?? meta.url!).hostname}
            </a>
          )}
          {meta.fetched && <span title="Saved">saved {new Date(meta.fetched).toLocaleDateString()}</span>}
        </div>
      </header>
      <div className="viewer-bar" role="toolbar" aria-label="Clipping tools">
        {hasOriginal && (
          <span className="seg" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={shownView === 'reader'} onClick={() => setView('reader')}>
              Reader
            </button>
            <button role="radio" aria-checked={shownView === 'original'} onClick={() => setView('original')}>
              Original
            </button>
          </span>
        )}
        {shownView === 'reader' && (
          <span className="seg" role="radiogroup" aria-label="Format">
            <button role="radio" aria-checked={meta.format === 'markdown'} onClick={() => saveMeta({ format: 'markdown' })}>
              Markdown
            </button>
            <button role="radio" aria-checked={meta.format === 'plain'} onClick={() => saveMeta({ format: 'plain' })}>
              Plain text
            </button>
          </span>
        )}
        {shownView === 'original' && (
          <label className="toggle small" title="Run the page's own scripts inside the sandbox">
            <input
              type="checkbox"
              checked={scriptsOn}
              onChange={(e) => {
                setScriptsOn(e.target.checked);
                saveMeta({ scripts: e.target.checked });
              }}
            />
            <FileCode2 size={14} /> Scripts
          </label>
        )}
        <span className="bar-sep" />
        {toolBtn('select', 'Select text', <MousePointer2 size={18} />)}
        {toolBtn('highlight', 'Highlight text', <Highlighter size={18} />)}
        {tool === 'highlight' && (
          <span className="swatches" role="radiogroup" aria-label="Highlight colour">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.id} role="radio" aria-checked={hlColor === c.value} aria-label={c.label} className="swatch" style={{ background: c.value }} onClick={() => setHlColor(c.value)} />
            ))}
          </span>
        )}
        {toolBtn('lasso', 'Lasso', <Lasso size={18} />)}
        <span className="spacer" />
        <button className="icon-btn" aria-label="Annotations" title="Annotations" aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
          <NotebookPen size={18} />
        </button>
      </div>
      <div className="viewer-main">
        {drawer && (
          <aside className="viewer-drawer" aria-label="Annotations">
            <div className="drawer-head">
              <strong>Annotations</strong>
              <button className="icon-btn small" aria-label="Close panel" onClick={() => setDrawer(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="drawer-body">
              <div className="field">
                <span>Topics</span>
                <TopicTags topics={meta.topics ?? []} onChange={(topics) => saveMeta({ topics })} Picker={TopicPicker} />
              </div>
            </div>
            <AnnotationList
              annotations={annotations}
              onPick={(a) => {
                if (a.locator.type !== 'clipping' || viewText == null) return;
                const m = anchor(a.locator, viewText);
                if (m) reveal(m.start, m.end);
              }}
              onRemove={(a) => annDoc && removeAnnotation(annDoc, a.id)}
            />
          </aside>
        )}
        {shownView === 'reader' ? (
          <div ref={scroll} className="clip-scroll" tabIndex={0} aria-label={meta.title} onScroll={(e) => {
            const el = e.currentTarget;
            savePos(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0);
          }} onClick={onReaderClick}>
            <LassoHost scrollRef={scroll} active={tool === 'lasso'} onLasso={(r) => void onReaderLasso(r)} />
            {readerOverlay && (
              <div className="hl-layer" aria-hidden data-no-text>
                {readerOverlay.highlights.map((r, i) => (
                  <div key={i} className="hl-rect" style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: r.color }} />
                ))}
                {readerOverlay.flash.map((r, i) => (
                  <div key={`f${i}`} className="lib-flash" data-testid="flash" style={{ left: r.x - 2, top: r.y - 2, width: r.w + 4, height: r.h + 4 }} />
                ))}
              </div>
            )}
            {meta.format === 'plain' ? (
              <div ref={article} className="clip-article">
                <pre className="clip-plain">{content.markdown}</pre>
              </div>
            ) : (
              <div ref={article} className="clip-article md" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
            )}
            {readerOverlay?.notes.map((n) => (
              <button
                key={n.a.id}
                className="margin-note"
                style={{ top: n.y }}
                aria-label={`Margin note: ${n.a.text || 'empty'}`}
                title={n.a.text}
                data-testid="margin-note"
                onClick={(e) => {
                  e.stopPropagation();
                  setNoteEdit({ a: n.a, anchor: e.currentTarget.getBoundingClientRect(), isNew: false });
                }}
              >
                <StickyNote size={14} />
              </button>
            ))}
            {readerOverlay?.marks.map((m, i) => <ClipMark key={i} clips={m.clips} className="html-mark" style={{ top: m.y, height: Math.max(12, m.h) }} />)}
          </div>
        ) : frameAssets ? (
          <SnapshotFrame
            html={prepared}
            assets={frameAssets}
            scripts={!!meta.scripts}
            fraction={savedFraction}
            key={meta.scripts ? 'scripts' : 'static'}
            highlights={frameHighlights}
            marks={frameMarks}
            lasso={tool === 'lasso'}
            controller={frame}
            onLoaded={() => void frame.current?.text().then(setFrameText)}
            onLink={(href) => window.open(href, '_blank', 'noopener,noreferrer')}
            onSelection={(s) => onSelected(s ? { start: s.start, end: s.end, text: s.text, anchor: s.rect } : null)}
            onHighlightClick={(id, rect) => {
              const a = annotations.find((x) => x.id === id);
              if (a) setHlMenu({ a, anchor: rect });
            }}
            onNoteClick={(id, rect) => {
              const a = annotations.find((x) => x.id === id);
              if (a) setNoteEdit({ a, anchor: rect, isNew: false });
            }}
            onMarkClick={(key, rect) => {
              const m = placed.marks[Number(key)];
              if (m) setMarkList({ clips: m.clips, anchor: rect });
            }}
            onScroll={savePos}
            onLasso={(r) => void onOriginalLasso(r)}
          />
        ) : (
          <div className="empty">Opening the saved page…</div>
        )}
      </div>
      {selection && (
        <SelectionMenu
          anchor={selection.anchor}
          onClose={() => setSelection(null)}
          onHighlight={(c) => {
            addHighlight(selection, c);
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
          onNote={() => {
            const s = selection;
            setSelection(null);
            if (viewText == null) return;
            setNoteEdit({ a: newAnnotation('note', locator(viewText, s.start, s.end), { text: '' }), anchor: s.anchor, isNew: true });
          }}
          onCopy={() => {
            copyText(selection.text);
            setSelection(null);
          }}
        />
      )}
      {hlMenu && (
        <HighlightMenu
          anchor={hlMenu.anchor}
          onClose={() => setHlMenu(null)}
          onColor={(c) => {
            if (annDoc) putAnnotation(annDoc, { ...hlMenu.a, color: c });
            setHlMenu(null);
          }}
          onNote={() => {
            const h = hlMenu.a;
            setHlMenu(null);
            setNoteEdit({ a: newAnnotation('note', h.locator, { text: '' }), anchor: hlMenu.anchor, isNew: true });
          }}
          onRemove={() => {
            if (annDoc) removeAnnotation(annDoc, hlMenu.a.id);
            setHlMenu(null);
          }}
        />
      )}
      {noteEdit && (
        <NoteEditor
          anchor={noteEdit.anchor}
          initial={noteEdit.a.text ?? ''}
          quote={noteEdit.a.locator.type === 'clipping' ? noteEdit.a.locator.quote.exact : undefined}
          onClose={() => setNoteEdit(null)}
          onSave={(text) => {
            if (!annDoc || (!text && noteEdit.isNew)) return;
            putAnnotation(annDoc, { ...noteEdit.a, text });
          }}
          onDelete={noteEdit.isNew ? undefined : () => annDoc && removeAnnotation(annDoc, noteEdit.a.id)}
        />
      )}
      {markList && <ClipList clips={markList.clips} anchor={markList.anchor} onClose={() => setMarkList(null)} />}
    </div>
  );
}

/** Topic tags (L12): the gym topic picker when available, else a plain path field. */
export function TopicTags({ topics, onChange, Picker }: { topics: string[]; onChange(t: string[]): void; Picker: ReturnType<typeof getTopicPicker> }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => {
    const v = t.trim().replace(/^\/+|\/+$/g, '');
    if (v && !topics.includes(v)) onChange([...topics, v]);
    setDraft('');
  };
  return (
    <div className="topic-tags">
      {topics.map((t) => (
        <span key={t} className="chip">
          {t}
          <button className="chip-x" aria-label={`Remove topic ${t}`} onClick={() => onChange(topics.filter((x) => x !== t))}>
            <X size={10} />
          </button>
        </span>
      ))}
      {Picker ? (
        <Picker kind="topic" value="" onChange={add} label="Add topic" />
      ) : (
        <input
          type="text"
          aria-label="Add topic (gym path)"
          placeholder="math/linear-algebra/eigenvalues"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // a field inside other forms: Enter adds the topic, it does not submit
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add(draft);
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      )}
    </div>
  );
}
