/**
 * EPUB reader (L3, L5, S1, S2, S6, S7; adapted from Axiom): chapters render lazily in one
 * continuous scroll; table of contents; font size; light and dark themes; text search; reading
 * position (chapter + fraction) remembered and synced; highlights and margin notes anchored to
 * the text with quote selectors, so they survive font and layout changes; lasso captures.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AArrowDown, AArrowUp, Lasso, ListTree, Moon, NotebookPen, Search, StickyNote, Sun, X, MousePointer2, Highlighter } from 'lucide-react';
import type { Annotation, BookMeta, EpubLocator } from '../../../core/model/types';
import type { Capture } from '../../../core/model/capture';
import type { EpubBook, EpubTocEntry } from '../../../core/library/epubTypes';
import { parseEpub } from '../../../core/library/epub';
import { HIGHLIGHT_COLORS, newAnnotation, putAnnotation, removeAnnotation } from '../../../core/library/annotations';
import { epubPosition, readingPosition, saveReadingPosition } from '../../../core/library/positions';
import { findQuote, makeQuote } from '../../../core/locators/textQuote';
import { nodeToMarkdown } from '../../../core/html/toMarkdown';
import type { ClipRef } from '../../../core/stores/canvases';
import { LRU } from '../../../core/util/lru';
import { uid } from '../../../core/util/ids';
import { useServices } from '../../../app/services';
import { toast } from '../../common/toast';
import { rasterizeRegion } from '../../sources/rasterize';
import type { LassoResult } from '../../sources/LassoOverlay';
import { ClipMark } from '../ClipMarks';
import { useAnnotations, useClipRefs, useKeepScroll, useLocalPref, useSettingsVersion } from '../hooks';
import { useLibraryUi } from '../state';
import { buildTextMap, hitInPolygon, rangeFragment, offsetOf, rangeFromOffsets, rangeRectsIn, type TextMap } from '../textMap';
import { HighlightMenu, LassoHost, NoteEditor, SelectionMenu, copyText } from '../viewerParts';
import { AnnotationList } from '../pdf/PdfViewer';
import { MissingFileError } from '../pdf/pdfCache';

const books = new LRU<string, Promise<EpubBook>>(2, (_k, p) => {
  void p.then((b) => b.dispose()).catch(() => {});
  return true;
});

function getBook(hash: string, load: () => Promise<Blob | undefined>) {
  let p = books.get(hash);
  if (!p) {
    p = load().then((b) => {
      if (!b) throw new MissingFileError();
      return parseEpub(b);
    });
    books.set(hash, p);
    p.catch(() => books.delete(hash));
  }
  return p;
}

type Tool = 'select' | 'highlight' | 'lasso';

interface Overlay {
  /** highlight rects relative to the chapter section */
  rects: { x: number; y: number; w: number; h: number; id: string; color: string }[];
  notes: { id: string; y: number; a: Annotation }[];
  marks: { y: number; h: number; clips: ClipRef[] }[];
}

/** Text map of a rendered chapter (cached per element until its HTML changes). */
const maps = new WeakMap<Element, TextMap>();
function chapterMap(el: Element): TextMap {
  let m = maps.get(el);
  if (!m) maps.set(el, (m = buildTextMap(el)));
  return m;
}

export function EpubViewer({ book: meta, onMissing }: { book: BookMeta; onMissing(): void }) {
  const { assets, settings, device } = useServices();
  useSettingsVersion();
  const [book, setBook] = useState<EpubBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // a saved position waiting for the tab to be shown (P3: restored tabs can open hidden)
  const pendingRestore = useRef<(() => void) | null>(null);
  // keyed on the book: the scroller only exists once the book has loaded
  useKeepScroll(
    scroll,
    (el, last) => {
      const f = pendingRestore.current;
      pendingRestore.current = null;
      if (f) f();
      else el.scrollTop = last;
    },
    !!book,
  );
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0]));
  const restored = useRef(false);
  const [fontSize, setFontSize] = useLocalPref('slate-epub-font', 18);
  const [theme, setTheme] = useLocalPref<'auto' | 'light' | 'dark'>('slate-epub-theme', 'auto');
  const [tool, setTool] = useState<Tool>('select');
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const [drawer, setDrawer] = useState<'toc' | 'search' | 'notes' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ chapter: number; occurrence: number; snippet: string }[] | null>(null);
  const [selection, setSelection] = useState<{ chapter: number; start: number; end: number; text: string; anchor: DOMRect } | null>(null);
  const [hlMenu, setHlMenu] = useState<{ a: Annotation; anchor: DOMRect } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ a: Annotation; anchor: DOMRect; isNew: boolean } | null>(null);
  const [flash, setFlash] = useState<{ chapter: number; start: number; end: number; nonce: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const { doc: annDoc, list: annotations } = useAnnotations(meta.id);
  const clipRefs = useClipRefs(meta.id);
  const jump = useLibraryUi((s) => s.jumps[meta.id]);

  useEffect(() => {
    let alive = true;
    getBook(meta.fileHash, () => assets.get(meta.fileHash))
      .then((b) => alive && setBook(b))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof MissingFileError) onMissing();
        else setError(String(e?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [assets, meta.fileHash, onMissing]);

  const chapterIndex = useCallback((href: string) => book?.chapters.findIndex((c) => c.href === href.split('#')[0]) ?? -1, [book]);

  const chapterEl = (i: number) => scroll.current?.querySelector<HTMLElement>(`[data-chapter="${i}"] .epub-html`) ?? null;

  /** Loads chapter i and resolves with its rendered element. */
  const ensureChapter = useCallback(async (i: number): Promise<HTMLElement | null> => {
    setVisible((v) => (v.has(i) ? v : new Set(v).add(i)));
    for (let t = 0; t < 60; t++) {
      const el = scroll.current?.querySelector<HTMLElement>(`[data-chapter="${i}"] .epub-html`);
      if (el) return el;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }, []);

  const scrollToY = (y: number, behavior: ScrollBehavior = 'auto') => scroll.current?.scrollTo({ top: Math.max(0, y), behavior });

  const scrollToChapter = useCallback(
    async (i: number, offset = 0, fragment?: string) => {
      const el = await ensureChapter(i);
      const section = el?.parentElement;
      if (!el || !section || !scroll.current) return;
      if (fragment) {
        const target = el.querySelector(`#${CSS.escape(`epub${i}-${fragment}`)}`);
        if (target) {
          const r = target.getBoundingClientRect();
          return scrollToY(r.top - scroll.current.getBoundingClientRect().top + scroll.current.scrollTop - 12);
        }
      }
      scrollToY(section.offsetTop + offset * section.offsetHeight - 12);
    },
    [ensureChapter],
  );

  /** Scrolls to text offsets in a chapter and flashes them for 2 s (S6). */
  const revealRange = useCallback(
    async (i: number, start: number, end: number) => {
      const el = await ensureChapter(i);
      if (!el || !scroll.current) return;
      const r = rangeFromOffsets(chapterMap(el), start, end);
      if (!r) return;
      const box = r.getBoundingClientRect();
      const sb = scroll.current.getBoundingClientRect();
      scrollToY(box.top - sb.top + scroll.current.scrollTop - scroll.current.clientHeight / 3);
      setFlash({ chapter: i, start, end, nonce: Date.now() });
    },
    [ensureChapter],
  );

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2100);
    return () => clearTimeout(t);
  }, [flash]);

  // restore the reading position
  useEffect(() => {
    if (!book || restored.current) return;
    restored.current = true;
    if (useLibraryUi.getState().jumps[meta.id]) return;
    const pos = readingPosition(settings, meta.id)?.locator;
    if (pos?.type === 'epub') {
      const i = chapterIndex(pos.chapter);
      if (i < 0) return;
      if (scroll.current && scroll.current.clientWidth === 0) pendingRestore.current = () => void scrollToChapter(i, pos.position);
      else void scrollToChapter(i, pos.position);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // S6: jump to a clip's quote; closest match with a notice when the text changed
  useEffect(() => {
    if (!jump || !book) return;
    const j = useLibraryUi.getState().takeJump(meta.id);
    if (!j || j.locator.type !== 'epub') return;
    restored.current = true;
    const loc = j.locator;
    void (async () => {
      const i = chapterIndex(loc.chapter);
      if (i < 0) return toast('The chapter of this clip is not in the book any more.');
      const el = await ensureChapter(i);
      if (!el) return;
      const map = chapterMap(el);
      const m = loc.quote.exact ? findQuote(map.text, loc.quote, Math.round(loc.position * map.text.length)) : null;
      if (!m) {
        if (loc.quote.exact) toast('The quoted text was not found; showing the saved position.');
        return scrollToChapter(i, loc.position);
      }
      if (!m.exact) toast('The exact text was not found; showing the closest match.');
      await revealRange(i, m.start, m.end);
    })();
  }, [jump, book, meta.id, chapterIndex, ensureChapter, revealRange, scrollToChapter]);

  // reading position (throttled)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onScroll = () => {
    const el = scroll.current;
    if (!el || !book || el.clientWidth === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const chapters = [...el.querySelectorAll<HTMLElement>('[data-chapter]')];
      const top = el.scrollTop + 20;
      const cur = chapters.filter((c) => c.offsetTop <= top).pop() ?? chapters[0];
      if (!cur) return;
      const i = Number(cur.dataset.chapter);
      const intra = Math.max(0, Math.min(1, (top - cur.offsetTop) / Math.max(1, cur.offsetHeight)));
      void saveReadingPosition(settings, meta.id, epubPosition(book.chapters[i].href, intra), device);
    }, 800);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // font and width changes re-lay out the overlays
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------- selection (L5)
  const toolRef = useRef(tool);
  toolRef.current = tool;
  useEffect(() => {
    const el = scroll.current;
    if (!el || !book) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return setSelection(null);
        const r = s.getRangeAt(0);
        const host = (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest<HTMLElement>('.epub-html');
        if (!host || !el.contains(host)) return setSelection(null);
        const i = Number(host.parentElement!.dataset.chapter);
        const map = chapterMap(host);
        const start = offsetOf(map, r.startContainer, r.startOffset);
        const end = r.endContainer && host.contains(r.endContainer) ? offsetOf(map, r.endContainer, r.endOffset) : map.text.length;
        if (end <= start) return setSelection(null);
        const sel = { chapter: i, start, end, text: map.text.slice(start, end), anchor: r.getBoundingClientRect() };
        if (toolRef.current === 'highlight') {
          addHighlight(sel, hlColorRef.current);
          s.removeAllRanges();
          return setSelection(null);
        }
        setSelection(sel);
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
  }, [book, annDoc]);
  const hlColorRef = useRef(hlColor);
  hlColorRef.current = hlColor;

  const locatorFor = (i: number, start: number, end: number): EpubLocator | null => {
    const el = chapterEl(i);
    if (!el || !book) return null;
    const map = chapterMap(el);
    return { type: 'epub', chapter: book.chapters[i].href, quote: makeQuote(map.text, start, end), position: map.text.length ? start / map.text.length : 0 };
  };

  const addHighlight = (s: { chapter: number; start: number; end: number; text: string }, color: string) => {
    const loc = locatorFor(s.chapter, s.start, s.end);
    if (!annDoc || !loc) return;
    putAnnotation(annDoc, newAnnotation('highlight', loc, { color, text: s.text.slice(0, 500) }));
  };

  // ---------------------------------------------------------------- lasso → capture (S1, S2)
  const onLasso = async ({ points, rect }: LassoResult) => {
    const el = scroll.current;
    if (!el || !book) return;
    const cy = rect.top + rect.height / 2;
    const host = [...el.querySelectorAll<HTMLElement>('.epub-html')].find((h) => {
      const r = h.getBoundingClientRect();
      return cy >= r.top && cy <= r.bottom;
    });
    if (!host) return toast('Lasso over the text to capture it.');
    const i = Number(host.parentElement!.dataset.chapter);
    const map = chapterMap(host);
    const hit = hitInPolygon(host, map, points);
    const text = hit ? nodeToMarkdown(rangeFragment(hit.range, host)) : '';
    const loc: EpubLocator = hit
      ? { type: 'epub', chapter: book.chapters[i].href, quote: makeQuote(map.text, hit.start, hit.end), position: map.text.length ? hit.start / map.text.length : 0 }
      : { type: 'epub', chapter: book.chapters[i].href, quote: { exact: '', prefix: '', suffix: '' }, position: Math.max(0, (rect.top - host.getBoundingClientRect().top) / Math.max(1, host.offsetHeight)) };
    const image = await rasterizeRegion(host.parentElement as HTMLElement, rect, 2);
    const capture: Capture = {
      id: uid(),
      text,
      source: { type: 'book', id: meta.id, title: meta.title, locator: loc, capturedAt: Date.now(), contentHash: meta.fileHash },
      created: Date.now(),
    };
    if (image) {
      capture.image = image.blob;
      capture.imageSize = { w: Math.round(image.w), h: Math.round(image.h) };
    }
    if (!capture.text && !capture.image) return toast('Nothing was captured.');
    useLibraryUi.getState().addCapture(capture, { x: rect.right + 12, y: rect.top });
  };

  // ---------------------------------------------------------------- search (L3)
  const runSearch = async (q: string) => {
    if (!book || !q.trim()) return setResults(null);
    const needle = q.trim().toLowerCase();
    const out: { chapter: number; occurrence: number; snippet: string }[] = [];
    setResults([]);
    for (let i = 0; i < book.chapters.length && out.length < 200; i++) {
      const html = await book.chapterHtml(i);
      const text = (new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ');
      const lower = text.toLowerCase();
      for (let k = 0, at = lower.indexOf(needle); at >= 0 && out.length < 200; at = lower.indexOf(needle, at + needle.length), k++) {
        out.push({ chapter: i, occurrence: k, snippet: (at > 40 ? '…' : '') + text.slice(Math.max(0, at - 40), at + needle.length + 60) });
      }
      setResults([...out]);
    }
  };
  const openResult = async (r: { chapter: number; occurrence: number }) => {
    const el = await ensureChapter(r.chapter);
    if (!el) return;
    const map = chapterMap(el);
    const needle = query.trim().toLowerCase();
    // occurrences are counted on whitespace-collapsed text; count on the map's text the same way
    const lower = map.text.toLowerCase();
    let at = -1;
    for (let k = 0, from = 0; k <= r.occurrence; k++) {
      at = lower.indexOf(needle, from);
      if (at < 0) break;
      from = at + needle.length;
    }
    if (at < 0) {
      const m = findQuote(map.text, { exact: query.trim(), prefix: '', suffix: '' });
      if (m) return revealRange(r.chapter, m.start, m.end);
      return scrollToChapter(r.chapter);
    }
    await revealRange(r.chapter, at, at + needle.length);
  };

  // ---------------------------------------------------------------- overlays per chapter
  const annByChapter = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of annotations) if (a.locator.type === 'epub') m.set(a.locator.chapter, [...(m.get(a.locator.chapter) ?? []), a]);
    return m;
  }, [annotations]);
  const clipsByChapter = useMemo(() => {
    const m = new Map<string, ClipRef[]>();
    for (const r of clipRefs) if (r.clip.source.locator.type === 'epub') m.set(r.clip.source.locator.chapter, [...(m.get(r.clip.source.locator.chapter) ?? []), r]);
    return m;
  }, [clipRefs]);

  if (error) return <div className="empty">Could not open this EPUB: {error}</div>;
  if (!book) return <div className="empty">Opening…</div>;

  const themeClass = theme === 'auto' ? '' : ` epub-theme-${theme}`;
  const toolBtn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button className="icon-btn" aria-label={label} title={label} aria-pressed={tool === t} onClick={() => setTool(tool === t && t !== 'select' ? 'select' : t)}>
      {icon}
    </button>
  );

  return (
    <div className="viewer" data-testid="epub-viewer">
      <div className="viewer-bar" role="toolbar" aria-label="EPUB tools">
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
        {toolBtn('lasso', 'Lasso', <Lasso size={18} />)}
        <span className="bar-sep" />
        <button className="icon-btn" aria-label="Smaller text" title="Smaller text" onClick={() => setFontSize(Math.max(12, fontSize - 1))}>
          <AArrowDown size={18} />
        </button>
        <span className="muted small" aria-label="Font size">
          {fontSize}
        </span>
        <button className="icon-btn" aria-label="Larger text" title="Larger text" onClick={() => setFontSize(Math.min(32, fontSize + 1))}>
          <AArrowUp size={18} />
        </button>
        <button
          className="icon-btn"
          aria-label={`Reading theme: ${theme}`}
          title={`Reading theme: ${theme}`}
          onClick={() => setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')}
        >
          {theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <span className="theme-auto" aria-hidden>A</span>}
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
            {drawer === 'toc' && <EpubToc entries={book.toc} onPick={(e) => e.chapter !== undefined && void scrollToChapter(e.chapter, 0, e.fragment)} />}
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
                    {results.map((r, k) => (
                      <li key={k}>
                        <button onClick={() => void openResult(r)}>
                          <span className="muted small">{book.chapters[r.chapter].title ?? `Chapter ${r.chapter + 1}`}</span> {r.snippet}
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
                  if (a.locator.type !== 'epub') return;
                  const loc = a.locator;
                  const i = chapterIndex(loc.chapter);
                  void ensureChapter(i).then((el) => {
                    if (!el) return;
                    const m = findQuote(chapterMap(el).text, loc.quote, Math.round(loc.position * chapterMap(el).text.length));
                    if (m) void revealRange(i, m.start, m.end);
                  });
                }}
                onRemove={(a) => annDoc && removeAnnotation(annDoc, a.id)}
              />
            )}
          </aside>
        )}
        <div ref={scroll} className={`epub-scroll tool-${tool}${themeClass}`} onScroll={onScroll} tabIndex={0} aria-label={meta.title}>
          <LassoHost scrollRef={scroll} active={tool === 'lasso'} onLasso={(r) => void onLasso(r)} />
          <div className="epub-content" style={{ fontSize }}>
            {book.chapters.map((c, i) => (
              <Chapter
                key={c.id}
                book={book}
                index={i}
                load={visible.has(i)}
                onNear={() => setVisible((v) => (v.has(i) ? v : new Set(v).add(i)))}
                layoutKey={`${fontSize}:${layoutTick}`}
                annotations={annByChapter.get(c.href) ?? EMPTY}
                clips={clipsByChapter.get(c.href) ?? EMPTY_CLIPS}
                flash={flash?.chapter === i ? flash : null}
                onHighlightClick={(a, anchor) => setHlMenu({ a, anchor })}
                onOpenNote={(a, anchor) => setNoteEdit({ a, anchor, isNew: false })}
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
            const loc = locatorFor(s.chapter, s.start, s.end);
            if (loc) setNoteEdit({ a: newAnnotation('note', loc, { text: '' }), anchor: s.anchor, isNew: true });
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
          draft={{ item: meta.id, annotation: noteEdit.a }}
          quote={noteEdit.a.locator.type === 'epub' ? noteEdit.a.locator.quote.exact : undefined}
          onClose={() => setNoteEdit(null)}
          onSave={(text) => {
            if (!annDoc || (!text && noteEdit.isNew)) return;
            putAnnotation(annDoc, { ...noteEdit.a, text });
          }}
          onDelete={noteEdit.isNew ? undefined : () => annDoc && removeAnnotation(annDoc, noteEdit.a.id)}
          onDiscard={noteEdit.isNew ? () => annDoc && removeAnnotation(annDoc, noteEdit.a.id) : undefined}
        />
      )}
    </div>
  );
}

const EMPTY: Annotation[] = [];
const EMPTY_CLIPS: ClipRef[] = [];

function EpubToc({ entries, onPick }: { entries: EpubTocEntry[]; onPick(e: EpubTocEntry): void }) {
  if (!entries.length) return <p className="muted drawer-body">This book has no table of contents.</p>;
  const render = (list: EpubTocEntry[], depth: number) => (
    <ul className="toc" style={{ paddingLeft: depth ? 12 : 0 }}>
      {list.map((e, i) => (
        <li key={i}>
          <button disabled={e.chapter === undefined} onClick={() => onPick(e)}>
            {e.title}
          </button>
          {e.children && render(e.children, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return <nav className="drawer-body" aria-label="Contents">{render(entries, 0)}</nav>;
}

interface ChapterProps {
  book: EpubBook;
  index: number;
  load: boolean;
  onNear(): void;
  layoutKey: string;
  annotations: Annotation[];
  clips: ClipRef[];
  flash: { start: number; end: number; nonce: number } | null;
  onHighlightClick(a: Annotation, anchor: DOMRect): void;
  onOpenNote(a: Annotation, anchor: DOMRect): void;
}

const Chapter = memo(function Chapter({ book, index, load, onNear, layoutKey, annotations, clips, flash, onHighlightClick, onOpenNote }: ChapterProps) {
  const ref = useRef<HTMLElement>(null);
  const htmlRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ rects: [], notes: [], marks: [] });
  const [flashRects, setFlashRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);

  useEffect(() => {
    if (load || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onNear(), { rootMargin: '1200px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [load, onNear]);

  useEffect(() => {
    if (!load || html !== null) return;
    let alive = true;
    void book.chapterHtml(index).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [load, html, book, index]);

  // re-anchor highlights, notes and clip marks to the current layout (L5, S7)
  useLayoutEffect(() => {
    const host = htmlRef.current;
    const section = ref.current;
    if (!host || !section || html === null) return;
    const map = chapterMap(host);
    const len = map.text.length || 1;
    const anchor = (q: { exact: string; prefix: string; suffix: string }, position: number) => {
      if (!q.exact) return null;
      const m = findQuote(map.text, q, Math.round(position * len));
      return m ? rangeFromOffsets(map, m.start, m.end) : null;
    };
    const rects: Overlay['rects'] = [];
    const notes: Overlay['notes'] = [];
    for (const a of annotations) {
      if (a.locator.type !== 'epub') continue;
      const r = anchor(a.locator.quote, a.locator.position);
      if (!r) continue;
      const rr = rangeRectsIn(r, section);
      if (a.kind === 'highlight') for (const x of rr) rects.push({ ...x, id: a.id, color: a.color });
      else if (a.kind === 'note' && rr[0]) notes.push({ id: a.id, y: rr[0].y, a });
    }
    const marks: Overlay['marks'] = [];
    for (const c of clips) {
      const l = c.clip.source.locator;
      if (l.type !== 'epub') continue;
      const r = anchor(l.quote, l.position);
      const rr = r ? rangeRectsIn(r, section) : [];
      const y = rr[0]?.y ?? l.position * section.offsetHeight;
      const h = rr.length ? rr[rr.length - 1].y + rr[rr.length - 1].h - y : 16;
      const last = marks[marks.length - 1];
      if (last && y <= last.y + last.h + 4) {
        last.h = Math.max(last.h, y + h - last.y);
        last.clips.push(c);
      } else marks.push({ y, h, clips: [c] });
    }
    marks.sort((a, b) => a.y - b.y);
    setOverlay({ rects, notes, marks });
  }, [html, annotations, clips, layoutKey]);

  useLayoutEffect(() => {
    const host = htmlRef.current;
    const section = ref.current;
    if (!flash || !host || !section) return setFlashRects([]);
    const r = rangeFromOffsets(chapterMap(host), flash.start, flash.end);
    setFlashRects(r ? rangeRectsIn(r, section) : []);
  }, [flash, html]);

  const onClick = (e: React.MouseEvent) => {
    if (window.getSelection()?.isCollapsed === false || !ref.current) return;
    const sb = ref.current.getBoundingClientRect();
    const x = e.clientX - sb.left;
    const y = e.clientY - sb.top;
    const hit = overlay.rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    const a = hit && annotations.find((x) => x.id === hit.id);
    if (a) onHighlightClick(a, new DOMRect(e.clientX, e.clientY, 1, 1));
  };

  return (
    <section ref={ref} className="epub-chapter" data-chapter={index} style={html === null ? { minHeight: 900 } : undefined} onClick={onClick}>
      {html !== null ? (
        <>
          <div className="hl-layer" aria-hidden data-no-text>
            {overlay.rects.map((r, i) => (
              <div key={i} className="hl-rect" style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: r.color }} />
            ))}
            {flashRects.map((r, i) => (
              <div key={`f${i}`} className="lib-flash" data-testid="flash" style={{ left: r.x - 2, top: r.y - 2, width: r.w + 4, height: r.h + 4 }} />
            ))}
          </div>
          <div ref={htmlRef} className="epub-html" dangerouslySetInnerHTML={{ __html: html }} />
          {overlay.notes.map((n) => (
            <button
              key={n.id}
              className="margin-note"
              style={{ top: n.y }}
              aria-label={`Margin note: ${n.a.text || 'empty'}`}
              title={n.a.text}
              data-testid="margin-note"
              onClick={(e) => {
                e.stopPropagation();
                onOpenNote(n.a, e.currentTarget.getBoundingClientRect());
              }}
            >
              <StickyNote size={14} />
            </button>
          ))}
          {overlay.marks.map((m, i) => (
            <ClipMark key={i} clips={m.clips} className="html-mark" style={{ top: m.y, height: Math.max(12, m.h) }} />
          ))}
        </>
      ) : (
        <div className="epub-ph" />
      )}
    </section>
  );
});
