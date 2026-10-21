/** React hooks over the library stores, annotation documents and clips. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import type { Annotation, BookMeta, ClippingMeta } from '../../core/model/types';
import type { ClipRef } from '../../core/stores/canvases';
import { annotationsDocId, parseSegmentDocId } from '../../core/stores/docIds';
import { annotationsMap, listAnnotations } from '../../core/library/annotations';
import { useServices } from '../../app/services';

/** Re-renders when the library index changes; returns books and clippings. */
export function useLibraryItems(): { books: BookMeta[]; clippings: ClippingMeta[] } {
  const { library } = useServices();
  const [items, setItems] = useState(() => ({ books: library.books(), clippings: library.clippings() }));
  useEffect(() => {
    setItems({ books: library.books(), clippings: library.clippings() });
    return library.onChange.on(() => setItems({ books: library.books(), clippings: library.clippings() }));
  }, [library]);
  return items;
}

export function useBook(id: string): BookMeta | undefined {
  const { books } = useLibraryItems();
  return books.find((b) => b.id === id);
}

export function useClipping(id: string): ClippingMeta | undefined {
  const { clippings } = useLibraryItems();
  return clippings.find((c) => c.id === id);
}

/** Re-renders on settings changes (reading positions, pens, helper secrets). */
export function useSettingsVersion(): number {
  const { settings } = useServices();
  const [v, setV] = useState(0);
  useEffect(() => settings.onChange.on(() => setV((x) => x + 1)), [settings]);
  return v;
}

/** The annotation document of an item, kept loaded while mounted. */
export function useAnnotations(itemId: string): { doc: Y.Doc | null; list: Annotation[] } {
  const { docs } = useServices();
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [list, setList] = useState<Annotation[]>([]);
  useEffect(() => {
    let alive = true;
    const id = annotationsDocId(itemId);
    let off: (() => void) | undefined;
    void docs.open(id).then((d) => {
      if (!alive) return;
      docs.retain(id);
      setDoc(d);
      setList(listAnnotations(d));
      const map = annotationsMap(d);
      const on = () => setList(listAnnotations(d));
      map.observe(on);
      off = () => map.unobserve(on);
    });
    return () => {
      alive = false;
      off?.();
      docs.release(id);
    };
  }, [docs, itemId]);
  return { doc, list };
}

/**
 * Clips on any canvas that point to this item (S7, L13), refreshed when canvas segments
 * change (debounced: findClipsOf reads every segment).
 */
export function useClipRefs(itemId: string): ClipRef[] {
  const { canvases, docs } = useServices();
  const [refs, setRefs] = useState<ClipRef[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void canvases.findClipsOf(itemId).then((r) => {
        if (alive) setRefs((prev) => (sameRefs(prev, r) ? prev : r));
      });
    load();
    const off = docs.onDocChanged.on(({ docId }) => {
      if (!parseSegmentDocId(docId)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 800);
    });
    return () => {
      alive = false;
      off();
      clearTimeout(timer.current);
    };
  }, [canvases, docs, itemId]);
  return refs;
}

function sameRefs(a: ClipRef[], b: ClipRef[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: ClipRef) => `${r.canvas}/${r.clip.id}/${r.clip.edited}`;
  const set = new Set(a.map(key));
  return b.every((r) => set.has(key(r)));
}

/** Object URL of a stored asset (null while loading or when missing). */
export function useAssetUrl(hash: string | undefined): string | null {
  const { assets } = useServices();
  const [url, setUrl] = useState<string | null>(hash ? (assets.cachedUrl(hash) ?? null) : null);
  useEffect(() => {
    if (!hash) return setUrl(null);
    let alive = true;
    void assets.url(hash).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assets, hash]);
  return url;
}

/** Whether a book's file is on this device (L6). */
export function useHasFile(hash: string): boolean | null {
  const { assets } = useServices();
  const [has, setHas] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void assets.has(hash).then((h) => alive && setHas(h));
    return () => {
      alive = false;
    };
  }, [assets, hash, tick]);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener('slate-book-file', on);
    return () => window.removeEventListener('slate-book-file', on);
  }, []);
  return has;
}

/** Announces that a book file was stored (re-imported) so open panes re-check (L6). */
export function announceBookFile() {
  window.dispatchEvent(new Event('slate-book-file'));
}

/** Device-local UI preference stored in localStorage. */
export function useLocalPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  return [v, set];
}

/**
 * Inactive side-pane tabs stay mounted but hidden (display: none), which resets their scroll
 * position; this restores it when the tab is shown again.
 */
export function useKeepScroll(ref: RefObject<HTMLElement | null>, restore?: (el: HTMLElement) => void, key?: unknown) {
  const last = useRef(0);
  const hidden = useRef(false);
  const cb = useRef(restore);
  cb.current = restore;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (el.clientWidth > 0) last.current = el.scrollTop;
    };
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0) {
        hidden.current = true;
        return;
      }
      if (!hidden.current) return;
      hidden.current = false;
      requestAnimationFrame(() => {
        if (cb.current) cb.current(el);
        else el.scrollTop = last.current;
      });
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [ref, key]);
}
