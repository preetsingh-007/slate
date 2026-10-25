/**
 * Virtualised PDF viewer (L2, L4, S1, S2, S6, S7; adapted from Axiom): continuous scroll in
 * which only pages near the viewport are rendered, so an 800-page book stays light; zoom; table
 * of contents; text search; reading position remembered per book and synced; highlights, ink
 * and margin notes stored in `ann:<book id>`; lasso captures; jumps from clip badges; marks
 * where clips were taken.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Eraser, Highlighter, Lasso, ListTree, MousePointer2, PenLine, Search, StickyNote, ZoomIn, ZoomOut, Brush, X, NotebookPen } from 'lucide-react';
import type { Annotation, BookMeta, PdfLocator, Rect, TocEntry } from '../../../core/model/types';
import type { Capture } from '../../../core/model/capture';
import { HIGHLIGHT_COLORS, inkBounds, newAnnotation, putAnnotation, removeAnnotation } from '../../../core/library/annotations';
import { estimateBodyFontSize, itemsToMarkdown, itemsToText, selectItemsInPolygon, type Point } from '../../../core/library/extract';
import { flattenAnnotations } from '../../../core/library/flatten';
import { pdfClipMarks, type PdfMark } from '../../../core/library/marks';
import { getPageTextItems, iteratePageTexts, type PDFDocumentProxy } from '../../../core/library/pdf';
import { pdfPosition, readingPosition, saveReadingPosition } from '../../../core/library/positions';
import { LibraryTextIndex } from '../../../core/library/textIndex';
import { uid } from '../../../core/util/ids';
import { useServices } from '../../../app/services';
import { toast } from '../../common/toast';
import { draftKey, removeDraft, settleDraft, writeDraft } from '../../common/drafts';
import { annotationsDocId } from '../../../core/stores/docIds';
import type { LassoResult } from '../../sources/LassoOverlay';
import { useAnnotations, useClipRefs, useKeepScroll, useLocalPref, useSettingsVersion } from '../hooks';
import { useLibraryUi } from '../state';
import { HighlightMenu, LassoHost, NoteEditor, SelectionMenu, copyText } from '../viewerParts';
import type { InkMode, InkStyle } from './InkLayer';
import { acquirePdf, cropPage, MissingFileError } from './pdfCache';
import { PdfPage } from './PdfPage';
import { readPdfSelection, type PdfSelection } from './selection';

const GAP = 14;

type Tool = 'select' | 'highlight' | 'pen' | 'highlighter' | 'eraser' | 'note' | 'lasso';
type Drawer = 'toc' | 'search' | 'notes' | null;

export function PdfViewer({ book, onMissing }: { book: BookMeta; onMissing(): void }) {
  const services = useServices();
  const { assets, settings, device } = services;
  useSettingsVersion();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [sizes, setSizes] = useState<Map<number, { w: number; h: number }>>(new Map());
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useLocalPref(`slate-pdf-zoom:${book.id}`, 1);
  const [tool, setTool] = useState<Tool>('select');
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const [penIndex, setPenIndex] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [flash, setFlash] = useState<{ page: number; rect: Rect; nonce: number } | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [hlMenu, setHlMenu] = useState<{ a: Annotation; anchor: DOMRect } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ a: Annotation; anchor: DOMRect; isNew: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<{ page: number; snippet: string }[] | null>(null);
  const [page, setPage] = useState(1);
  const scroll = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const { doc: annDoc, list: annotations } = useAnnotations(book.id);
  // L4/durability: ink or highlights made in the moment before the annotation document has
  // opened are kept here and saved as soon as it is ready, never dropped
  const pendingAnn = useRef<{ a: Annotation; draft?: string }[]>([]);
  /** Saves an annotation; `draft` is the key of its draft, cleared once it is on disk. */
  const saveAnnotation = useCallback(
    (a: Annotation, draft?: string) => {
      if (!annDoc) return void pendingAnn.current.push({ a, draft });
      putAnnotation(annDoc, a);
      if (draft) settleDraft(services.docs, draft, annotationsDocId(book.id));
    },
    [annDoc, services.docs, book.id],
  );
  useEffect(() => {
    if (!annDoc || !pendingAnn.current.length) return;
    for (const { a, draft } of pendingAnn.current.splice(0)) {
      putAnnotation(annDoc, a);
      if (draft) settleDraft(services.docs, draft, annotationsDocId(book.id));
    }
  }, [annDoc, services.docs, book.id]);
  const clipRefs = useClipRefs(book.id);
  const jump = useLibraryUi((s) => s.jumps[book.id]);

  // ---------------------------------------------------------------- loading
  useEffect(() => {
    let alive = true;
    const handle = acquirePdf(book.fileHash, () => assets.get(book.fileHash));
    handle.pdf
      .then(async (d) => {
        const p1 = await d.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        if (!alive) return;
        setBaseSize({ w: vp.width, h: vp.height });
        setPdf(d);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof MissingFileError) onMissing();
        else setError(String(e?.message ?? e));
      });
    return () => {
      alive = false;
      handle.release();
    };
  }, [assets, book.fileHash, onMissing]);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    // a hidden tab has no width: keep the last layout instead of shrinking every page
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setWidth(el.clientWidth));
    ro.observe(el);
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageCount = pdf?.numPages ?? book.pages ?? 0;
  const fitWidth = Math.max(200, Math.min(width - 32, 1000));
  const cssWidthFor = useCallback(
    (n: number) => {
      const s = sizes.get(n) ?? baseSize;
      if (!s || !baseSize) return fitWidth * zoom;
      return (fitWidth * zoom * s.w) / baseSize.w;
    },
    [sizes, baseSize, fitWidth, zoom],
  );
  const cssHeightFor = useCallback(
    (n: number) => {
      const s = sizes.get(n) ?? baseSize;
      if (!s) return fitWidth * zoom * 1.3;
      return (cssWidthFor(n) * s.h) / s.w;
    },
    [sizes, baseSize, fitWidth, zoom, cssWidthFor],
  );

  // cumulative offsets for O(log n) page lookup; index 0 holds the total height
  const offsets = useMemo(() => {
    const arr: number[] = new Array(pageCount + 1);
    let y = 16;
    for (let n = 1; n <= pageCount; n++) {
      arr[n] = y;
      y += cssHeightFor(n) + GAP;
    }
    arr[0] = y;
    return arr;
  }, [pageCount, cssHeightFor]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const pageAt = useCallback(
    (y: number) => {
      const off = offsetsRef.current;
      let lo = 1;
      let hi = Math.max(1, pageCount);
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (off[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [pageCount],
  );

  const reportSize = useCallback(
    (n: number, w: number, h: number) => {
      setSizes((prev) => {
        const cur = prev.get(n);
        if (cur && Math.abs(cur.w - w) < 0.5 && Math.abs(cur.h - h) < 0.5) return prev;
        if (!cur && baseSize && Math.abs(baseSize.w - w) < 0.5 && Math.abs(baseSize.h - h) < 0.5) return prev;
        const next = new Map(prev);
        next.set(n, { w, h });
        return next;
      });
    },
    [baseSize],
  );

  // ---------------------------------------------------------------- position, jumps
  const scrollToRegion = useCallback(
    (n: number, rect: Rect | null, behavior: ScrollBehavior) => {
      const el = scroll.current;
      if (!el) return;
      const p = Math.min(pageCount, Math.max(1, n));
      const h = cssHeightFor(p);
      const y = offsetsRef.current[p] + (rect ? (rect.y + rect.h / 2) * h - el.clientHeight / 2 : -8);
      el.scrollTo({ top: Math.max(0, y), behavior });
    },
    [pageCount, cssHeightFor],
  );

  useLayoutEffect(() => {
    if (restored.current || !pdf || !width || !scroll.current) return;
    restored.current = true;
    if (useLibraryUi.getState().jumps[book.id]) return; // a source-link jump wins
    const pos = readingPosition(settings, book.id)?.locator;
    if (pos?.type === 'pdf') {
      const n = Math.min(pageCount, pos.page);
      const apply = (el: HTMLElement) => (el.scrollTop = offsetsRef.current[n] + pos.region.y * cssHeightFor(n));
      // a hidden tab (P3: restored on start, or left before the book loaded) cannot scroll yet
      if (scroll.current.clientWidth > 0) apply(scroll.current);
      else pendingRestore.current = apply;
    }
  });

  // S6: open at the clip's page and region, flash it for 2 seconds
  useEffect(() => {
    if (!jump || !pdf || !width) return;
    const j = useLibraryUi.getState().takeJump(book.id);
    if (!j || j.locator.type !== 'pdf') return;
    restored.current = true;
    const loc = j.locator;
    // wait a frame so a just-mounted viewer has its layout
    requestAnimationFrame(() => {
      scrollToRegion(loc.page, loc.region.h > 0 ? loc.region : null, 'auto');
      setFlash({ page: loc.page, rect: loc.region.h > 0 ? loc.region : { x: 0, y: 0, w: 1, h: 0.04 }, nonce: j.nonce });
    });
  }, [jump, pdf, width, book.id, scrollToRegion]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2100);
    return () => clearTimeout(t);
  }, [flash]);

  // keep zoom anchored on the current page
  const posRef = useRef<{ n: number; intra: number }>({ n: 1, intra: 0 });
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || prevZoom.current === zoom) return;
    prevZoom.current = zoom;
    const { n, intra } = posRef.current;
    if (offsetsRef.current[n] !== undefined) el.scrollTop = offsetsRef.current[n] + intra * cssHeightFor(n);
  }, [zoom, cssHeightFor]);

  // back from a hidden tab: return to the page and offset that were on screen
  const pendingRestore = useRef<((el: HTMLElement) => void) | null>(null);
  useKeepScroll(scroll, (el) => {
    const pending = pendingRestore.current;
    pendingRestore.current = null;
    if (pending) return void pending(el);
    const { n, intra } = posRef.current;
    if (offsetsRef.current[n] !== undefined) el.scrollTop = offsetsRef.current[n] + intra * cssHeightFor(n);
  });

  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, 3]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onScroll = () => {
    const el = scroll.current;
    if (!el || !pageCount || el.clientWidth === 0) return;
    const top = el.scrollTop;
    const first = pageAt(top);
    posRef.current = { n: first, intra: Math.max(0, Math.min(1, (top - offsetsRef.current[first]) / cssHeightFor(first))) };
    const last = pageAt(top + el.clientHeight);
    setVisibleRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    // at the very end the last page may never reach the top: count it as the current page
    setPage(top + el.clientHeight >= el.scrollHeight - 2 ? pageCount : pageAt(top + el.clientHeight / 3));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { n, intra } = posRef.current;
      void saveReadingPosition(settings, book.id, pdfPosition(n, intra), device);
    }, 800);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    if (pdf) onScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, width, zoom]);

  // ---------------------------------------------------------------- zoom (ctrl+wheel, pinch)
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const clampZoom = (z: number) => Math.max(0.4, Math.min(4, Math.round(z * 100) / 100));
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(clampZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01)));
    };
    let pinch: { d0: number; z0: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { d0: dist(e.touches), z0: zoomRef.current };
    };
    const tm = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = clampZoom(pinch.z0 * (dist(e.touches) / pinch.d0));
      el.style.setProperty('--pinch', String(z / zoomRef.current));
      el.classList.add('pinching');
    };
    const te = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const k = parseFloat(el.style.getPropertyValue('--pinch') || '1');
      el.classList.remove('pinching');
      el.style.removeProperty('--pinch');
      if (Math.abs(k - 1) > 0.02) setZoom(clampZoom(zoomRef.current * k));
      pinch = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- selection → highlights (L4)
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = readPdfSelection(el);
        if (!s) return setSelection(null);
        if (toolRef.current === 'highlight') {
          addHighlight(s, hlColorRef.current);
          window.getSelection()?.removeAllRanges();
          return;
        }
        setSelection(s);
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
  }, [annDoc]);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const hlColorRef = useRef(hlColor);
  hlColorRef.current = hlColor;

  const addHighlight = (s: PdfSelection, color: string) => {
    const loc: PdfLocator = { type: 'pdf', page: s.page, region: s.region, quote: s.text.slice(0, 500) };
    saveAnnotation(newAnnotation('highlight', loc, { color, rects: s.rects, text: s.text }));
  };

  // ---------------------------------------------------------------- ink and notes (L4)
  const pens = settings.get().pens;
  const highlighters = settings.get().highlighters;
  const preset = tool === 'highlighter' ? (highlighters[0] ?? { tool: 'highlighter', color: '#f5d742', size: 16 }) : (pens[penIndex] ?? pens[0] ?? { tool: 'pen', color: 'currentInk', size: 2.5 });
  // canvas units → page-width units (1,000 canvas units ≈ a writing width ≈ 600 pt of page)
  const inkStyle: InkStyle = useMemo(() => ({ tool: preset.tool, color: preset.color, size: preset.size / 600 }), [preset.tool, preset.color, preset.size]);
  const inkMode: InkMode = tool === 'pen' || tool === 'highlighter' ? 'draw' : tool === 'eraser' ? 'erase' : tool === 'note' ? 'note' : null;
  const fingerDrawing = settings.getPrefs().fingerDrawing;

  const inkAnnotation = useCallback(
    (pageN: number, pts: number[]) => {
      const b = inkBounds(pts, inkStyle.size);
      const s = sizes.get(pageN) ?? baseSize;
      const aspect = s ? s.w / s.h : 1;
      // region normalised to the page (y in page heights)
      const region = { x: b.x, y: b.y * aspect, w: b.w, h: b.h * aspect };
      return newAnnotation('ink', { type: 'pdf', page: pageN, region, quote: '' }, { color: inkStyle.color, strokes: [{ pts, color: inkStyle.color, size: inkStyle.size, tool: inkStyle.tool }] });
    },
    [inkStyle, sizes, baseSize],
  );
  // Durability NFR: the ink being drawn has a draft (and its future id) from its first points
  const inkDraft = useRef<{ id: string; created: number } | null>(null);
  const writeInkDraft = useCallback(
    (pageN: number, pts: number[]) => {
      const at = (inkDraft.current ??= { id: uid(), created: Date.now() });
      const a: Annotation = { ...inkAnnotation(pageN, pts), id: at.id, created: at.created };
      const key = draftKey('ink', a.id);
      writeDraft(key, { kind: 'ink', item: book.id, annotation: a });
      return { a, key };
    },
    [inkAnnotation, book.id],
  );
  const onInkDraft = useCallback(
    (pageN: number, pts: number[] | null) => {
      if (pts) return void writeInkDraft(pageN, pts);
      if (inkDraft.current) removeDraft(draftKey('ink', inkDraft.current.id));
      inkDraft.current = null;
    },
    [writeInkDraft],
  );
  const onStroke = useCallback(
    (pageN: number, pts: number[]) => {
      // the draft holds the whole stroke until the annotation is on disk
      const { a, key } = writeInkDraft(pageN, pts);
      inkDraft.current = null;
      saveAnnotation(a, key);
    },
    [saveAnnotation, writeInkDraft],
  );
  const onErase = useCallback((ids: string[]) => annDoc && ids.forEach((id) => removeAnnotation(annDoc, id)), [annDoc]);
  const onNoteAt = useCallback(
    (pageN: number, x: number, y: number, anchor: DOMRect) => {
      const a = newAnnotation('note', { type: 'pdf', page: pageN, region: { x, y, w: 0, h: 0 }, quote: '' }, { text: '', color: HIGHLIGHT_COLORS[0].value });
      setNoteEdit({ a, anchor, isNew: true });
    },
    [],
  );
  const onOpenNote = useCallback((a: Annotation, anchor: DOMRect) => setNoteEdit({ a, anchor, isNew: false }), []);
  const onHighlightClick = useCallback((a: Annotation, anchor: DOMRect) => setHlMenu({ a, anchor }), []);

  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) {
      if (a.locator.type !== 'pdf') continue;
      const list = m.get(a.locator.page);
      if (list) list.push(a);
      else m.set(a.locator.page, [a]);
    }
    return m;
  }, [annotations]);
  const marksByPage = useMemo(() => {
    const m = new Map<number, PdfMark[]>();
    for (const mk of pdfClipMarks(clipRefs)) m.set(mk.page, [...(m.get(mk.page) ?? []), mk]);
    return m;
  }, [clipRefs]);

  // ---------------------------------------------------------------- lasso → capture (S1, S2, S5)
  const onLasso = async ({ points, rect: bbox }: LassoResult) => {
    if (!pdf || !scroll.current) return;
    const cx = bbox.left + bbox.width / 2;
    const cy = bbox.top + bbox.height / 2;
    const pageEl = [...scroll.current.querySelectorAll<HTMLElement>('.pdfv-page')].find((el) => {
      const r = el.getBoundingClientRect();
      return cy >= r.top && cy <= r.bottom && cx >= r.left - 40 && cx <= r.right + 40;
    });
    if (!pageEl) return toast('Lasso over a page to capture it.');
    const n = Number(pageEl.dataset.page);
    const pr = pageEl.getBoundingClientRect();
    const pg = await pdf.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const toPage = (p: { x: number; y: number }): Point => [((p.x - pr.left) / pr.width) * vp.width, ((p.y - pr.top) / pr.height) * vp.height];
    const poly = points.map(toPage);
    const items = await getPageTextItems(pg);
    const sel = selectItemsInPolygon(items, poly);
    const body = estimateBodyFontSize(items);
    const markdown = itemsToMarkdown(sel, { bodyFontSize: body });
    const quote = itemsToText(sel, { bodyFontSize: body });
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const x0 = clamp((bbox.left - pr.left) / pr.width);
    const y0 = clamp((bbox.top - pr.top) / pr.height);
    const x1 = clamp((bbox.right - pr.left) / pr.width);
    const y1 = clamp((bbox.bottom - pr.top) / pr.height);
    const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (region.w <= 0 || region.h <= 0) return;
    // S2: re-rendered at twice the screen resolution
    const dpr = window.devicePixelRatio || 1;
    const crop = await cropPage(pdf, n, region, (pr.width / vp.width) * dpr * 2);
    const capture: Capture = {
      id: uid(),
      text: markdown,
      source: {
        type: 'book',
        id: book.id,
        title: book.title,
        locator: { type: 'pdf', page: n, region, quote: quote.slice(0, 500) },
        capturedAt: Date.now(),
        contentHash: book.fileHash,
      },
      created: Date.now(),
    };
    if (crop) {
      capture.image = crop.blob;
      capture.imageSize = { w: Math.round(region.w * pr.width), h: Math.round(region.h * pr.height) };
    }
    useLibraryUi.getState().addCapture(capture, { x: bbox.right + 12, y: bbox.top });
  };

  // ---------------------------------------------------------------- search (L2)
  const runSearch = async (q: string) => {
    setActiveQuery(q);
    if (!pdf || !q.trim()) return setResults(null);
    const needle = q.trim().toLowerCase();
    const out: { page: number; snippet: string }[] = [];
    setResults([]);
    const indexed = await LibraryTextIndex.for(services.db).get(book.id);
    const pages: AsyncIterable<{ page: number; text: string }> | Iterable<{ page: number; text: string }> =
      indexed?.pages && indexed.source === book.fileHash ? indexed.pages.map((text, i) => ({ page: i + 1, text })) : iteratePageTexts(pdf);
    for await (const { page: p, text } of pages) {
      const flat = text.replace(/\s+/g, ' ');
      const i = flat.toLowerCase().indexOf(needle);
      if (i >= 0) {
        out.push({ page: p, snippet: (i > 40 ? '…' : '') + flat.slice(Math.max(0, i - 40), i + needle.length + 60) });
        setResults([...out]);
        if (out.length >= 200) break;
      }
    }
    if (!out.length) setResults([]);
  };

  // ---------------------------------------------------------------- export (L4)
  const exportAnnotated = async () => {
    const blob = await assets.get(book.fileHash);
    if (!blob) return toast('The file is not on this device.');
    try {
      const bytes = await flattenAnnotations(new Uint8Array(await blob.arrayBuffer()), annotations);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book.slug}-annotated.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`);
    }
  };

  // keyboard: page up/down handled natively; Ctrl/Cmd +/- zoom while the viewer has focus
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+') setZoom(clampZoom(zoom * 1.15));
    else if (e.key === '-') setZoom(clampZoom(zoom / 1.15));
    else if (e.key === '0') setZoom(1);
    else return;
    e.preventDefault();
  };

  if (error) return <div className="empty">Could not open this PDF: {error}</div>;

  const renderFrom = Math.max(1, visibleRange[0] - 2);
  const renderTo = Math.min(pageCount, visibleRange[1] + 2);
  const pages: number[] = [];
  for (let n = renderFrom; n <= renderTo; n++) pages.push(n);

  const toolBtn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button className="icon-btn" aria-label={label} title={label} aria-pressed={tool === t} onClick={() => setTool(tool === t && t !== 'select' ? 'select' : t)}>
      {icon}
    </button>
  );

  return (
    <div className="viewer" data-testid="pdf-viewer">
      <div className="viewer-bar" role="toolbar" aria-label="PDF tools">
        <button className="icon-btn" aria-label="Table of contents" title="Table of contents" aria-pressed={drawer === 'toc'} onClick={() => setDrawer(drawer === 'toc' ? null : 'toc')}>
          <ListTree size={18} />
        </button>
        <button className="icon-btn" aria-label="Search in book" title="Search" aria-pressed={drawer === 'search'} onClick={() => setDrawer(drawer === 'search' ? null : 'search')}>
          <Search size={18} />
        </button>
        <button className="icon-btn" aria-label="Annotations" title="Annotations" aria-pressed={drawer === 'notes'} onClick={() => setDrawer(drawer === 'notes' ? null : 'notes')}>
          <NotebookPen size={18} />
        </button>
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
        {toolBtn('pen', 'Pen', <PenLine size={18} />)}
        {tool === 'pen' && pens.length > 1 && (
          <span className="swatches" role="radiogroup" aria-label="Pen">
            {pens.map((p, i) => (
              <button key={i} role="radio" aria-checked={penIndex === i} aria-label={`Pen ${i + 1}`} className="swatch" style={{ background: p.color === 'currentInk' ? 'var(--ink-default)' : p.color }} onClick={() => setPenIndex(i)} />
            ))}
          </span>
        )}
        {toolBtn('highlighter', 'Highlighter pen', <Brush size={18} />)}
        {toolBtn('eraser', 'Eraser', <Eraser size={18} />)}
        {toolBtn('note', 'Margin note', <StickyNote size={18} />)}
        {toolBtn('lasso', 'Lasso', <Lasso size={18} />)}
        <span className="bar-sep" />
        <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(clampZoom(zoom / 1.15))}>
          <ZoomOut size={18} />
        </button>
        <button className="btn small" aria-label="Fit width" title="Fit width" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(clampZoom(zoom * 1.15))}>
          <ZoomIn size={18} />
        </button>
        <span className="spacer" />
        <span className="muted small" aria-live="polite" data-testid="pdf-page">
          {page} / {pageCount || '…'}
        </span>
        <button className="icon-btn" aria-label="Export a copy with annotations" title="Export a copy with annotations" onClick={exportAnnotated}>
          <Download size={18} />
        </button>
      </div>
      <div className="viewer-main">
        {drawer && (
          <aside className="viewer-drawer" aria-label={drawer === 'toc' ? 'Table of contents' : drawer === 'search' ? 'Search' : 'Annotations'}>
            <div className="drawer-head">
              <strong>{drawer === 'toc' ? 'Contents' : drawer === 'search' ? 'Search' : 'Annotations'}</strong>
              <button className="icon-btn small" aria-label="Close panel" onClick={() => setDrawer(null)}>
                <X size={14} />
              </button>
            </div>
            {drawer === 'toc' && <Toc entries={book.toc ?? []} onPick={(p) => scrollToRegion(p, null, 'auto')} />}
            {drawer === 'search' && (
              <div className="drawer-body">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(query);
                  }}
                >
                  <input type="search" aria-label="Search text" placeholder="Search this book" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
                </form>
                {results && (
                  <ul className="results" aria-label="Search results">
                    {results.length === 0 && <li className="muted">No matches yet.</li>}
                    {results.map((r) => (
                      <li key={r.page}>
                        <button onClick={() => scrollToRegion(r.page, null, 'auto')}>
                          <span className="muted small">p. {r.page}</span> {r.snippet}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {drawer === 'notes' && (
              <AnnotationList
                annotations={annotations}
                onPick={(a) => {
                  if (a.locator.type !== 'pdf') return;
                  scrollToRegion(a.locator.page, a.locator.region, 'auto');
                  setFlash({ page: a.locator.page, rect: a.locator.region.h ? a.locator.region : { ...a.locator.region, h: 0.03, w: 0.05 }, nonce: Date.now() });
                }}
                onRemove={(a) => annDoc && removeAnnotation(annDoc, a.id)}
              />
            )}
          </aside>
        )}
        <div ref={scroll} className={`pdfv-scroll tool-${tool}`} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${book.title}, ${pageCount} pages`}>
          <LassoHost scrollRef={scroll} active={tool === 'lasso'} onLasso={(r) => void onLasso(r)} />
          <div className="pdfv-canvas" style={{ height: offsets[0] ?? 0 }}>
            {pdf &&
              pages.map((n) => (
                <PdfPage
                  key={n}
                  pdf={pdf}
                  n={n}
                  top={offsets[n]}
                  cssWidth={cssWidthFor(n)}
                  cssHeight={cssHeightFor(n)}
                  annotations={byPage.get(n) ?? EMPTY}
                  marks={marksByPage.get(n) ?? EMPTY_MARKS}
                  flash={flash?.page === n ? flash : null}
                  inkMode={inkMode}
                  inkStyle={inkStyle}
                  fingerDrawing={fingerDrawing}
                  search={activeQuery}
                  onSize={reportSize}
                  onStroke={onStroke}
                  onInkDraft={onInkDraft}
                  onErase={onErase}
                  onNoteAt={onNoteAt}
                  onOpenNote={onOpenNote}
                  onHighlightClick={onHighlightClick}
                />
              ))}
          </div>
        </div>
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
            const a = newAnnotation('note', { type: 'pdf', page: s.page, region: { x: s.region.x + s.region.w, y: s.region.y, w: 0, h: 0 }, quote: s.text.slice(0, 500) }, { text: '' });
            setNoteEdit({ a, anchor: s.anchor, isNew: true });
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
            if (h.locator.type !== 'pdf') return;
            const r = h.locator.region;
            setNoteEdit({ a: newAnnotation('note', { ...h.locator, region: { x: r.x + r.w, y: r.y, w: 0, h: 0 } }, { text: '' }), anchor: hlMenu.anchor, isNew: true });
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
          draft={{ item: book.id, annotation: noteEdit.a }}
          quote={noteEdit.a.locator.type === 'pdf' ? noteEdit.a.locator.quote : undefined}
          onClose={() => setNoteEdit(null)}
          onSave={(text) => {
            if (!text && noteEdit.isNew) return;
            saveAnnotation({ ...noteEdit.a, text });
          }}
          onDelete={noteEdit.isNew ? undefined : () => annDoc && removeAnnotation(annDoc, noteEdit.a.id)}
          onDiscard={noteEdit.isNew ? () => annDoc && removeAnnotation(annDoc, noteEdit.a.id) : undefined}
        />
      )}
    </div>
  );
}

const EMPTY: Annotation[] = [];
const EMPTY_MARKS: PdfMark[] = [];

function Toc({ entries, onPick }: { entries: TocEntry[]; onPick(page: number): void }) {
  if (!entries.length) return <p className="muted drawer-body">This PDF has no table of contents.</p>;
  const render = (list: TocEntry[], depth: number) => (
    <ul className="toc" style={{ paddingLeft: depth ? 12 : 0 }}>
      {list.map((e, i) => (
        <li key={i}>
          <button disabled={!e.page} onClick={() => e.page && onPick(e.page)}>
            <span>{e.title}</span>
            {e.page && <span className="muted small">{e.page}</span>}
          </button>
          {e.children && render(e.children, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return <nav className="drawer-body" aria-label="Contents">{render(entries, 0)}</nav>;
}

/** Highlights and notes, for keyboard access and overview (L4, L5). */
export function AnnotationList({ annotations, onPick, onRemove }: { annotations: Annotation[]; onPick(a: Annotation): void; onRemove(a: Annotation): void }) {
  const shown = annotations.filter((a) => a.kind !== 'ink' || a.locator.type === 'pdf');
  if (!shown.length) return <p className="muted drawer-body">No highlights or notes yet.</p>;
  const where = (a: Annotation) => (a.locator.type === 'pdf' ? `p. ${a.locator.page}` : '');
  return (
    <ul className="results drawer-body" aria-label="Annotations">
      {shown.map((a) => (
        <li key={a.id} className="ann-row">
          <button onClick={() => onPick(a)}>
            <span className="ann-dot" style={{ background: a.kind === 'ink' ? 'var(--fg-muted)' : a.color }} aria-hidden />
            <span className="muted small">{a.kind === 'highlight' ? 'Highlight' : a.kind === 'note' ? 'Note' : 'Ink'} {where(a)}</span>{' '}
            {a.kind === 'note' ? a.text : a.text ?? (a.locator.type === 'epub' || a.locator.type === 'clipping' ? a.locator.quote.exact : '')}
          </button>
          <button className="icon-btn small" aria-label="Delete annotation" onClick={() => onRemove(a)}>
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
